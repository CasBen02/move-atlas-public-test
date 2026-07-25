import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected =
    pathname === "/setup" ||
    pathname.startsWith("/app") ||
    pathname.startsWith("/account");
  const isAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

  if (!user && isProtected) {
    const target = request.nextUrl.clone();
    target.pathname = "/sign-in";
    target.searchParams.set("next", pathname);
    return NextResponse.redirect(target);
  }

  if (user && isAuthPage) {
    const target = request.nextUrl.clone();
    target.pathname = "/app";
    target.search = "";
    return NextResponse.redirect(target);
  }

  return response;
}
