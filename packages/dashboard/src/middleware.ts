import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
  "/api/mcp(.*)",
  "/api/migrate(.*)",
  "/api/oauth(.*)",
  "/.well-known(.*)",
]);

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default isHosted
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublicRoute(request)) {
        try {
          const { userId } = await auth();
          if (!userId) {
            const signInUrl = new URL("/sign-in", request.url);
            signInUrl.searchParams.set("redirect_url", request.url);
            return NextResponse.redirect(signInUrl);
          }
        } catch {
          // Clerk dev-mode auth resolution can fail on production domains
          const signInUrl = new URL("/sign-in", request.url);
          signInUrl.searchParams.set("redirect_url", request.url);
          return NextResponse.redirect(signInUrl);
        }
      }
    })
  : function noopMiddleware() {
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
