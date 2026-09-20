import type { SupabaseClient } from "@supabase/supabase-js";
import type { Deal } from "@/lib/types";

export interface BoardStats {
  openCount: number;
  openValue: number;
  weightedPipeline: number;
  wonValue: number;
}

/** All deals for the current user, newest interaction first. RLS enforces ownership. */
export async function getDealsForUser(supabase: SupabaseClient, userId: string): Promise<Deal[]> {
  const { data, error } = await supabase
    .from("deals")
    .select("*, company:companies(id, name)")
    .eq("user_id", userId)
    .order("last_interaction_date", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`Failed to load deals: ${error.message}`);
  return (data ?? []) as unknown as Deal[];
}
