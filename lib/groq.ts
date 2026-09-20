import Groq from "groq-sdk";
import { ExtractionSchema, type Extraction } from "./types";
import type { DealStage } from "./constants";

// llama-3.3-70b-versatile was moved to Enterprise-only by Groq (Aug 2026);
// gpt-oss-120b is the free-tier production replacement with JSON mode.
export const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";
export const STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3";

let _groq: Groq | null = null;

export function getGroq(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured. Add it to your environment (see .env.example).");
  }
  if (!_groq) {
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

const EXTRACTION_SYSTEM_PROMPT = `You are NexusCore's Lead Revenue Operations Intelligence Model.
Analyze the provided meeting transcript or email exchange in a B2B sales context.
Extract key deal parameters and output ONLY valid JSON matching the schema below.

Rules:
- "company_name": the prospect company. If it is not explicitly named, infer it from email domains, signatures, or context and use proper capitalization (e.g. emails @acmecloud.io → "Acmecloud"). Use "Unknown Company" only if truly unidentifiable.
- "suggested_stage" must be exactly one of: lead, discovery, demo, proposal, negotiation, closed_won, closed_lost.
- Decide "suggested_stage" from the SIGNALS in the content, never by echoing the current stage: pricing/proposal/contract/signature/security-for-procurement discussed → "proposal"; counter-offers, discount haggling, or legal/procurement back-and-forth → "negotiation"; product walkthrough run or scheduled → "demo"; first substantive qualification call → "discovery"; inbound interest with no real conversation yet → "lead".
- "win_probability" is an integer 0-100 using this rubric: lead 5-15, discovery 20-40, demo 40-60, proposal 55-75, negotiation 70-90, closed_won 100, closed_lost 0. Adjust within the band based on signals (budget, authority, timeline, competition).
- "identified_budget": any budget/benchmark amount mentioned, as a bare number WITHOUT currency symbols (e.g. 120000). null if not mentioned.
- "deal_title": a short pipeline card title like "<Company> — <product/initiative>". null if unclear.
- "contact_names": every human participant from the PROSPECT side (exclude the account executive/narrator) as "First Last".
- "contact_emails": email addresses explicitly present in the content.
- "stakeholders": for each prospect participant, their buying-role: "Champion" (drives the deal internally), "Economic Buyer" (owns budget/sign-off), "Blocker" (raises objections that stall progress), "Technical Evaluator" (security/architecture gatekeeper), or "Influencer". Empty array if roles are unclear.
- "discount_mentioned_pct": if a discount percentage is discussed (pricing/procurement negotiation), output it as a bare number (e.g. 20 for 20%). null if not mentioned.
- "key_blockers": risks, objections, and open security/procurement/legal items. Empty array if none.
- "next_steps": concrete actions, with owners and dates when stated.
- "executive_summary": a 2-4 sentence neutral briefing of where the deal stands.
- "follow_up_email": a ready-to-send draft from the account executive — subject line plus a body with a greeting, 2-3 sentence recap, next steps, and a call to action. Sign off as "[Your name]".
- "sentiment_score": number between -1.0 (negative) and 1.0 (positive) describing prospect sentiment.

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
  "sentiment_score": 0,
  "stakeholders": [{ "name": "string", "role": "Champion" }],
  "discount_mentioned_pct": null
}`;

/**
 * Tolerant normalization before zod validation: some models (e.g. gpt-oss)
 * return null/empty for fields they are unsure about instead of a fallback.
 * Derive sensible values rather than failing the whole extraction.
 */
function coerceExtraction(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const o = { ...(parsed as Record<string, unknown>) };

  if (typeof o.company_name !== "string" || !o.company_name.trim()) {
    const emails = Array.isArray(o.contact_emails) ? o.contact_emails : [];
    const firstEmail = emails.find((e): e is string => typeof e === "string" && e.includes("@"));
    const domain = firstEmail ? firstEmail.split("@")[1]?.split(".")[0] : null;
    o.company_name = domain
      ? domain.charAt(0).toUpperCase() + domain.slice(1)
      : "Unknown Company";
  }

  if (typeof o.executive_summary !== "string" || !o.executive_summary.trim()) {
    o.executive_summary = "No summary could be generated for this interaction.";
  }

  if (!Array.isArray(o.stakeholders)) o.stakeholders = [];
  if (o.discount_mentioned_pct === undefined) o.discount_mentioned_pct = null;

  return o;
}

export async function extractDealIntelligence(
  rawContent: string,
  currentStage: DealStage,
): Promise<Extraction> {
  // Groq free tier context is generous, but cap pathological inputs.
  const content = rawContent.length > 60_000 ? `${rawContent.slice(0, 60_000)}\n…[truncated]` : rawContent;
  const userContent = `Current Deal Stage: ${currentStage}\n\nTranscript or email thread:\n"""\n${content}\n"""`;

  const callExtraction = (messages: Groq.Chat.ChatCompletionMessageParam[]) =>
    getGroq().chat.completions.create({
      messages,
      model: TEXT_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

  const completion = await callExtraction([
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ]);

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Extraction model returned invalid JSON. Retry with a cleaner transcript.");
  }

  const result = ExtractionSchema.safeParse(coerceExtraction(parsed));
  if (result.success) return result.data;

  // One self-repair round-trip: show the model its output plus the exact
  // schema violations and ask for corrected JSON before giving up.
  const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  const repair = await callExtraction([
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: userContent },
    { role: "assistant", content: raw },
    {
      role: "user",
      content: `Your JSON failed schema validation: ${issues}. Return the corrected complete JSON object only — same shape, no commentary.`,
    },
  ]);

  const rawRepair = repair.choices[0]?.message?.content ?? "{}";
  let parsedRepair: unknown;
  try {
    parsedRepair = JSON.parse(rawRepair);
  } catch {
    throw new Error(`Extraction output failed validation (${issues}).`);
  }

  const resultRepair = ExtractionSchema.safeParse(coerceExtraction(parsedRepair));
  if (!resultRepair.success) {
    const issuesRepair = resultRepair.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Extraction output failed validation (${issuesRepair}).`);
  }
  return resultRepair.data;
}

export async function answerWithDealMemory(
  question: string,
  contextChunks: { content: string; occurred_at: string | null }[],
): Promise<string> {
  const context = contextChunks
    .map((c, i) => `[${i + 1}]${c.occurred_at ? ` (${new Date(c.occurred_at).toLocaleDateString()})` : ""}\n${c.content}`)
    .join("\n\n");

  const completion = await getGroq().chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are NexusCore's deal-memory assistant. Answer the question strictly using the numbered conversation excerpts from this deal's history. Cite excerpt numbers like [2] when they support a claim. If the excerpts do not contain the answer, say so plainly and note what is missing. Be concise (max 6 sentences).",
      },
      {
        role: "user",
        content: `Conversation memory for this deal:\n\n${context}\n\nQuestion: ${question}`,
      },
    ],
    model: TEXT_MODEL,
    temperature: 0.2,
  });

  return completion.choices[0]?.message?.content?.trim() || "No answer produced.";
}
