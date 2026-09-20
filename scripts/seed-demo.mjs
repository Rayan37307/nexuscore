/**
 * Demo seeder: two realistic deals (Acme Cloud, Globex Manufacturing) with
 * interactions and hashed-embedding memory rows so the board and Follow-Up
 * Studio have data immediately after `npm run db:seed` — no AI calls needed.
 * Uses the service-role key; run only in trusted environments.
 *
 *   node scripts/seed-demo.mjs
 */
try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile(".env"); } catch {}

import { createClient } from "@supabase/supabase-js";
import { chunkText, embedTexts, EMBEDDING_DIM } from "../lib/embeddings-core.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// Optional: SEED_EMAIL=you@x.com node scripts/seed-demo.mjs — targets that user's
// profile instead of the first one. Handy for seeding a dedicated demo account.
let profileQuery = db.from("profiles").select("id");
if (process.env.SEED_EMAIL) profileQuery = profileQuery.eq("email", process.env.SEED_EMAIL);
const { data: profile, error: profileErr } = await profileQuery.limit(1).maybeSingle();
if (profileErr || !profile) {
  console.error("No profiles row found. Sign up a user in the app once, then re-run.");
  process.exit(1);
}
const userId = profile.id;

// ── Companies ─────────────────────────────────────────────────────────
const companies = [
  { user_id: userId, name: "Acme Cloud", domain: "acmecloud.io", industry: "Cloud Software", size_estimate: "250-500" },
  { user_id: userId, name: "Globex Manufacturing", domain: "globex.com", industry: "Industrial Manufacturing", size_estimate: "5000+" },
];
const companyIds = {};
for (const c of companies) {
  const { data, error } = await db.from("companies").upsert(c, { onConflict: "user_id,name" }).select("id").single();
  if (error) throw error;
  companyIds[c.name] = data.id;
}

// ── Contacts ──────────────────────────────────────────────────────────
const contacts = [
  { user_id: userId, company_id: companyIds["Acme Cloud"], first_name: "Mara", last_name: "Chen", email: "mara.chen@acmecloud.io", job_title: "VP Revenue Operations" },
  { user_id: userId, company_id: companyIds["Acme Cloud"], first_name: "Dev", last_name: "Patel", email: "dev.patel@acmecloud.io", job_title: "Security Engineer" },
  { user_id: userId, company_id: companyIds["Globex Manufacturing"], first_name: "Igor", last_name: "Sokolov", email: "igor.sokolov@globex.com", job_title: "Director of Sales" },
];
for (const c of contacts) {
  const { error } = await db.from("contacts").upsert(c, { onConflict: "user_id,email" });
  if (error) throw error;
}

// ── Deals + interactions + memory ─────────────────────────────────────
const demoDeals = [
  {
    company: "Acme Cloud",
    title: "Acme Cloud — Revenue Intelligence Platform",
    stage: "proposal",
    amount: 60000,
    win_probability: 68,
    ai_summary:
      "Strong technical fit confirmed in second demo; Acme's RevOps lead is championing internally. Security review with Dev Patel is the gate: SOC 2 report and DPA required before procurement. Verbal budget of $60k/yr for 25 seats aligned. Targeting signature before end of quarter.",
    key_blockers: ["SOC 2 Type II report pending", "DPA redlines with legal", "Security review is approval gate"],
    identified_budget: 60000,
    next_steps: [
      "Send SOC 2 report and DPA (AE, this week)",
      "Intro AE to procurement (Mara, next week)",
      "Proposal review call Friday 2pm",
    ],
    follow_up_draft:
      "Subject: Acme Cloud x NexusCore — SOC 2 docs + Friday proposal review\n\nHi Mara,\n\nThanks for the sharp questions in Friday's review — attached are our SOC 2 Type II report and standard DPA for your security team. Dev's notes on data retention were addressed in section 4.2.\n\nNext steps: legal redlines back by Wednesday, and proposal sign-off on Friday's 2pm call.\n\nBest,\n[Your name]",
    expected_close_date: "2026-10-30",
    last_interaction: "2 days ago",
    interactions: [
      {
        type: "meeting_transcript",
        source: "acme-discovery.txt",
        summary: "Discovery: 6 hrs/week per rep lost to CRM updates; $60k budget for 25 seats; champion = Mara Chen.",
        content: `Mara Chen: We're spending about six hours a week per rep on manual CRM updates — that's the pain we want to kill.
Sam Rep (AE): Our onboarding is under two weeks. Would budget around $60,000 a year be workable for 25 seats?
Mara Chen: That works if we see the value in the pilot. I'd want our security engineer Dev Patel in the next session.
Sam Rep (AE): Perfect. Let's schedule the technical demo for next Tuesday and include your security review checklist.`,
      },
      {
        type: "meeting_transcript",
        source: "acme-demo2.txt",
        summary: "Second demo strong; security gate = SOC 2 + DPA; proposal review Friday 2pm.",
        content: `Dev Patel: How do you handle data residency and encryption at rest?
Sam Rep (AE): AES-256 at rest, TLS 1.3 in transit. We can provide our SOC 2 Type II report and sign your DPA.
Dev Patel: Good. We'll need those before procurement will engage.
Mara Chen: Let's target the proposal review Friday 2pm. Igor from legal may join late.`,
      },
    ],
  },
  {
    company: "Globex Manufacturing",
    title: "Globex Manufacturing — Sales Desk Automation",
    stage: "discovery",
    amount: 120000,
    win_probability: 30,
    ai_summary:
      "Early discovery after inbound webinar. Pain is 300-rep team with zero call visibility for front-line managers. Budget owner unknown; likely ERP-integration requirement flagged. Compliant vendor list gating a pilot.",
    key_blockers: ["Budget owner not identified", "Possible ERP integration requirement", "Vendor compliance list gating pilot"],
    identified_budget: null,
    next_steps: ["Map buying committee (AE)", "Send security overview one-pager (AE)"],
    follow_up_draft:
      "Subject: Globex x NexusCore — next steps from Thursday's chat\n\nHi Igor,\n\nGreat speaking today. The visibility gap across your 300-rep team is exactly what NexusCore was built for — reps stop logging, managers finally see the calls.\n\nI'll send the security overview one-pager and we can map the buying committee together on Tuesday.\n\nBest,\n[Your name]",
    expected_close_date: "2027-01-15",
    last_interaction: "18 days ago",
    stalled: true,
    interactions: [
      {
        type: "email",
        source: "inbound@webinar-list",
        summary: "Inbound email after webinar: interest, but procurement gating and budget unknown.",
        content: `From: Igor Sokolov <igor.sokolov@globex.com>
Subject: Re: NexusCore webinar follow-up

We watched the webinar — the auto-stage-update demo was impressive. We have 300 reps and zero call visibility for managers. Honestly we're drowning in manual CRM updates.

Before any pilot, new vendors must be added to our approved vendor list and pass a procurement screen. I don't own the budget for this, but I can get you in front of the person who does.`,
      },
    ],
  },
];

for (const d of demoDeals) {
  const { data: deal, error: dealErr } = await db
    .from("deals")
    .upsert(
      {
        user_id: userId,
        company_id: companyIds[d.company],
        title: d.title,
        stage: d.stage,
        amount: d.amount,
        currency: "USD",
        win_probability: d.win_probability,
        ai_summary: d.ai_summary,
        key_blockers: d.key_blockers,
        identified_budget: d.identified_budget,
        next_steps: d.next_steps,
        follow_up_draft: d.follow_up_draft,
        expected_close_date: d.expected_close_date,
        last_interaction_date: new Date(Date.now() - (d.last_interaction === "2 days ago" ? 2 : 18) * 86400000).toISOString(),
        stalled_warning: Boolean(d.stalled),
      },
      { onConflict: "user_id,title" },
    )
    .select("id")
    .single();
  if (dealErr) throw dealErr;

  for (const ix of d.interactions) {
    const { data: interaction, error: ixErr } = await db
      .from("interactions")
      .insert({
        deal_id: deal.id,
        user_id: userId,
        type: ix.type,
        source_identifier: ix.source,
        raw_content: ix.content,
        sanitized_summary: ix.summary,
        action_items: [],
        sentiment_score: 0.4,
      })
      .select("id")
      .single();
    if (ixErr) throw ixErr;

    const chunks = chunkText(ix.content).slice(0, 24);
    const vectors = await embedTexts(chunks);
    const { error: embErr } = await db.from("deal_embeddings").insert(
      chunks.map((chunk, i) => ({
        deal_id: deal.id,
        interaction_id: interaction.id,
        content_chunk: chunk,
        embedding: JSON.stringify(vectors[i]),
      })),
    );
    if (embErr) throw embErr;
  }
}

console.log(
  `Seeded 2 demo companies, 3 contacts, 2 deals (1 stalled), 3 interactions, and ${EMBEDDING_DIM}-dim deal-memory embeddings.`,
);

// ── v2: platform settings + sample agent_action_queue card ────────────
await db.from("platform_settings").upsert(
  { user_id: userId, agents_enabled: true },
  { onConflict: "user_id" },
);

const DEMO_ACTION_TITLE = "Re-engagement play: Globex Manufacturing (stalled 18 days)";
const { data: existingAction } = await db
  .from("agent_action_queue")
  .select("id")
  .eq("action_title", DEMO_ACTION_TITLE)
  .maybeSingle();
if (!existingAction) {
  const { data: globexDeal } = await db
    .from("deals")
    .select("id")
    .eq("user_id", userId)
    .eq("title", "Globex Manufacturing — Sales Desk Automation")
    .maybeSingle();
  await db.from("agent_action_queue").insert({
    user_id: userId,
    agent_type: "Deal Strategist",
    target_entity_type: "deal",
    target_entity_id: globexDeal?.id ?? userId,
    action_title: DEMO_ACTION_TITLE,
    action_kind: "follow_up_email",
    proposed_payload: {
      email_subject: "Globex x NexusCore — picking this back up?",
      email_body:
        "Hi Igor,\n\nIt's been a few weeks since we mapped the buying committee. Given the visibility push across your 300-rep team, worth a 20-minute refresh on where procurement stands?\n\nBest,\n[Your name]",
      rationale: "No logged interaction for 18 days while deal sits in Discovery at 30% — Health Sentinel flagged drift risk.",
    },
    status: "Pending",
  });
  console.log("Seeded 1 pending agent action card.");
}
