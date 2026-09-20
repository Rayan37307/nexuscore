import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerWithDealMemory } from "@/lib/groq";
import { searchDealMemory, type MemoryHit } from "@/lib/ingest";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });

    const { dealId, question } = (await req.json()) as { dealId?: string; question?: string };
    if (!dealId || !question?.trim()) {
      return NextResponse.json(
        { success: false, error: "dealId and question are required." },
        { status: 400 },
      );
    }

    // RLS check: the caller must own this deal before we spend Groq tokens.
    const { data: deal } = await supabase
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .eq("user_id", user.id)
      .single();
    if (!deal) {
      return NextResponse.json({ success: false, error: "Deal not found." }, { status: 404 });
    }

    const hits: MemoryHit[] = await searchDealMemory(dealId, question, 6);
    if (hits.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          answer: "No conversation memory found for this deal yet. Ingest a transcript or email first.",
          citations: [],
        },
      });
    }

    const answer = await answerWithDealMemory(
      question,
      hits.map((h) => ({ content: h.content_chunk, occurred_at: null })),
    );

    return NextResponse.json({ success: true, data: { answer, citations: hits } });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Memory search failed" },
      { status: 500 },
    );
  }
}
