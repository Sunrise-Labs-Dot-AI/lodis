import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getRegisteredClient, createAuthCode } from "@/lib/oauth";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.getengrams.com";

/**
 * OAuth 2.1 Authorization Endpoint.
 *
 * GET: Claude.ai (or any MCP client) redirects the user here.
 * If the user is signed in via Clerk, we auto-approve and redirect back with a code.
 * If not signed in, we redirect to Clerk sign-in first.
 *
 * POST: Handles the consent form submission (approve/deny).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";
  const state = url.searchParams.get("state");
  const scope = url.searchParams.get("scope") || "mcp:full";

  // Validate required params
  if (responseType !== "code") {
    return NextResponse.json(
      { error: "unsupported_response_type", error_description: "Only response_type=code is supported" },
      { status: 400 },
    );
  }

  if (!clientId || !redirectUri || !codeChallenge) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "client_id, redirect_uri, and code_challenge are required" },
      { status: 400 },
    );
  }

  // Validate the client is registered
  const client = await getRegisteredClient(clientId);
  if (!client) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Unknown client_id" },
      { status: 400 },
    );
  }

  // Validate redirect_uri matches registration
  if (!client.redirectUris.includes(redirectUri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri does not match registered URIs" },
      { status: 400 },
    );
  }

  // Check if user is authenticated via Clerk
  const { userId } = await auth();

  if (!userId) {
    // Not signed in — redirect to Clerk sign-in, then back here
    const returnUrl = url.toString();
    const signInUrl = new URL("/sign-in", BASE_URL);
    signInUrl.searchParams.set("redirect_url", returnUrl);
    return NextResponse.redirect(signInUrl.toString());
  }

  // User is authenticated — show consent page
  // For now, render a simple HTML consent page inline.
  // In a more polished version, this would be a proper React page.
  const consentHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize — Engrams</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0e1a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(125, 211, 252, 0.15);
      border-radius: 16px;
      padding: 2rem;
      max-width: 420px;
      width: 100%;
      backdrop-filter: blur(20px);
    }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .app-name { color: #7dd3fc; font-weight: 600; }
    .scopes {
      background: rgba(125, 211, 252, 0.08);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin: 1rem 0;
      font-size: 0.875rem;
    }
    .scopes li { margin: 0.25rem 0; list-style: none; }
    .scopes li::before { content: "\\2713 "; color: #7dd3fc; }
    .desc { font-size: 0.875rem; color: #94a3b8; margin-bottom: 1.5rem; }
    .buttons { display: flex; gap: 0.75rem; }
    button {
      flex: 1;
      padding: 0.625rem 1rem;
      border-radius: 8px;
      border: none;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.9; }
    .approve {
      background: linear-gradient(135deg, #7dd3fc, #a78bfa);
      color: #0a0e1a;
    }
    .deny {
      background: rgba(255, 255, 255, 0.08);
      color: #e2e8f0;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .spinner {
      display: inline-block;
      width: 14px; height: 14px;
      border: 2px solid rgba(10, 14, 26, 0.3);
      border-top-color: #0a0e1a;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize <span class="app-name">${escapeHtml(client.clientName || "MCP Client")}</span></h1>
    <p class="desc">This application wants to access your Engrams memories.</p>
    <ul class="scopes">
      <li>Read and search your memories</li>
      <li>Create and update memories</li>
      <li>Manage memory connections</li>
      <li>Set agent permissions</li>
    </ul>
    <form method="POST" action="${BASE_URL}/api/oauth/authorize" onsubmit="handleSubmit(event)">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}" />
      <input type="hidden" name="state" value="${escapeHtml(state || "")}" />
      <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
      <div class="buttons">
        <button type="submit" name="action" value="deny" class="deny">Deny</button>
        <button type="submit" name="action" value="approve" class="approve" id="approve-btn">Allow Access</button>
      </div>
    </form>
  </div>
  <script>
    function handleSubmit(e) {
      var clicked = e.submitter;
      if (clicked && clicked.value === 'approve') {
        var btn = document.getElementById('approve-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Authorizing\u2026';
        document.querySelector('.deny').disabled = true;
      }
    }
  </script>
</body>
</html>`;

  return new NextResponse(consentHtml, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Handle consent form submission.
 */
export async function POST(req: Request) {
  const formData = await req.formData();
  const action = formData.get("action") as string;
  const clientId = formData.get("client_id") as string;
  const redirectUri = formData.get("redirect_uri") as string;
  const codeChallenge = formData.get("code_challenge") as string;
  const codeChallengeMethod = formData.get("code_challenge_method") as string;
  const state = formData.get("state") as string;
  const scope = formData.get("scope") as string || "mcp:full";

  if (action === "deny") {
    const denyUrl = new URL(redirectUri);
    denyUrl.searchParams.set("error", "access_denied");
    if (state) denyUrl.searchParams.set("state", state);
    return NextResponse.redirect(denyUrl.toString(), 302);
  }

  // User approved — get their Clerk userId
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse(renderMessagePage(
      "Session Expired",
      "Your session has expired. Please close this tab and try connecting again.",
    ), { status: 401, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // Generate auth code
  let code: string;
  try {
    code = await createAuthCode({
      clientId,
      userId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scopes: scope,
    });
  } catch {
    return new NextResponse(renderMessagePage(
      "Something Went Wrong",
      "Authorization failed. Please close this tab and try again.",
    ), { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);

  // Show success interstitial before redirecting
  return new NextResponse(renderMessagePage(
    "Authorization Successful",
    "Redirecting back to your application\u2026",
    callbackUrl.toString(),
  ), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Render a styled message page (success interstitial, error, or session expired).
 * If redirectUrl is provided, auto-redirects after 1.5s.
 */
function renderMessagePage(title: string, message: string, redirectUrl?: string): string {
  const redirectMeta = redirectUrl
    ? `<meta http-equiv="refresh" content="1;url=${escapeHtml(redirectUrl)}" />`
    : "";
  const redirectScript = redirectUrl
    ? `<script>setTimeout(function(){window.location.href=${JSON.stringify(redirectUrl)};},1500);</script>`
    : "";
  const isSuccess = !!redirectUrl;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — Engrams</title>
  ${redirectMeta}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0e1a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(125, 211, 252, 0.15);
      border-radius: 16px;
      padding: 2rem;
      max-width: 420px;
      width: 100%;
      backdrop-filter: blur(20px);
      text-align: center;
    }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .msg { font-size: 0.875rem; color: #94a3b8; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? "&#10003;" : "&#9888;"}</div>
    <h1>${escapeHtml(title)}</h1>
    <p class="msg">${escapeHtml(message)}</p>
  </div>
  ${redirectScript}
</body>
</html>`;
}
