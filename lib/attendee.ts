import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ingestInteraction } from "@/lib/ingest";

/**
 * Attendee (attendee.dev) meeting-bot integration — Module A auto-capture.
 *
 * A bot is launched at a meeting URL (Zoom / Google Meet / Teams), records and
 * transcribes the call, and the finished transcript flows through the standard
 * ingest pipeline (sanitize → extract → deal update → memory → agents) exactly
 * like a pasted transcript.
 *
 * Auth: `Authorization: Token <key>` against the hosted instance or a
 * self-hosted one (ATTENDEE_BASE_URL).
 *
 * Sync strategy: polling is the primary path (GET /api/attendee/bots?sync=1)
 * so local development works without a public webhook URL; /api/attendee/
 * webhook is a tolerant secondary for production deployments.
 */

const BASE_URL = (process.env.ATTENDEE_BASE_URL ?? "https://app.attendee.dev/api/v1").replace(
  /\/+$/,
  "",
);

export interface AttendeeUtterance {
  speaker_name?: string | { name?: string; display_name?: string } | null;
  speaker?: string | { name?: string; display_name?: string } | null;
  timestamp_ms?: number | string | null;
  duration_ms?: number | string | null;
  transcription?: unknown;
  transcript?: unknown;
  text?: string | null;
  words?: unknown[] | null;
  [key: string]: unknown;
}

export interface AttendeeBotState {
  id: string;
  meeting_url: string;
  state: string;
  transcription_state?: string;
}

export interface MeetingBotRow {
  id: string;
  user_id: string;
  deal_id: string | null;
  attendee_bot_id: string;
  meeting_url: string;
  bot_name: string | null;
  status: string;
  ingest_status: "pending" | "ingested" | "failed";
  error_message: string | null;
  created_at: string;
}

export function attendeeConfigured(): boolean {
  return Boolean(process.env.ATTENDEE_API_KEY);
}

async function attendeeCall<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.ATTENDEE_API_KEY;
  if (!key) {
    throw new Error("ATTENDEE_API_KEY is not set — add your attendee.dev key to .env.local.");
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Attendee API ${res.status} on ${path}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function createAttendeeBot(input: {
  meetingUrl: string;
  botName?: string;
  joinAt?: string | null;
  webhookUrl?: string | null;
}): Promise<AttendeeBotState> {
  const body: Record<string, unknown> = {
    meeting_url: input.meetingUrl,
    bot_name: input.botName?.trim() || "NexusCore Notetaker",
  };
  if (input.joinAt) body.join_at = input.joinAt;
  if (input.webhookUrl) body.webhook_url = input.webhookUrl;
  return attendeeCall<AttendeeBotState>("/bots", { method: "POST", body: JSON.stringify(body) });
}

export async function getAttendeeBot(id: string): Promise<AttendeeBotState> {
  return attendeeCall<AttendeeBotState>(`/bots/${id}`);
}

export async function getAttendeeTranscript(id: string): Promise<AttendeeUtterance[]> {
  const raw = await attendeeCall<unknown>(`/bots/${id}/transcript`);
  if (Array.isArray(raw)) return raw as AttendeeUtterance[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidates = [obj.transcript, obj.utterances, obj.transcription, obj.results, obj.data, obj.segments, obj.chunks];
    for (const c of candidates) {
      if (Array.isArray(c)) return c as AttendeeUtterance[];
    }
  }
  return [];
}

function extractUtteranceText(u: unknown): string {
  if (typeof u === "string") return u.trim();
  if (!u || typeof u !== "object") return "";

  const obj = u as Record<string, unknown>;
  const raw = obj.transcription ?? obj.transcript ?? obj.text ?? obj.content ?? obj.message ?? obj.speech;

  if (typeof raw === "string") return raw.trim();

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const itemObj = item as Record<string, unknown>;
          return (
            (typeof itemObj.punctuated_word === "string" && itemObj.punctuated_word.trim()) ||
            (typeof itemObj.word === "string" && itemObj.word.trim()) ||
            (typeof itemObj.text === "string" && itemObj.text.trim()) ||
            (typeof itemObj.transcript === "string" && itemObj.transcript.trim()) ||
            (typeof itemObj.transcription === "string" && itemObj.transcription.trim()) ||
            ""
          );
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (raw && typeof raw === "object") {
    const rawObj = raw as Record<string, unknown>;
    if (typeof rawObj.text === "string") return rawObj.text.trim();
    if (typeof rawObj.transcript === "string") return rawObj.transcript.trim();
    if (typeof rawObj.transcription === "string") return rawObj.transcription.trim();
    if (typeof rawObj.content === "string") return rawObj.content.trim();
    if (Array.isArray(rawObj.words)) {
      return extractUtteranceText({ words: rawObj.words });
    }
  }

  if (Array.isArray(obj.words)) {
    return obj.words
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const itemObj = item as Record<string, unknown>;
          return (
            (typeof itemObj.punctuated_word === "string" && itemObj.punctuated_word.trim()) ||
            (typeof itemObj.word === "string" && itemObj.word.trim()) ||
            (typeof itemObj.text === "string" && itemObj.text.trim()) ||
            ""
          );
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  return "";
}

function extractSpeakerName(u: unknown): string {
  if (!u || typeof u !== "object") return "Unknown";
  const obj = u as Record<string, unknown>;
  const raw = obj.speaker_name ?? obj.speaker ?? obj.name ?? obj.speaker_uuid;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object") {
    const nameObj = raw as Record<string, unknown>;
    if (typeof nameObj.name === "string" && nameObj.name.trim()) return nameObj.name.trim();
    if (typeof nameObj.display_name === "string" && nameObj.display_name.trim()) return nameObj.display_name.trim();
  }
  return "Unknown";
}

function extractTimestampMs(u: unknown): number {
  if (!u || typeof u !== "object") return 0;
  const obj = u as Record<string, unknown>;
  const raw = obj.timestamp_ms ?? obj.start_ms ?? obj.start_time_ms ?? obj.offset_ms ?? obj.timestamp;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof obj.start === "number" && !Number.isNaN(obj.start)) {
    return Math.round(obj.start * 1000);
  }
  if (typeof obj.start_time === "number" && !Number.isNaN(obj.start_time)) {
    return Math.round(obj.start_time * 1000);
  }
  return 0;
}

/** Attendee transcript → labeled dialogue with timestamps, ready for extraction. */
export function transcriptToText(utterances: unknown): string {
  if (typeof utterances === "string") return utterances.trim().slice(0, 200_000);
  if (!utterances) return "";

  let list: unknown[] = [];
  if (Array.isArray(utterances)) {
    list = utterances;
  } else if (typeof utterances === "object") {
    const obj = utterances as Record<string, unknown>;
    if (typeof obj.text === "string" && obj.text.trim()) return obj.text.trim().slice(0, 200_000);
    if (typeof obj.transcript === "string" && obj.transcript.trim()) return obj.transcript.trim().slice(0, 200_000);
    if (typeof obj.transcription === "string" && obj.transcription.trim()) return obj.transcription.trim().slice(0, 200_000);

    const candidates = [obj.transcript, obj.utterances, obj.transcription, obj.results, obj.data, obj.segments, obj.chunks];
    for (const c of candidates) {
      if (Array.isArray(c)) {
        list = c;
        break;
      }
    }
  }

  if (!list.length) return "";

  const lines = list
    .map((u) => {
      if (typeof u === "string") return u.trim();
      const text = extractUtteranceText(u);
      if (!text) return null;
      const who = extractSpeakerName(u);
      const tsMs = extractTimestampMs(u);
      const min = Math.floor(tsMs / 60_000);
      const sec = Math.floor((tsMs % 60_000) / 1000);
      const ts = tsMs > 0 ? `[${min}:${String(sec).padStart(2, "0")}] ` : "";
      return `${ts}${who}: ${text}`;
    })
    .filter((l): l is string => Boolean(l && l.trim()));

  return lines.join("\n").slice(0, 200_000);
}

/**
 * Poll one mapped bot; when its meeting has ended and the transcript is
 * complete, run the full ingest pipeline. Never throws for "not ready yet" —
 * only hard failures are marked on the row. Safe to call repeatedly.
 */
export async function syncMeetingBot(row: MeetingBotRow): Promise<MeetingBotRow> {
  const db = createSupabaseServiceClient();

  if (row.ingest_status === "ingested" || row.status === "data_deleted" || row.status === "fatal_error") {
    return row;
  }

  let remote: AttendeeBotState;
  try {
    remote = await getAttendeeBot(row.attendee_bot_id);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Attendee API call failed";
    const { data } = await db
      .from("meeting_bots")
      .update({ status: "fatal_error", ingest_status: "failed", error_message: message })
      .eq("id", row.id)
      .select()
      .single();
    return (data as MeetingBotRow | null) ?? { ...row, status: "fatal_error", ingest_status: "failed", error_message: message };
  }

  const patch: Partial<MeetingBotRow> = { status: remote.state };

  if (
    remote.state === "ended" &&
    (remote.transcription_state ?? "complete") === "complete"
  ) {
    try {
      const utterances = await getAttendeeTranscript(row.attendee_bot_id);
      const text = transcriptToText(utterances);
      if (text.trim().length < 40) {
        throw new Error(
          "Attendee transcript is empty — check the transcription provider (Settings) in your Attendee dashboard.",
        );
      }
      await ingestInteraction({
        content: text,
        type: "meeting_transcript",
        userId: row.user_id,
        dealId: row.deal_id,
        sourceIdentifier: `attendee:${row.attendee_bot_id}`,
      });
      patch.ingest_status = "ingested";
      patch.error_message = null;
    } catch (error: unknown) {
      patch.ingest_status = "failed";
      patch.error_message = error instanceof Error ? error.message : "Transcript ingestion failed";
    }
  }

  await db.from("meeting_bots").update(patch).eq("id", row.id);
  return { ...row, ...patch };
}
