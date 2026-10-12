import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/ratelimit.js";
import { createHttpServer, type HttpOptions } from "../src/http.js";
import { data, saas } from "./helpers.js";

describe("RateLimiter", () => {
  it("allows a burst, blocks, then refills", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1, () => t);
    expect([rl.take("a"), rl.take("a")]).toEqual([0, 0]);
    expect(rl.take("a")).toBe(1);
    expect(rl.take("b")).toBe(0); // separate bucket
    t = 1000;
    expect(rl.take("a")).toBe(0);
  });
});

let closers: Array<() => void> = [];
afterEach(() => { closers.forEach((f) => f()); closers = []; });

async function start(opts: HttpOptions = {}) {
  const srv = createHttpServer(saas.factory, opts);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  closers.push(() => srv.close());
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`;
}
const rpc = (url: string, token?: string) => fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});

describe("Streamable HTTP", () => {
  it("rejects missing and unknown tokens with 401", async () => {
    const url = await start();
    expect((await rpc(url)).status).toBe(401);
    expect((await rpc(url, "wrong")).status).toBe(401);
  });

  it("serves the SDK client, scoped per token", async () => {
    const url = await start();
    const open = async (token: string) => {
      const c = new Client({ name: "t", version: "0" });
      await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      return c;
    };
    const a = await open("demo-token-alice"), m = await open("demo-token-mallory");
    expect((await a.listTools()).tools.length).toBe(6);
    expect(data(await a.callTool({ name: "list_projects", arguments: {} })).length).toBe(2);
    const ids = data(await m.callTool({ name: "list_projects", arguments: {} })).map((p: any) => p.id);
    expect(ids.every((i: string) => i.startsWith("globex"))).toBe(true);
  });

  it("rate limits per token with 429 + Retry-After", async () => {
    const url = await start({ rateLimit: { capacity: 2, perSecond: 0.01 } });
    expect((await rpc(url, "demo-token-alice")).status).toBe(200);
    expect((await rpc(url, "demo-token-alice")).status).toBe(200);
    const limited = await rpc(url, "demo-token-alice");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await rpc(url, "demo-token-bob")).status).toBe(200); // other token unaffected
  });

  it("rejects GET (stateless server)", async () => {
    const url = await start();
    expect((await fetch(url, { headers: { authorization: "Bearer demo-token-alice" } })).status).toBe(405);
  });
});
