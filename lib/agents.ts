/**
 * SOP-OPS-NC-001 §4.2 — Autonomous Multi-Agent Workforce.
 *
 * Three agents run after every ingestion and propose actions into the
 * human-in-the-loop queue (§3.4 Phase 3): nothing is ever sent or mutated
 * without operator Accept/Edit/Reject.
 *
 * v1 agent design: fully deterministic playbooks derived from the extraction
 * the pipeline already computed — zero additional LLM calls, so ingestion
 * latency and Groq rate-limit budget stay untouched. The Health Sentinel is
 * the only agent that mutates data directly (companies.health_score, §4.2),
 * which is a computed score, not a customer-facing action.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Extraction } from "@/lib/types";
import type { DealStage } from "@/lib/constants";

export type AgentType = "sdr" | "deal_strategist" | "health_sentinel";

export interface AgentRunContext {
  userId: string;
  dealId: string;
  dealTitle: string;
  companyId: string | null;
  companyName: string;
  isNewDeal: boolean;
  interactionType: string;
  previousStage: DealStage | null;
  stage: DealStage;
  /** last_interaction_date BEFORE this ingest — used for stalled detection. */
  previousLastInteractionDate: string | null;
  extraction: Extraction;
}

const DAY_MS = 86_400_000;
const STALLED_AFTER_DAYS = 14;
const MAX_DISCOUNT_PCT = 15; // §3.4 Phase 2: concession governance cap

function daysBetween(iso: string | null, to = Date.now()): number | null {
  if (!iso) return null;
  const ms = to - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : null;
}

/** Queue a proposal unless an identical pending card already exists. */
async function queueAction(
  db: Db,
  action: {
    userId: string;
    agentType: AgentType;
    dealId: string | null;
    targetEntityId: string;
    actionTitle: string;
    rationale: string;
    payload: Record<string, unknown>;
    requiresDualApproval?: boolean;
  },
): Promise<boolean> {
  const { data: existing } = await db
    .from("agent_action_queue")
    .select("id")
    .eq("user_id", action.userId)
    .eq("agent_type", action.agentType)
    .eq("deal_id", action.dealId)
    .eq("action_title", action.actionTitle)
    .eq("status", "pending")
    .limit(1);
  if (existing && existing.length > 0) return false;

  const { error } = await db.from("agent_action_queue").insert({
    user_id: action.userId,
    agent_type: action.agentType,
    target_entity_type: "deal",
    target_entity_id: action.targetEntityId,
    deal_id: action.dealId,
    action_title: action.actionTitle,
    rationale: action.rationale,
    proposed_payload: action.payload,
    requires_dual_approval: action.requiresDualApproval ?? false,
  });
  if (error) {
    console.warn(`[agents] queue insert failed (${action.agentType}):`, error.message);
    return false;
  }
  return true;
}

// ── §3.6 Kill switch: Passive Read-Only Mode ────────────────────────────
export async function isAgentsPaused(): Promise<boolean> {
  const db = createSupabaseServiceClient();
  const { data } = await db
    .from("platform_settings")
    .select("agents_paused")
    .eq("id", 1)
    .maybeSingle();
  return data?.agents_paused === true;
}

type Db = SupabaseClient;

// ── SDR Agent (§4.2): inbound enrichment + first-response draft ─────────
async function runSdrAgent(db: Db, ctx: AgentRunContext): Promise<number> {
  if (!ctx.isNewDeal) return 0;

  // ICP heuristic (§3.4 Phase 2): headcount ≥ 25, revenue ≥ $2M. Company
  // attributes are sparse at creation time, so null means "unverified".
  const { data: company } = await db
    .from("companies")
    .select("employee_count, annual_revenue, industry")
    .eq("id", ctx.companyId)
    .maybeSingle();

  const icpMatch =
    company
      ? company.employee_count != null && company.annual_revenue != null
        ? company.employee_count >= 25 && Number(company.annual_revenue) >= 2_000_000
        : null
      : null;

  const icpNote =
    icpMatch === null
      ? "ICP fit unverified — enrich company size/revenue before outreach."
      : icpMatch
        ? "Matches ICP (headcount ≥ 25, revenue ≥ $2M)."
        : "Does NOT match ICP thresholds (headcount ≥ 25, revenue ≥ $2M).";

  return (await queueAction(db, {
    userId: ctx.userId,
    agentType: "sdr",
    dealId: ctx.dealId,
    targetEntityId: ctx.dealId,
    actionTitle: `SDR: first-response draft for ${ctx.companyName}`,
    rationale: `New deal created from an inbound ${ctx.interactionType.replace(/_/g, " ")}. ${icpNote} Review the draft before it goes out — Assisted Mode (§3.4 Phase 2).`,
    payload: {
      draft_email: ctx.extraction.follow_up_email,
      icp_match: icpMatch,
      recommended_actions: [
        "Verify the prospect's buying role before sending",
        ...(icpMatch === false ? ["Flag for manual qualification — below ICP thresholds"] : []),
      ],
    },
  }))
    ? 1
    : 0;
}

// ── Deal Strategist Agent (§4.2): risk, stalled deals, concession caps ──
async function runDealStrategist(db: Db, ctx: AgentRunContext): Promise<number> {
  let queued = 0;

  // Concession governance (§3.4 Phase 2): >15% discount needs dual approval.
  const discount = ctx.extraction.discount_mentioned_pct;
  if (discount != null && discount > MAX_DISCOUNT_PCT) {
    queued += (await queueAction(db, {
      userId: ctx.userId,
      agentType: "deal_strategist",
      dealId: ctx.dealId,
      targetEntityId: ctx.dealId,
      actionTitle: `Discount ${discount}% exceeds the ${MAX_DISCOUNT_PCT}% cap`,
      rationale: `The conversation mentions a ${discount}% discount. Policy caps automated discount recommendations at ${MAX_DISCOUNT_PCT}%; anything above requires approval from Sales Management AND RevOps.`,
      payload: {
        discount_mentioned_pct: discount,
        requires_dual_approval: true,
        recommended_actions: [
          "Sales Management approval required",
          "RevOps approval required",
          "Consider value levers (onboarding, term length) before conceding price",
        ],
      },
      requiresDualApproval: true,
    }))
      ? 1
      : 0;
  }

  // Stalled-deal re-engagement play: a ≥14d silent gap just reopened.
  const gapDays = daysBetween(ctx.previousLastInteractionDate);
  if (!ctx.isNewDeal && gapDays != null && gapDays >= STALLED_AFTER_DAYS) {
    queued += (await queueAction(db, {
      userId: ctx.userId,
      agentType: "deal_strategist",
      dealId: ctx.dealId,
      targetEntityId: ctx.dealId,
      actionTitle: `Re-engagement play — ${gapDays} days of silence on ${ctx.dealTitle}`,
      rationale: `This deal had no logged activity for ${gapDays} days before this interaction. The extracted follow-up draft doubles as a re-engagement email; review and send.`,
      payload: {
        draft_email: ctx.extraction.follow_up_email,
        recommended_actions: [
          "Send the re-engagement draft",
          "Reconfirm timeline and decision process",
          "Check for a new economic buyer if sponsorship changed",
        ],
      },
    }))
      ? 1
      : 0;
  }

  // Risk identification: heavy blocker load in late stages.
  const blockers = ctx.extraction.key_blockers;
  const lateStage = ctx.stage === "proposal" || ctx.stage === "negotiation";
  if (lateStage && blockers.length >= 2) {
    queued += (await queueAction(db, {
      userId: ctx.userId,
      agentType: "deal_strategist",
      dealId: ctx.dealId,
      targetEntityId: ctx.dealId,
      actionTitle: `${blockers.length} unresolved blockers in ${ctx.stage}`,
      rationale: `Deals at ${ctx.stage} with ${blockers.length} open risks historically slip. Attach owners and dates to each blocker to protect the close date.`,
      payload: {
        recommended_actions: [
          ...blockers.map((b) => `Resolve: ${b}`),
          ...(ctx.extraction.next_steps.length ? ["Next steps: " + ctx.extraction.next_steps.join("; ")] : []),
        ],
      },
    }))
      ? 1
      : 0;
  }

  return queued;
}

// ── Customer Health Sentinel (§4.2): score + churn mitigation ───────────
async function runHealthSentinel(db: Db, ctx: AgentRunContext): Promise<number> {
  if (!ctx.companyId) return 0;

  // Signals available at $0: interaction recency, prospect sentiment trend,
  // and open blocker count. Product-telemetry usage drop (§3.4 Phase 2)
  // activates post-MVP when a telemetry source is connected.
  const { data: recent } = await db
    .from("interactions")
    .select("sentiment_score, occurred_at, deal_id")
    .in("deal_id", [ctx.dealId])
    .order("occurred_at", { ascending: false })
    .limit(5);

  const sentiments = (recent ?? [])
    .map((r) => Number(r.sentiment_score))
    .filter((s) => Number.isFinite(s));
  const avgSentiment = sentiments.length
    ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length
    : 0;

  const blockerCount = ctx.extraction.key_blockers.length;
  const gapDays = daysBetween(ctx.previousLastInteractionDate) ?? 0;

  let score = 100;
  const signals: string[] = [];
  if (gapDays >= STALLED_AFTER_DAYS) {
    score -= 15;
    signals.push(`no activity for ${gapDays} days (−15)`);
  }
  if (blockerCount >= 2) {
    score -= 10 * Math.min(blockerCount, 3);
    signals.push(`${blockerCount} open blockers (−${10 * Math.min(blockerCount, 3)})`);
  }
  if (avgSentiment > 0.3) {
    score += 10;
    signals.push("positive sentiment trend (+10)");
  } else if (avgSentiment < -0.2) {
    score -= 10;
    signals.push("negative sentiment trend (−10)");
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  // The Sentinel is the one agent allowed to write directly (§4.2).
  await db
    .from("companies")
    .update({ health_score: score })
    .eq("id", ctx.companyId)
    .eq("user_id", ctx.userId);

  if (score >= 60) return 0; // §3.4 Phase 4: alert threshold 60/100

  // Mitigation playbook selection by dominant signal (§3.4 Phase 4).
  const stallDominant = gapDays >= STALLED_AFTER_DAYS;
  const draft = stallDominant
    ? {
        subject: `Checking in — ${ctx.dealTitle}`,
        body: `Hi there,\n\nIt's been a couple of weeks since we last spoke about ${ctx.dealTitle}. I wanted to make sure nothing is stuck on your side and see if priorities have shifted.\n\nWould a 20-minute call this week work to get things moving again?\n\nBest,\n[Your name]`,
      }
    : blockerCount >= 2
      ? {
          subject: `Escalating your open items — ${ctx.companyName}`,
          body: `Hi there,\n\nI want to make sure the open items (${ctx.extraction.key_blockers.slice(0, 2).join("; ")}) aren't blocking your evaluation. I can bring in our Solutions Engineer to work through them directly with your team.\n\nWould that be useful this week?\n\nBest,\n[Your name]`,
        }
      : {
          subject: `A quick value check-in — ${ctx.companyName}`,
          body: `Hi there,\n\nFollowing up on our recent conversations — I'd love to show you a short session focused on the parts of NexusCore your team would use daily.\n\nWe have a training webinar Thursday; want me to reserve a seat for your team?\n\nBest,\n[Your name]`,
        };

  return (await queueAction(db, {
    userId: ctx.userId,
    agentType: "health_sentinel",
    dealId: ctx.dealId,
    targetEntityId: ctx.companyId,
    actionTitle: `Health alert ${score}/100 — mitigation playbook for ${ctx.companyName}`,
    rationale: `Health score dropped below the 60/100 alert threshold. Signals: ${signals.join("; ") || "insufficient data"}. Review the mitigation draft (§3.4 Phase 4).`,
    payload: {
      health_score: score,
      draft_email: draft,
      recommended_actions: [
        stallDominant ? "Executive check-in call" : blockerCount >= 2 ? "Technical escalation to Solutions Engineering" : "Invite to feature training webinar",
        "Review stakeholder coverage — is the economic buyer still engaged?",
      ],
    },
  }))
    ? 1
    : 0;
}

/**
 * Run the workforce after a successful ingestion. Each agent is isolated —
 * an agent failure logs a warning and never fails the ingestion itself.
 * Returns the number of new queue cards created.
 */
export async function runPostIngestAgents(ctx: AgentRunContext): Promise<number> {
  try {
    if (await isAgentsPaused()) return 0; // §3.6 Emergency Stop
  } catch {
    return 0;
  }

  const db = createSupabaseServiceClient();
  let queued = 0;
  for (const agent of [runSdrAgent, runDealStrategist, runHealthSentinel]) {
    try {
      queued += await agent(db, ctx);
    } catch (err) {
      console.warn(`[agents] ${agent.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return queued;
}
