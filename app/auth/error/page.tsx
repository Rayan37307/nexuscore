export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Sign-in problem</h1>
        <p className="mt-2 text-sm text-slate-500">
          The sign-in link was invalid or has expired. Magic links and OAuth codes are single-use —
          please try again from the login page.
        </p>
        <a
          href="/login"
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
        >
          Back to login
        </a>
      </div>
    </div>
  );
}
