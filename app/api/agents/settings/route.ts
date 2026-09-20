import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * SOP §3.6 Emergency Stop (kill switch). When agents_paused is TRUE the
 * platform runs in Passive Read-Only Mode: ingestion keeps working, but the
 * agent workforce stops proposing new actions.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });

  const { data, error } = await supabase
    .from("platform_settings")
    .select("agents_paused")
    .eq("id", 1)
    .maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, data: { agents_paused: data?.agents_paused ?? false } });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });

  let body: { agents_paused?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.agents_paused !== "boolean") {
    return NextResponse.json({ success: false, error: "agents_paused must be boolean." }, { status: 400 });
  }

  const { error } = await supabase
    .from("platform_settings")
    .update({ agents_paused: body.agents_paused, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, data: { agents_paused: body.agents_paused } });
}
