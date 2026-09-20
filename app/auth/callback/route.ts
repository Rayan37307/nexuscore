import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  const next = requestUrl.searchParams.get("next") ?? "/";

  if (oauthError) {
    return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(oauthError)}`, requestUrl.origin));
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", requestUrl.origin));
    }
    return NextResponse.redirect(new URL(`/auth/error?reason=exchange_failed`, requestUrl.origin));
  }

  return NextResponse.redirect(new URL("/auth/error?reason=missing_code", requestUrl.origin));
}
