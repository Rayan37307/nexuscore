import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { STAGE_VALUES, type DealStage } from "@/lib/constants";

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });

    const body = await req.json();
    const { dealId, stage, winProbability, amount } = body as {
      dealId?: string;
      stage?: DealStage;
      winProbability?: number;
      amount?: number;
    };

    if (!dealId) {
      return NextResponse.json({ success: false, error: "dealId is required." }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (stage !== undefined) {
      if (!STAGE_VALUES.includes(stage)) {
        return NextResponse.json({ success: false, error: `Invalid stage: ${stage}` }, { status: 400 });
      }
      patch.stage = stage;
    }
    if (winProbability !== undefined) {
      if (!Number.isFinite(winProbability) || winProbability < 0 || winProbability > 100) {
        return NextResponse.json({ success: false, error: "winProbability must be 0-100." }, { status: 400 });
      }
      patch.win_probability = Math.round(winProbability);
    }
    if (amount !== undefined) {
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ success: false, error: "amount must be >= 0." }, { status: 400 });
      }
      patch.amount = amount;
    }

    const { error } = await supabase
      .from("deals")
      .update(patch)
      .eq("id", dealId)
      .eq("user_id", user.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
