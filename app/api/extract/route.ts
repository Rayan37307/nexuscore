import { NextRequest, NextResponse } from "next/server";
import { extractDealIntelligence } from "@/lib/groq";
import { STAGE_VALUES, type DealStage } from "@/lib/constants";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { transcript, currentStage } = await req.json();

    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json(
        { success: false, error: "Request body must include a `transcript` string." },
        { status: 400 },
      );
    }

    const stage: DealStage =
      currentStage && STAGE_VALUES.includes(currentStage) ? currentStage : "discovery";

    // zod-validated, prompt-locked extraction (lib/groq.ts).
    const data = await extractDealIntelligence(transcript, stage);

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Extraction failed" },
      { status: 500 },
    );
  }
}
