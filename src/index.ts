#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHttpServer } from "./http.js";
import { demoSaas } from "./fake-saas.js";
import { createMcpServer } from "./server.js";

// Swap `demoSaas()` for your own ClientFactory (see README, "Using a real API").
const saas = demoSaas();
const readOnly = ["1", "true"].includes((process.env.READ_ONLY ?? "").toLowerCase());
const mode = process.argv[2] ?? "stdio";

if (mode === "stdio") {
  // One process = one user: the token comes from the environment of the MCP client config.
  const api = saas.factory(process.env.API_TOKEN ?? "");
  if (!api) { console.error("API_TOKEN is missing or invalid."); process.exit(1); }
  await createMcpServer(api, { readOnly }).connect(new StdioServerTransport());
  console.error(`saas-mcp-connector running on stdio${readOnly ? " (read-only)" : ""}`);
} else if (mode === "http") {
  const port = Number(process.env.PORT ?? 3000);
  createHttpServer(saas.factory, {
    readOnly,
    rateLimit: { capacity: Number(process.env.RATE_BURST ?? 30), perSecond: Number(process.env.RATE_PER_SEC ?? 1) },
  }).listen(port, "127.0.0.1", () => console.error(`Streamable HTTP on http://127.0.0.1:${port}/mcp${readOnly ? " (read-only)" : ""}`));
} else {
  console.error("Usage: saas-mcp-connector [stdio|http]");
  process.exit(1);
}
