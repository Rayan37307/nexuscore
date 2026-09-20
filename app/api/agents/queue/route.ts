import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Human-in-the-loop review queue for the agent workforce (SOP §3.4 Phase 3).
 * GET    → pending + recently reviewed agent proposals (RLS-scoped).
 * PATCH  → Accept / Edit / Reject / Dismiss a card with operator feedback.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });

  const { data, error } = await supabase
    .from("agent_action_queue")
    .select("*, deals(title)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated." }, { status: 401 });

  let body: {
    id?: string;
    action?: "accepted" | "edited" | "rejected" | "dismissed";
    payload?: unknown;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const { id, action, payload, reason } = body;
  if (!id || !action) {
    return NextResponse.json({ success: false, error: "id and action are required." }, { status: 400 });
  }

  const update: Record<string, unknown> = { status: action, reviewed_at: new Date().toISOString() };
  if (action === "edited" && payload !== undefined) update.proposed_payload = payload;
  if ((action === "rejected" || action === "dismissed") && reason) {
    update.rejection_reason = reason;
  }

  const { error } = await supabase
    .from("agent_action_queue")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id); // RLS + explicit owner filter

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
