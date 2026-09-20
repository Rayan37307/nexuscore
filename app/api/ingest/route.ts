import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ingestInteraction } from "@/lib/ingest";
import { STT_MODEL, getGroq } from "@/lib/groq";

export const maxDuration = 300;

const MAX_TEXT_CHARS = 200_000;

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/** Transcribe audio with Groq Whisper large-v3 (free tier). */
async function transcribeAudio(audio: File): Promise<string> {
  const groq = getGroq();
  const bytes = await audio.arrayBuffer();
  const json = await groq.audio.transcriptions.create({
    file: new File([bytes], audio.name, { type: audio.type || "audio/mpeg" }),
    model: STT_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const anyJson = json as unknown as {
    text?: string;
    segments?: { text: string }[];
  };

  if (anyJson.segments?.length) {
    // Light speaker-attribution heuristic from segment boundaries (Whisper is
    // not diarized; segments give usable speaker-turn separation).
    return anyJson.segments
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join("\n");
  }
  return anyJson.text ?? "";
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return errorResponse("Not authenticated.", 401);

    const form = await req.formData();
    const audio = form.get("audio");
    const content = form.get("content");
    const type = (form.get("type") as string) || "meeting_transcript";
    const sourceIdentifier = (form.get("sourceIdentifier") as string) || null;
    const dealId = (form.get("dealId") as string) || null;
    const currentStage = (form.get("currentStage") as string) || undefined;

    let text: string | null = null;

    if (audio instanceof File) {
      text = await transcribeAudio(audio);
      if (!text.trim()) {
        return errorResponse("Whisper returned an empty transcript for this audio.", 422);
      }
    } else if (typeof content === "string") {
      text = content;
    }

    if (!text) return errorResponse("Provide `content` (text) or `audio` (file).");
    if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);

    const result = await ingestInteraction({
      content: text,
      type: type as "meeting_transcript" | "email" | "call_recording" | "note",
      userId: user.id,
      sourceIdentifier,
      dealId,
      currentStage: currentStage as never,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("[ingest] failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Ingestion failed" },
      { status: 500 },
    );
  }
}
