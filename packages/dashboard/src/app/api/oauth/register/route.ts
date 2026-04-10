import { NextResponse } from "next/server";
import { registerClient } from "@/lib/oauth";

/**
 * Dynamic Client Registration (RFC 7591)
 * Public endpoint — no auth required.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const redirectUris = body.redirect_uris as string[] | undefined;
    const clientName = body.client_name as string | undefined;

    if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
      return NextResponse.json(
        { error: "invalid_client_metadata", error_description: "redirect_uris is required" },
        { status: 400 },
      );
    }

    // Validate all redirect URIs are valid URLs
    for (const uri of redirectUris) {
      try {
        new URL(uri);
      } catch {
        return NextResponse.json(
          { error: "invalid_redirect_uri", error_description: `Invalid redirect URI: ${uri}` },
          { status: 400 },
        );
      }
    }

    const registered = await registerClient(redirectUris, clientName);

    return NextResponse.json({
      client_id: registered.clientId,
      client_secret: registered.clientSecret,
      redirect_uris: registered.redirectUris,
      client_name: registered.clientName,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: registered.clientSecret ? "client_secret_post" : "none",
    }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "server_error", error_description: message }, { status: 500 });
  }
}
