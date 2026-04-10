import { validateAccessToken } from "@/lib/oauth";
import { handleMcpRequest, unauthorizedResponse } from "engrams/serverless";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.getengrams.com";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

export async function GET(req: Request) {
  return handleAuthedRequest(req);
}

export async function POST(req: Request) {
  return handleAuthedRequest(req);
}

export async function DELETE(req: Request) {
  return handleAuthedRequest(req);
}

async function handleAuthedRequest(req: Request): Promise<Response> {
  // Extract Bearer token
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    const res = unauthorizedResponse(BASE_URL);
    // Add CORS headers to the 401 response
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders())) {
      headers.set(k, v);
    }
    return new Response(res.body, { status: res.status, headers });
  }

  const token = authHeader.slice(7);
  const validation = await validateAccessToken(token);
  if (!validation) {
    return new Response(
      JSON.stringify({ error: "Invalid or expired token" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      },
    );
  }

  // Delegate to the MCP server handler
  const response = await handleMcpRequest(req, {
    userId: validation.userId,
    scopes: validation.scopes,
  });

  // Append CORS headers to the MCP response
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    headers.set(k, v);
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
