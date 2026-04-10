import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateToken } from "./auth.js";
import { startServer } from "./server.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

const PORT = parseInt(process.env.ENGRAMS_PORT ?? "3939", 10);

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearer(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/**
 * Get client IP from request (respects X-Forwarded-For for reverse proxies).
 */
function getClientIp(req: IncomingMessage): string | undefined {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim();
  return req.socket.remoteAddress;
}

export async function startCloudServer() {
  // Validate environment
  if (!process.env.TURSO_DATABASE_URL) {
    process.stderr.write("[engrams] Error: TURSO_DATABASE_URL is required for cloud mode\n");
    process.exit(1);
  }

  // Per-session transports keyed by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check
    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: "cloud" }));
      return;
    }

    // Only handle /mcp path
    if (!url.startsWith("/mcp")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // --- Auth middleware ---
    const token = extractBearer(req);
    if (!token) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing Authorization header. Use: Bearer <your-api-token>" }));
      return;
    }

    const ip = getClientIp(req);
    const validation = await validateToken(token, ip);
    if (!validation) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or expired token" }));
      return;
    }

    // Set auth info on request for SDK propagation
    const authInfo: AuthInfo = {
      token,
      clientId: validation.userId,
      scopes: validation.scopes,
      extra: { userId: validation.userId },
    };
    (req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo;

    // --- Session management ---
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST" && !sessionId) {
      // New session — create transport and MCP server
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => `${validation.userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      // Start MCP server connected to this transport
      // startServer returns the server — we call connect on it
      const server = await startServer({ transport });

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
      }

      await transport.handleRequest(req, res);
      return;
    }

    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found. Start a new session with a POST without Mcp-Session-Id." }));
        return;
      }

      // Verify the session belongs to this user
      if (!sessionId.startsWith(validation.userId)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session does not belong to this user" }));
        return;
      }

      await transport.handleRequest(req, res);
      return;
    }

    // GET/DELETE without session ID
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Mcp-Session-Id header required for GET and DELETE requests" }));
  });

  httpServer.listen(PORT, () => {
    process.stderr.write(`[engrams] Cloud MCP server listening on port ${PORT}\n`);
    process.stderr.write(`[engrams] POST/GET/DELETE /mcp — Streamable HTTP transport\n`);
    process.stderr.write(`[engrams] GET /health — Health check\n`);
  });

  return httpServer;
}
