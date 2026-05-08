import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/not-invited(.*)",
  "/api/health",
  "/api/mcp(.*)",
  "/api/migrate(.*)",
  "/api/oauth(.*)",
  "/.well-known(.*)",
]);

const isHosted = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Email allowlist for private beta. When LODIS_ALLOWED_EMAILS is set
 * (comma-separated list), only signed-in users whose primary email is on
 * the list can access non-public routes. Empty/unset = no restriction.
 *
 * Email is read from the Clerk session token claim `primary_email`. This
 * claim must be configured in Clerk dashboard:
 *   Sessions → Customize session token → add
 *   { "primary_email": "{{user.primary_email_address}}" }
 *
 * If the claim is missing on a session, the user is treated as
 * NOT-allowlisted (fail-secure) and bounced to /not-invited.
 */
function parseAllowlist(): Set<string> | null {
  const raw = process.env.LODIS_ALLOWED_EMAILS;
  if (!raw) return null;
  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return null;
  return new Set(entries);
}

export default isHosted
  ? clerkMiddleware(async (auth, request) => {
      if (isPublicRoute(request)) return;

      let userId: string | null;
      let sessionClaims: Record<string, unknown> | null;
      try {
        const result = await auth();
        userId = result.userId;
        sessionClaims = result.sessionClaims as Record<string, unknown> | null;
      } catch {
        // Clerk dev-mode auth resolution can fail on production domains
        const signInUrl = new URL("/sign-in", request.url);
        signInUrl.searchParams.set("redirect_url", request.url);
        return NextResponse.redirect(signInUrl);
      }

      if (!userId) {
        const signInUrl = new URL("/sign-in", request.url);
        signInUrl.searchParams.set("redirect_url", request.url);
        return NextResponse.redirect(signInUrl);
      }

      const allowlist = parseAllowlist();
      if (allowlist) {
        const email =
          typeof sessionClaims?.primary_email === "string"
            ? (sessionClaims.primary_email as string).trim().toLowerCase()
            : null;
        if (!email || !allowlist.has(email)) {
          // Fail-secure: missing claim or unlisted email → bounce.
          // Note: /not-invited is in the public-route list above, so this
          // redirect doesn't loop.
          const notInvitedUrl = new URL("/not-invited", request.url);
          return NextResponse.redirect(notInvitedUrl);
        }
      }
    })
  : function noopMiddleware() {
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
