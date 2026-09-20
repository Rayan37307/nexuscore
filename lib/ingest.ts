import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { extractDealIntelligence } from "@/lib/groq";
import { chunkText, embedTexts } from "@/lib/embeddings";
import { sanitizeContent } from "@/lib/sanitize";
import { runPostIngestAgents } from "@/lib/agents";
import { STAGE_VALUES, type DealStage, type InteractionType } from "@/lib/constants";
import type { Extraction } from "@/lib/types";

export interface IngestInput {
  content: string;
  type: InteractionType;
  userId: string;
  sourceIdentifier?: string | null;
  dealId?: string | null;
  currentStage?: DealStage;
  skipAi?: boolean;
}

export interface IngestResult {
  dealId: string;
  dealTitle: string;
  stage: DealStage;
  stageChanged: boolean;
  previousStage: DealStage | null;
  winProbability: number;
  interactionId: string;
  extraction: Extraction | null;
  /** PII types redacted from this content before storage (§3.5). */
  redactions: string[];
  /** New human-in-the-loop agent proposals created by this ingestion. */
  queuedActions: number;
}

function titleCaseName(raw: string) {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function draftToText(email: { subject: string; body: string }) {
  return `Subject: ${email.subject}\n\n${email.body}`;
}

/**
 * Module A + B pipeline: extract structured intelligence with Groq, upsert
 * company/contacts, create-or-update the deal, log the interaction, and embed
 * memory chunks into pgvector. Uses the service-role client because ingestion
 * is a trusted server-side / webhook flow (the n8n path has no user session).
 */
export async function ingestInteraction(input: IngestInput): Promise<IngestResult> {
  const db = createSupabaseServiceClient();

  const rawInput = (input.content ?? "").trim();
  if (!rawInput) throw new Error("Cannot ingest empty content.");
  if (rawInput.length < 40) {
    throw new Error("Content is too short to analyze — paste at least a meaningful excerpt.");
  }

  // §3.4 Phase 1 step 3: scrub PII before anything downstream — extraction,
  // storage, and vectorization all see the sanitized text only.
  const { sanitized: content, redactions } = sanitizeContent(rawInput);

  const currentStage: DealStage =
    input.currentStage && STAGE_VALUES.includes(input.currentStage)
      ? input.currentStage
      : "discovery";

  // ── 1. AI extraction (skippable for demo seeding) ────────────────────
  let extraction: Extraction | null = null;
  if (!input.skipAi) {
    extraction = await extractDealIntelligence(content, currentStage);
  }
  const companyName = extraction?.company_name ?? "Demo Company";
  const stage = (extraction?.suggested_stage ?? currentStage) as DealStage;
  const winProbability = extraction?.win_probability ?? 20;
  const dealTitle =
    extraction?.deal_title ?? `${companyName} — ${input.type.replace(/_/g, " ")}`;

  // ── 2. Resolve or create the deal ────────────────────────────────────
  let dealId = input.dealId ?? null;
  let previousStage: DealStage | null = null;
  let previousLastInteractionDate: string | null = null;
  let resolvedCompanyId: string | null = null;

  if (dealId) {
    const { data: existing, error } = await db
      .from("deals")
      .select("id, stage, company_id, last_interaction_date")
      .eq("id", dealId)
      .eq("user_id", input.userId)
      .single();
    if (error || !existing) throw new Error(`Deal ${dealId} not found for this user.`);
    previousStage = existing.stage as DealStage;
    resolvedCompanyId = existing.company_id ?? null;
    previousLastInteractionDate = existing.last_interaction_date;
  }

  if (!dealId) {
    // Find the most recent non-closed deal for this user + company name.
    const { data: companyMatches } = await db
      .from("companies")
      .select("id, name")
      .eq("user_id", input.userId)
      .ilike("name", companyName)
      .limit(1);
    const matchedCompanyId = companyMatches?.[0]?.id ?? null;

    if (matchedCompanyId) {
      const { data: openDeals } = await db
        .from("deals")
        .select("id, stage, last_interaction_date")
        .eq("user_id", input.userId)
        .eq("company_id", matchedCompanyId)
        .not("stage", "in", "(closed_won,closed_lost)")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (openDeals && openDeals.length > 0) {
        dealId = openDeals[0].id;
        previousStage = openDeals[0].stage as DealStage;
        resolvedCompanyId = matchedCompanyId;
        previousLastInteractionDate = openDeals[0].last_interaction_date;
      }
    }
  }

  // ── 2b. Self-heal a missing profile row (pre-trigger signups, auth-only
  // user imports). Without it the company upsert hits companies_user_id_fkey.
  const { error: profileErr } = await db
    .from("profiles")
    .upsert(
      { id: input.userId, email: `${input.userId}@unknown.local` },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (profileErr) {
    throw new Error(`Profile ensure failed: ${profileErr.message}`);
  }

  // ── 3. Company upsert (match by normalized name, else create) ────────
  if (!resolvedCompanyId) {
    const { data: company, error: companyErr } = await db
      .from("companies")
      .upsert(
        { user_id: input.userId, name: companyName },
        { onConflict: "user_id,name" },
      )
      .select("id")
      .single();
    if (companyErr) throw new Error(`Company upsert failed: ${companyErr.message}`);
    resolvedCompanyId = company.id;
  }

  // ── 4. Deal create / update ──────────────────────────────────────────
  // Stalled detection (v2 §4.2): ≥14 days of silence before this ingest.
  // Brand-new deals are never stalled (no prior activity to gap).
  const silenceDays = previousLastInteractionDate
    ? Math.floor((Date.now() - new Date(previousLastInteractionDate).getTime()) / 86_400_000)
    : 0;
  const stalled = previousLastInteractionDate !== null && silenceDays >= 14;
  const dealPayload = {
    user_id: input.userId,
    company_id: resolvedCompanyId,
    title: dealTitle,
    stage,
    win_probability: winProbability,
    ai_summary: extraction?.executive_summary ?? null,
    key_blockers: extraction?.key_blockers ?? [],
    identified_budget: extraction?.identified_budget ?? null,
    next_steps: extraction?.next_steps ?? [],
    follow_up_draft: extraction ? draftToText(extraction.follow_up_email) : null,
    last_interaction_date: new Date().toISOString(),
    stalled_warning: stalled,
  };
  // Fresh deals seed the card value from the extracted budget so the board
  // never shows $0 when the transcript stated one. Existing deals keep the
  // rep-owned amount untouched.

  if (dealId) {
    const { error } = await db.from("deals").update(dealPayload).eq("id", dealId);
    if (error) throw new Error(`Deal update failed: ${error.message}`);
  } else {
    const { data: created, error } = await db
      .from("deals")
      .insert({ ...dealPayload, amount: extraction?.identified_budget ?? 0 })
      .select("id")
      .single();
    if (error || !created) throw new Error(`Deal create failed: ${error?.message}`);
    dealId = created.id;
  }

  if (!dealId) throw new Error("Deal ID missing after create/update.");

  // ── 5. Interaction log ───────────────────────────────────────────────
  const { data: interaction, error: interactionErr } = await db
    .from("interactions")
    .insert({
      deal_id: dealId,
      user_id: input.userId,
      type: input.type,
      source_identifier: input.sourceIdentifier ?? null,
      raw_content: content,
      sanitized_summary: extraction?.executive_summary ?? null,
      action_items: extraction?.next_steps ?? [],
      sentiment_score: extraction?.sentiment_score ?? null,
    })
    .select("id")
    .single();
  if (interactionErr || !interaction) {
    throw new Error(`Interaction insert failed: ${interactionErr?.message}`);
  }

  // ── 6. Contact upserts (name or email matched, else created) ─────────
  const names = extraction?.contact_names ?? [];
  const emails = extraction?.contact_emails ?? [];
  const rows: {
    user_id: string;
    company_id: string | null;
    first_name: string;
    last_name: string | null;
    email: string;
  }[] = [];

  names.forEach((rawName, i) => {
    const name = titleCaseName(rawName);
    if (!name) return;
    const [first, ...rest] = name.split(" ");
    rows.push({
      user_id: input.userId,
      company_id: resolvedCompanyId,
      first_name: first,
      last_name: rest.length ? rest.join(" ") : null,
      email: emails[i] ?? emails[0] ?? `${name.toLowerCase().replace(/\s+/g, ".")}@${companyName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")}.example.com`,
    });
  });

  const emailsWithoutContact = emails.slice(names.length);
  for (const email of emailsWithoutContact) {
    const [first, ...rest] = email.split("@")[0].split(/[._-]/);
    rows.push({
      user_id: input.userId,
      company_id: resolvedCompanyId,
      first_name: titleCaseName(first) ?? first,
      last_name: rest.length ? titleCaseName(rest.join(" ")) : null,
      email,
    });
  }

  for (const row of rows) {
    await db
      .from("contacts")
      .upsert(row, { onConflict: "user_id,email" });
  }

  // ── 6b. Stakeholder role mapping (v2 §4.1 influence mapping) ─────────
  for (const s of extraction?.stakeholders ?? []) {
    const name = titleCaseName(s.name);
    if (!name) continue;
    const [first, ...rest] = name.split(" ");
    await db
      .from("contacts")
      .update({ stakeholder_role: s.role })
      .eq("user_id", input.userId)
      .eq("company_id", resolvedCompanyId)
      .ilike("first_name", first)
      .ilike("last_name", rest.join(" ") || "%");
  }

  // ── 7. Deal-memory embeddings (pgvector) ─────────────────────────────
  const chunks = chunkText(content).slice(0, 24);
  if (chunks.length > 0) {
    const vectors = await embedTexts(chunks);
    const embedRows = chunks.map((chunk, i) => ({
      deal_id: dealId,
      interaction_id: interaction.id,
      content_chunk: chunk,
      embedding: JSON.stringify(vectors[i]),
    }));
    const { error: embedErr } = await db.from("deal_embeddings").insert(embedRows);
    if (embedErr) throw new Error(`Embedding insert failed: ${embedErr.message}`);
  }

  // ── 8. Autonomous agents (v2 §4.2) — deterministic playbooks over the
  // extraction; proposals land in agent_action_queue for human review.
  let queuedActions = 0;
  if (extraction && resolvedCompanyId) {
    queuedActions = await runPostIngestAgents({
      userId: input.userId,
      dealId,
      dealTitle,
      companyId: resolvedCompanyId,
      companyName,
      isNewDeal: !input.dealId && previousStage === null,
      interactionType: input.type,
      previousStage,
      stage,
      previousLastInteractionDate,
      extraction,
    });
  }

  return {
    dealId,
    dealTitle,
    stage,
    stageChanged: previousStage !== null && previousStage !== stage,
    previousStage,
    winProbability,
    interactionId: interaction.id,
    extraction,
    redactions,
    queuedActions,
  };
}

export interface MemoryHit {
  content_chunk: string;
  interaction_id: string | null;
  similarity: number;
}

/** Cosine-similarity retrieval over the deal's embedded conversation memory. */
export async function searchDealMemory(
  dealId: string,
  question: string,
  topK = 6,
): Promise<MemoryHit[]> {
  const db = createSupabaseServiceClient();
  const { embedOne } = await import("@/lib/embeddings");
  const queryVector = await embedOne(question);

  const { data, error } = await db.rpc("match_deal_chunks", {
    p_deal_id: dealId,
    p_query_embedding: JSON.stringify(queryVector),
    p_match_count: topK,
  });
  if (error) throw new Error(`Deal-memory search failed: ${error.message}`);
  return (data ?? []) as MemoryHit[];
}
