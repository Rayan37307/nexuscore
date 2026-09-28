import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getDealsForUser } from "@/lib/data/deals";
import { BoardClient } from "@/components/board/board-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#090d16] p-4 text-slate-100">
        <div className="max-w-md rounded-2xl border border-amber-500/30 bg-amber-950/30 p-7 text-center shadow-2xl backdrop-blur-md">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-950/80 text-amber-400 border border-amber-500/30">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h1 className="text-base font-bold text-white">Environment setup required</h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            Copy <code className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-amber-300">.env.example</code> to{" "}
            <code className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-amber-300">.env.local</code> and add your Supabase
            and Groq keys. Then re-run <code className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-amber-300">npm run dev</code>.
          </p>
          <p className="mt-3 text-[11px] text-slate-400">
            See the README deployment guide — runs seamlessly on free tiers.
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
