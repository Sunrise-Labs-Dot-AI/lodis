import { NextResponse } from "next/server";
import { exchangeAuthCode, refreshAccessToken } from "@/lib/oauth";

/**
 * OAuth 2.1 Token Endpoint.
 * Supports grant_type=authorization_code (with PKCE) and grant_type=refresh_token.
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let params: Record<string, string>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      params = Object.fromEntries(formData.entries()) as Record<string, string>;
    } else {
      params = await req.json();
    }

    const grantType = params.grant_type;
    const clientId = params.client_id;

    if (!clientId) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "client_id is required" },
        { status: 400 },
      );
    }

    if (grantType === "authorization_code") {
      const code = params.code;
      const codeVerifier = params.code_verifier;
      const redirectUri = params.redirect_uri;

      if (!code || !codeVerifier || !redirectUri) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "code, code_verifier, and redirect_uri are required" },
          { status: 400 },
        );
      }

      const result = await exchangeAuthCode(code, codeVerifier, clientId, redirectUri);
      if (!result) {
        return NextResponse.json(
          { error: "invalid_grant", error_description: "Invalid, expired, or already-used authorization code" },
          { status: 400 },
        );
      }

      return NextResponse.json({
        access_token: result.accessToken,
        token_type: "bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
        scope: result.scopes,
      });
    }

    if (grantType === "refresh_token") {
      const refreshToken = params.refresh_token;
      if (!refreshToken) {
        return NextResponse.json(
          { error: "invalid_request", error_description: "refresh_token is required" },
          { status: 400 },
        );
      }

      const result = await refreshAccessToken(refreshToken, clientId);
      if (!result) {
        return NextResponse.json(
          { error: "invalid_grant", error_description: "Invalid or revoked refresh token" },
          { status: 400 },
        );
      }

      return NextResponse.json({
        access_token: result.accessToken,
        token_type: "bearer",
        expires_in: result.expiresIn,
        refresh_token: result.refreshToken,
      });
    }

    return NextResponse.json(
      { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported" },
      { status: 400 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "server_error", error_description: message }, { status: 500 });
  }
}
