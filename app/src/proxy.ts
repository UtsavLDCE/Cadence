import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/register");
  const isApiAuth = pathname.startsWith("/api/auth");
  // Integration endpoints authenticate via bearer token (or, for /dispatch, an
  // admin session checked in the handler) — not a session cookie. Let them
  // through the cookie guard so external callers (cron, Power Automate) reach them.
  const isIntegration = pathname.startsWith("/api/integrations");
  const isPublicAsset = pathname.startsWith("/_next") || pathname === "/favicon.ico";

  if (isApiAuth || isIntegration || isPublicAsset) return NextResponse.next();

  const sessionToken =
    req.cookies.get("authjs.session-token")?.value ||
    req.cookies.get("__Secure-authjs.session-token")?.value;

  if (!sessionToken && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (sessionToken && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
