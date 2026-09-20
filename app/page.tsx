import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getDealsForUser } from "@/lib/data/deals";
import { BoardClient } from "@/components/board/board-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <h1 className="text-lg font-semibold text-amber-900">Environment setup required</h1>
          <p className="mt-2 text-sm text-amber-800">
            Copy <code className="rounded bg-amber-100 px-1">.env.example</code> to{" "}
            <code className="rounded bg-amber-100 px-1">.env.local</code> and add your free Supabase
            and Groq keys. Then re-run <code className="rounded bg-amber-100 px-1">npm run dev</code>.
          </p>
          <p className="mt-3 text-xs text-amber-700">
            See the README deployment guide — the whole stack runs on free tiers.
          </p>
        </div>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const deals = await getDealsForUser(supabase, user.id);

  return <BoardClient initialDeals={deals} userId={user.id} />;
}
