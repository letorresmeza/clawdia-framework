import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function normalizeHost(hostHeader: string | null) {
  return (hostHeader ?? "").split(":")[0].toLowerCase();
}

function isAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

export function middleware(request: NextRequest) {
  const hostname = normalizeHost(request.headers.get("host"));
  const pathname = request.nextUrl.pathname;

  if (isAssetPath(pathname)) {
    return NextResponse.next();
  }

  if (hostname.startsWith("app.")) {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/app";
      return NextResponse.rewrite(url);
    }

    return NextResponse.next();
  }

  const rootHost = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.toLowerCase();
  const appHost = process.env.NEXT_PUBLIC_APP_DOMAIN?.toLowerCase();

  if (
    rootHost &&
    appHost &&
    hostname === rootHost &&
    (pathname === "/app" || pathname.startsWith("/app/"))
  ) {
    const target = request.nextUrl.clone();
    target.host = appHost;
    target.pathname = pathname.replace(/^\/app/, "") || "/";
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
