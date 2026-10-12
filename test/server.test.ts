import { describe, expect, it } from "vitest";
import { connect, data, text } from "./helpers.js";

describe("end to end (in-memory transport)", () => {
  it("lists tools and calls one", async () => {
    const c = await connect("demo-token-alice");
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["create_task", "get_task", "list_projects", "list_tasks", "search", "update_task_status"]);
    const r = await c.callTool({ name: "list_projects", arguments: {} });
    expect(data(r).map((p: any) => p.name)).toContain("Website Relaunch");
  });

  it("marks read tools read-only and write tools not", async () => {
    const tools = (await (await connect("demo-token-alice")).listTools()).tools;
    expect(tools.find((t) => t.name === "get_task")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "create_task")!.annotations?.readOnlyHint).toBe(false);
  });
});

describe("input validation", () => {
  it("rejects bad input as a tool error, without stack traces", async () => {
    const c = await connect("demo-token-alice");
    for (const [name, args] of [
      ["list_tasks", { limit: 500 }],
      ["list_tasks", { status: "banana" }],
      ["search", { query: "x" }],
      ["create_task", { projectId: "acme-p1", title: "   ", confirm: true }],
      ["update_task_status", { taskId: "acme-t1-1" }],
    ] as const) {
      const r: any = await c.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
      expect(text(r)).not.toMatch(/\bat .*\.(ts|js):\d+/);
    }
  });

  it("returns a helpful not-found error", async () => {
    const r: any = await (await connect("demo-token-alice")).callTool({ name: "get_task", arguments: { taskId: "nope" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Task 'nope' not found");
  });
});

describe("workspace isolation", () => {
  it("never shows another workspace's data", async () => {
    const alice = await connect("demo-token-alice");
    const mallory = await connect("demo-token-mallory");
    const projects = data(await mallory.callTool({ name: "list_projects", arguments: {} }));
    expect(projects.map((p: any) => p.id).every((i: string) => i.startsWith("globex"))).toBe(true);

    const secretId = "globex-t1-1";
    expect((await alice.callTool({ name: "get_task", arguments: { taskId: secretId } }) as any).isError).toBe(true);
    const s = await alice.callTool({ name: "search", arguments: { query: "Secret Merger" } });
    expect(data(s)).toEqual([]);
    const lt = data(await alice.callTool({ name: "list_tasks", arguments: { projectId: "globex-p1" } }));
    expect(lt.items).toEqual([]);
    const w: any = await alice.callTool({ name: "update_task_status", arguments: { taskId: secretId, status: "done", confirm: true } });
    expect(w.isError).toBe(true);
    // The cross-workspace write attempt must not have changed the victim's task.
    const own = data(await mallory.callTool({ name: "get_task", arguments: { taskId: secretId } }));
    expect(own.status).toBe("in_progress");
  });

  it("shares data between users of the same workspace", async () => {
    const bob = await connect("demo-token-bob");
    const t: any = await bob.callTool({ name: "create_task", arguments: { projectId: "acme-p2", title: "Shared note", confirm: true } });
    const alice = await connect("demo-token-alice");
    const hits = data(await alice.callTool({ name: "search", arguments: { query: "shared note" } }));
    expect(hits[0].id).toBe(data(t).id);
  });
});

describe("pagination and filters", () => {
  it("walks all pages exactly once", async () => {
    const c = await connect("demo-token-alice");
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = data(await c.callTool({ name: "list_tasks", arguments: { projectId: "acme-p1", limit: 10, cursor } }));
      expect(page.items.length).toBeLessThanOrEqual(10);
      seen.push(...page.items.map((t: any) => t.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.length).toBe(25);
    expect(new Set(seen).size).toBe(25);
  });

  it("filters by status and rejects a bad cursor", async () => {
    const c = await connect("demo-token-alice");
    const page = data(await c.callTool({ name: "list_tasks", arguments: { status: "done", limit: 50 } }));
    expect(page.items.every((t: any) => t.status === "done")).toBe(true);
    const bad: any = await c.callTool({ name: "list_tasks", arguments: { cursor: "abc" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("Invalid cursor");
  });
});

describe("write safety", () => {
  it("requires confirm: true", async () => {
    const c = await connect("demo-token-alice");
    const r: any = await c.callTool({ name: "create_task", arguments: { projectId: "acme-p1", title: "No confirm" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("confirm: true");
    const hits = data(await c.callTool({ name: "search", arguments: { query: "No confirm" } }));
    expect(hits).toEqual([]);
  });

  it("works with confirm: true", async () => {
    const c = await connect("demo-token-alice");
    const r = await c.callTool({ name: "update_task_status", arguments: { taskId: "acme-t1-1", status: "done", confirm: true } });
    expect(data(r).status).toBe("done");
  });

  it("READ_ONLY blocks writes even with confirm, but reads work", async () => {
    const c = await connect("demo-token-alice", { readOnly: true });
    const w: any = await c.callTool({ name: "create_task", arguments: { projectId: "acme-p1", title: "Nope", confirm: true } });
    expect(w.isError).toBe(true);
    expect(text(w)).toContain("read-only");
    expect((await c.callTool({ name: "list_projects", arguments: {} }) as any).isError).toBeFalsy();
  });

  it("hides internal failures behind a generic message", async () => {
    const { createMcpServer } = await import("../src/server.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const api: any = { listProjects: async () => { throw new Error("ECONNREFUSED 10.0.0.5 secret-db"); } };
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(api).connect(b);
    const c = new Client({ name: "t", version: "0" }); await c.connect(a);
    const r: any = await c.callTool({ name: "list_projects", arguments: {} });
    expect(r.isError).toBe(true);
    expect(text(r)).not.toContain("secret-db");
  });
});
