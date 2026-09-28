export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090d16] p-4 text-slate-100 selection:bg-indigo-500/30">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800/90 bg-slate-900/80 p-7 text-center shadow-2xl backdrop-blur-md">
        <div className="mx-auto mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-950/80 text-rose-400 border border-rose-500/40">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </div>
        <h1 className="text-base font-bold text-white">Sign-in problem</h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          The sign-in link was invalid or has expired. Magic links and OAuth codes are single-use —
          please try again from the login page.
        </p>
        <a
          href="/login"
          className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-indigo-600 px-4 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 hover:from-indigo-600 hover:to-indigo-700"
        >
          Back to login
        </a>
      </div>
    </div>
  );
}
