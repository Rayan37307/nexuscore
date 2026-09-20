import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestInteraction } from "@/lib/ingest";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { WEBHOOK_HEADER } from "@/lib/constants";

/**
 * n8n inbound webhook (Module A, spec §2). Authenticated by a shared secret
 * header, runs the full extraction pipeline, and targets a specific user
 * profile (n8n has no Supabase session). Optional profile e-mail targeting.
 *
 * Expected JSON body:
 * {
 *   "content":  "raw transcript or email text (required)",
 *   "type":     "meeting_transcript" | "email" | "call_recording" | "note",
 *   "userEmail":"rep@yourco.com (optional, overrides NEXUSCORE_DEFAULT_USER_EMAIL)",
 *   "dealId":   "uuid (optional — attaches to an existing deal)",
 *   "sourceIdentifier": "e.g. forward-to address or recorder id"
 * }
 */
export const maxDuration = 300;

function secretOk(req: NextRequest): boolean {
  const expected = process.env.NEXUSCORE_WEBHOOK_SECRET;
  if (!expected) return false; // refused unless explicitly configured
  const provided = req.headers.get(WEBHOOK_HEADER) ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized webhook." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const content = typeof body.content === "string" ? body.content : null;
    if (!content) {
      return NextResponse.json(
        { success: false, error: "Body must include a `content` string." },
        { status: 400 },
      );
    }

    const db = createSupabaseServiceClient();

    let userId: string | null = null;

    if (typeof body.userEmail === "string") {
      userId =
        (
          await db
            .from("profiles")
            .select("id")
            .eq("email", body.userEmail)
            .single()
        ).data?.id ?? null;
    }

    if (!userId && process.env.NEXUSCORE_DEFAULT_USER_EMAIL) {
      userId =
        (
          await db
            .from("profiles")
            .select("id")
            .eq("email", process.env.NEXUSCORE_DEFAULT_USER_EMAIL)
            .single()
        ).data?.id ?? null;
    }

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cannot resolve target user. Pass `userEmail` in the body or set NEXUSCORE_DEFAULT_USER_EMAIL.",
        },
        { status: 422 },
      );
    }

    const validTypes = ["meeting_transcript", "email", "call_recording", "note"];
    const type = validTypes.includes(body.type) ? body.type : "meeting_transcript";

    const result = await ingestInteraction({
      content,
      type,
      userId,
      dealId: typeof body.dealId === "string" ? body.dealId : null,
      sourceIdentifier: body.sourceIdentifier ?? null,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[webhook-ingest] failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Webhook ingestion failed" },
      { status: 500 },
    );
  }
}
