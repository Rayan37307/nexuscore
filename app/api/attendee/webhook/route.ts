import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { syncMeetingBot, type MeetingBotRow } from "@/lib/attendee";

/**
 * Attendee webhook receiver (secondary path — polling via
 * GET /api/attendee/bots?sync=1 is the primary and works on localhost).
 *
 * Configure the webhook URL in the Attendee dashboard pointing here with the
 * NEXUSCORE_WEBHOOK_SECRET shared secret. The payload shape is not publicly
 * documented, so this handler is deliberately tolerant: it extracts any
 * UUID-looking bot id it can find and re-syncs that bot; unknown shapes are
 * acknowledged with 200 and logged.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const expected = process.env.NEXUSCORE_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json({ success: false, error: "Webhook secret not configured." }, { status: 503 });
  }
  const provided = req.headers.get("x-nexuscore-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ success: false, error: "Unauthorized webhook." }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const flat = JSON.stringify(body);
    const candidates = new Set<string>();

    // Collect every plausible bot id from whatever shape Attendee sends.
    const direct = [body.bot_id, body.id, (body.bot as Record<string, unknown> | undefined)?.id];
    for (const v of direct) {
      if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) candidates.add(v);
    }
    for (const m of flat.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)) {
      candidates.add(m[0]);
    }

    if (candidates.size === 0) {
      console.warn("[attendee-webhook] no bot id found in payload; acknowledged.");
      return NextResponse.json({ success: true, ignored: true });
    }

    const db = createSupabaseServiceClient();
    let handled = 0;
    for (const attendeeBotId of candidates) {
      const { data: row } = await db
        .from("meeting_bots")
        .select("*")
        .eq("attendee_bot_id", attendeeBotId)
        .maybeSingle();
      if (row && (row as MeetingBotRow).ingest_status === "pending") {
        await syncMeetingBot(row as MeetingBotRow);
        handled++;
      }
    }

    return NextResponse.json({ success: true, handled });
  } catch (error: unknown) {
    // Always 200 — Attendee retries on non-2xx and we don't want retry storms.
    console.error("[attendee-webhook] error:", error);
    return NextResponse.json({ success: true, error: "logged" });
  }
}
