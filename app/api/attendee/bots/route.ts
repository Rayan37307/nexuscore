import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  attendeeConfigured,
  createAttendeeBot,
  syncMeetingBot,
  type MeetingBotRow,
} from "@/lib/attendee";

export const maxDuration = 300;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/** GET /api/attendee/bots — list my bots; ?sync=1 polls Attendee and ingests finished transcripts. */
export async function GET(req: NextRequest) {
  if (!attendeeConfigured()) {
    return errorResponse("ATTENDEE_API_KEY is not set.", 503);
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("Not authenticated.", 401);

  const db = createSupabaseServiceClient();
  const { data: rows, error } = await db
    .from("meeting_bots")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return errorResponse(error.message, 500);

  const shouldSync = req.nextUrl.searchParams.get("sync") === "1";
  const synced: MeetingBotRow[] = [];
  if (shouldSync && rows) {
    for (const row of rows as MeetingBotRow[]) {
      if (row.ingest_status !== "ingested") {
        synced.push(await syncMeetingBot(row));
      } else {
        synced.push(row);
      }
    }
  }

  return NextResponse.json({ success: true, data: synced.length ? synced : (rows ?? []) });
}

/** POST /api/attendee/bots — launch a bot at a meeting URL and map it to this user. */
export async function POST(req: NextRequest) {
  if (!attendeeConfigured()) {
    return errorResponse("ATTENDEE_API_KEY is not set — add it to .env.local.", 503);
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("Not authenticated.", 401);

  let body: { meetingUrl?: string; botName?: string; dealId?: string; joinAt?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Body must be JSON.");
  }

  const meetingUrl = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
  if (!/^https?:\/\//i.test(meetingUrl)) {
    return errorResponse("Provide a valid meeting URL (Zoom, Google Meet, or Teams link).");
  }

  // Optional attach-to-deal, validated against the caller's own deals.
  let dealId: string | null = null;
  if (typeof body.dealId === "string" && body.dealId) {
    const db = createSupabaseServiceClient();
    const { data: deal } = await db
      .from("deals")
      .select("id")
      .eq("id", body.dealId)
      .eq("user_id", user.id)
      .single();
    if (!deal) return errorResponse("Deal not found for this user.", 404);
    dealId = deal.id;
  }

  const bot = await createAttendeeBot({
    meetingUrl,
    botName: body.botName,
    joinAt: body.joinAt ?? null,
  });

  const db = createSupabaseServiceClient();
  const { data: row, error } = await db
    .from("meeting_bots")
    .insert({
      user_id: user.id,
      deal_id: dealId,
      attendee_bot_id: bot.id,
      meeting_url: meetingUrl,
      bot_name: body.botName?.trim() || "NexusCore Notetaker",
      status: bot.state,
    })
    .select()
    .single();
  if (error || !row) return errorResponse(`Mapping save failed: ${error?.message}`, 500);

  return NextResponse.json({ success: true, data: row });
}
