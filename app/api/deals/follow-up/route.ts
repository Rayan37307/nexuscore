import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });

    const { dealId, followUpDraft } = (await req.json()) as {
      dealId?: string;
      followUpDraft?: string;
    };

    if (!dealId || typeof followUpDraft !== "string") {
      return NextResponse.json(
        { success: false, error: "dealId and followUpDraft are required." },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("deals")
      .update({ follow_up_draft: followUpDraft, updated_at: new Date().toISOString() })
      .eq("id", dealId)
      .eq("user_id", user.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Save failed" },
      { status: 500 },
    );
  }
}
