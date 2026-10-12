import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ClientFactory } from "./api.js";
import { RateLimiter } from "./ratelimit.js";
import { createMcpServer, type ServerOptions } from "./server.js";

export interface HttpOptions extends ServerOptions {
  /** Bucket size and refill rate per token. */
  rateLimit?: { capacity: number; perSecond: number };
  now?: () => number;
}

const json = (res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
};

async function readBody(req: IncomingMessage, max = 1_000_000): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += c.length; if (size > max) throw new Error("too large"); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

/**
 * Stateless Streamable HTTP: each POST gets a fresh server bound to the caller's
 * scoped client, so there is no session state that could leak between users.
 */
export function createHttpServer(factory: ClientFactory, opts: HttpOptions = {}): Server {
  const limiter = new RateLimiter(opts.rateLimit?.capacity ?? 30, opts.rateLimit?.perSecond ?? 1, opts.now);
  return createServer(async (req, res) => {
    try {
      if (req.url !== "/mcp") return json(res, 404, "Not found. The MCP endpoint is /mcp.");
      if (req.method !== "POST") return json(res, 405, "Method not allowed; this server is stateless (POST only).", { allow: "POST" });

      const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
      const api = token ? factory(token) : undefined;
      if (!token || !api) return json(res, 401, "Missing or invalid API token.", { "www-authenticate": "Bearer" });

      // Key by hash so raw tokens never sit in memory maps or logs.
      const wait = limiter.take(createHash("sha256").update(token).digest("hex"));
      if (wait > 0) return json(res, 429, `Rate limit exceeded. Retry in ${wait}s.`, { "retry-after": String(wait) });

      let body: unknown;
      try { body = await readBody(req); } catch { return json(res, 400, "Invalid or oversized JSON body."); }

      const server = createMcpServer(api, opts);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error("[http error]", e);
      if (!res.headersSent) json(res, 500, "Internal server error.");
    }
  });
}
