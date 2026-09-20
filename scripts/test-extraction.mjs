#!/usr/bin/env node
/**
 * Day-3 deliverable: "Build Node.js test script for extraction validation
 * across sales scenarios." Calls the real Groq API (default openai/gpt-oss-120b,
 * JSON mode) with the production system prompt, then checks structural and
 * rubric expectations per scenario. Standalone by design — it validates the
 * live API contract, not internal modules.
 *
 *   node scripts/test-extraction.mjs          (reads .env / .env.local)
 */
try { process.loadEnvFile(".env.local"); } catch {}
try { process.loadEnvFile(".env"); } catch {}

import Groq from "groq-sdk";

const MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";
const STAGES = ["lead", "discovery", "demo", "proposal", "negotiation", "closed_won", "closed_lost"];

const SYSTEM_PROMPT = `You are NexusCore's Lead Revenue Operations Intelligence Model.
Analyze the provided meeting transcript or email exchange in a B2B sales context.
Extract key deal parameters and output ONLY valid JSON matching the schema below.

Rules:
- "suggested_stage" must be exactly one of: lead, discovery, demo, proposal, negotiation, closed_won, closed_lost.
- "win_probability" is an integer 0-100 using this rubric: lead 5-15, discovery 20-40, demo 40-60, proposal 55-75, negotiation 70-90, closed_won 100, closed_lost 0.
- "identified_budget": any budget amount mentioned, as a bare number WITHOUT currency symbols (e.g. 120000). null if not mentioned.
- "deal_title": a short pipeline card title like "<Company> — <product/initiative>". null if unclear.
- "contact_names": every human participant from the PROSPECT side (exclude the account executive/narrator) as "First Last".
- "contact_emails": email addresses explicitly present in the content.
- "key_blockers": risks, objections, and open security/procurement/legal items. Empty array if none.
- "next_steps": concrete actions, with owners and dates when stated.
- "executive_summary": a 2-4 sentence neutral briefing of where the deal stands.
- "follow_up_email": a ready-to-send draft from the account executive — subject line plus a body with a greeting, 2-3 sentence recap, next steps, and a call to action. Sign off as "[Your name]".
- "sentiment_score": number between -1.0 (negative) and 1.0 (positive).

Output JSON only, with exactly this shape:
{
  "company_name": "string",
  "deal_title": "string or null",
  "contact_names": ["string"],
  "contact_emails": ["string"],
  "suggested_stage": "discovery",
  "win_probability": 20,
  "identified_budget": null,
  "key_blockers": ["string"],
  "next_steps": ["string"],
  "executive_summary": "string",
  "follow_up_email": { "subject": "string", "body": "string" },
  "sentiment_score": 0
}`;

const fixtures = [
  {
    name: "discovery-call (budget + pain clear)",
    currentStage: "lead",
    expect: { stageIn: ["discovery"], probRange: [20, 45], budget: 60000, minContacts: 1 },
    content: `Mara Chen: We're spending about six hours a week per rep on manual CRM updates — that's the pain we want to kill.
Sam Rep (AE): Our onboarding is under two weeks. Would budget around $60,000 a year be workable for 25 seats?
Mara Chen: That works if we see the value in the pilot. I'd want our security engineer Dev Patel in the next session before we go further.`,
  },
  {
    name: "negotiation-call (pricing push, legal)",
    currentStage: "proposal",
    expect: { stageIn: ["negotiation", "proposal"], probRange: [55, 92], budget: 130000, minBlockers: 1 },
    content: `Allison Reyes (Titan Manufacturing): Legal came back with two redlines on the DPA, mostly data-retention language.
Sam Rep (AE): We can accept a 24-month retention carve-out. On price, 40 seats at $130,000 annually with the Q4 discount we discussed.
Allison Reyes: If legal signs off this week, I can get this on Friday's signing block. CFO already saw the number.`,
  },
  {
    name: "follow-up email thread (objection, no budget)",
    currentStage: "demo",
    expect: { stageIn: ["discovery", "demo", "lead"], minBlockers: 1, minNextSteps: 1 },
    content: `From: priya.nair@brightline-health.com
Subject: Re: NexusCore demo follow-up

Thanks for the demo. My concern: our compliance team requires on-prem or private-cloud deployment, and what you showed is SaaS-only. Also, I don't own this budget — I'd need to bring in our COO. Can you send a security overview I can forward?`,
  },
  {
    name: "closed-won call (verbal commit)",
    currentStage: "negotiation",
    expect: { stageIn: ["closed_won", "negotiation"], probRange: [70, 100] },
    content: `Hannah Cole (Northwind Logistics): Procurement cleared the vendor screen, countersignature is done on our side, and the PO for $85,000 was cut this morning. Kickoff next Monday works.
Sam Rep (AE): Fantastic — I'll send the kickoff agenda and intro our onboarding lead today.`,
  },
];

function check(name, ok, detail) {
  const icon = ok ? "✓" : "✗";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function runFixture(groq, fixture) {
  console.log(`\n● ${fixture.name}`);
  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Current Deal Stage: ${fixture.currentStage}\n\nTranscript or email thread:\n"""\n${fixture.content}\n"""`,
      },
    ],
    model: MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return check("valid JSON returned", false, raw.slice(0, 120));
  }
  check("valid JSON returned", true);

  check("company_name present", typeof data.company_name === "string" && data.company_name.length > 0);
  check(
    "suggested_stage valid",
    STAGES.includes(data.suggested_stage),
    `got ${data.suggested_stage}`,
  );
  if (fixture.expect.stageIn) {
    check(
      "stage matches scenario",
      fixture.expect.stageIn.includes(data.suggested_stage),
      `expected ${fixture.expect.stageIn.join("|")}, got ${data.suggested_stage}`,
    );
  }
  const p = Number(data.win_probability);
  check("win_probability 0-100 integer", Number.isInteger(p) && p >= 0 && p <= 100, `got ${p}`);
  if (fixture.expect.probRange) {
    check(
      "probability within rubric band",
      p >= fixture.expect.probRange[0] && p <= fixture.expect.probRange[1],
      `expected ${fixture.expect.probRange[0]}-${fixture.expect.probRange[1]}, got ${p}`,
    );
  }
  if (fixture.expect.budget != null) {
    check(
      "identified_budget extracted",
      Number(data.identified_budget) === fixture.expect.budget,
      `expected ${fixture.expect.budget}, got ${data.identified_budget}`,
    );
  }
  if (fixture.expect.minContacts != null) {
    check(
      "contact_names extracted",
      Array.isArray(data.contact_names) && data.contact_names.length >= fixture.expect.minContacts,
      `got ${JSON.stringify(data.contact_names)}`,
    );
  }
  if (fixture.expect.minBlockers != null) {
    check(
      "key_blockers extracted",
      Array.isArray(data.key_blockers) && data.key_blockers.length >= fixture.expect.minBlockers,
      `got ${JSON.stringify(data.key_blockers)}`,
    );
  }
  if (fixture.expect.minNextSteps != null) {
    check(
      "next_steps extracted",
      Array.isArray(data.next_steps) && data.next_steps.length >= fixture.expect.minNextSteps,
    );
  }
  check(
    "executive_summary present",
    typeof data.executive_summary === "string" && data.executive_summary.length > 30,
  );
  const email = data.follow_up_email;
  check(
    "follow_up_email has subject+body",
    !!email && typeof email.subject === "string" && email.subject.length > 5 &&
      typeof email.body === "string" && email.body.length > 40,
  );
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY is required. Get a free key at console.groq.com (gsk_...).");
    process.exit(1);
  }
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log(`Extraction validation against ${MODEL} — 4 scenarios\n`);
  for (const fixture of fixtures) {
    await runFixture(groq, fixture);
  }
  console.log(process.exitCode ? "\nFAILURES — review prompt/schema." : "\nAll scenarios passed.");
}

main().catch((err) => {
  console.error("Test run failed:", err.message);
  process.exit(1);
});
