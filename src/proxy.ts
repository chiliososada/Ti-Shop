import type { NextProxy } from "next/server";
import { NextResponse } from "next/server";

import { resolvePublicSiteOrigin } from "@/lib/site-url";
import {
  findActivePublicRedirect,
  recordPublicRedirectHit,
} from "@/server/seo/public-redirects";
import {
  buildRedirectDestination,
  isRedirectablePublicPath,
} from "@/server/seo/redirect-policy";

export const proxy: NextProxy = async (request, event) => {
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    !isRedirectablePublicPath(request.nextUrl.pathname)
  ) {
    return NextResponse.next();
  }

  try {
    const redirect = await findActivePublicRedirect(request.nextUrl.pathname);
    if (!redirect) return NextResponse.next();

    const destination = buildRedirectDestination(
      request.url,
      redirect.destinationPath,
      redirect.preserveQuery,
      resolvePublicSiteOrigin(),
    );
    event.waitUntil(recordPublicRedirectHit(redirect.id));
    return NextResponse.redirect(destination, redirect.statusCode);
  } catch (error) {
    console.error("Public redirect lookup failed open.", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.next();
  }
};

export const config = {
  matcher: [
    "/((?!api|admin|account|checkout|static|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
