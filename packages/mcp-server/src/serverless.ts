/**
 * Serverless MCP handler for Vercel / Next.js API routes.
 *
 * Uses WebStandardStreamableHTTPServerTransport in stateless mode —
 * each request gets a fresh MCP server instance. Compatible with
 * Vercel serverless functions, Cloudflare Workers, and any environment
 * that uses the Web Fetch API (Request/Response).
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { startServer } from "./server.js";

export interface McpRequestOptions {
  /** Clerk/OAuth userId to scope all memory operations */
  userId: string;
  /** OAuth scopes (default: ["mcp:full"]) */
  scopes?: string[];
}

/**
 * Handle a single MCP request in a stateless, serverless context.
 *
 * Creates a fresh WebStandardStreamableHTTPServerTransport and MCP server
 * per request. The userId is injected as AuthInfo so that the server's
 * tool handlers can scope operations to the authenticated user.
 */
export async function handleMcpRequest(
  req: Request,
  options: McpRequestOptions,
): Promise<Response> {
  // Stateless mode — no session management
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Start MCP server with this transport (registers all 18 tools + resources)
  // Pass Turso credentials so createDatabase() doesn't try to create a local file
  await startServer({
    transport,
    dbUrl: process.env.TURSO_DATABASE_URL,
    dbAuthToken: process.env.TURSO_AUTH_TOKEN,
    skipEmbeddings: true,
  });

  // Build AuthInfo so tool handlers can extract userId
  const authInfo: AuthInfo = {
    token: "oauth",
    clientId: options.userId,
    scopes: options.scopes ?? ["mcp:full"],
    extra: { userId: options.userId },
  };

  // Handle the request with auth context
  const response = await transport.handleRequest(req, { authInfo });
  return response;
}

/**
 * Build the 401 response per MCP spec when no valid token is present.
 */
export function unauthorizedResponse(baseUrl: string): Response {
  return new Response(
    JSON.stringify({ error: "Authorization required" }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}
