import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { text } from "./helpers.js";

// Spawns the compiled entrypoint (dist/); `npm test` builds first.
describe("stdio entrypoint", () => {
  it("serves a scoped user from API_TOKEN", async () => {
    const t = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env as Record<string, string>, API_TOKEN: "demo-token-mallory", READ_ONLY: "true" }, stderr: "ignore" });
    const c = new Client({ name: "t", version: "0" });
    await c.connect(t);
    const r = await c.callTool({ name: "list_projects", arguments: {} });
    expect(text(r)).toContain("Secret Merger");
    const w: any = await c.callTool({ name: "create_task", arguments: { projectId: "globex-p1", title: "x", confirm: true } });
    expect(w.isError).toBe(true);
    await c.close();
  }, 15000);
});
