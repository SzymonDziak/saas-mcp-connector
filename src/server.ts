import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiError, TASK_STATUSES, type ApiClient } from "./api.js";

export interface ServerOptions { readOnly?: boolean }

const ok = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

/** Run a handler; convert every failure into a model-readable tool error, never a stack trace. */
async function guard(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof ApiError) return fail(e.message);
    console.error("[tool error]", e); // stderr only, never returned to the client
    return fail("The upstream service failed to handle this request. Try again later.");
  }
}

const id = (what: string) => z.string().min(1).max(100).describe(what);
const confirm = z.boolean().optional().describe("Must be true to perform this write. Ask the user before setting it.");

export function createMcpServer(api: ApiClient, opts: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "saas-mcp-connector", version: "0.1.0" });
  const readOnly = opts.readOnly ?? false;
  const R = { readOnlyHint: true, openWorldHint: false };

  // ---- Read-only tools ----
  server.registerTool("list_projects", {
    description: "[read] List projects in the caller's workspace.",
    annotations: R,
  }, () => guard(() => api.listProjects()));

  server.registerTool("list_tasks", {
    description: "[read] List tasks with optional filters. Paginated: pass the returned nextCursor to get the next page.",
    inputSchema: {
      projectId: id("Only tasks in this project").optional(),
      status: z.enum(TASK_STATUSES).optional().describe("Only tasks with this status"),
      assignee: z.string().max(100).optional().describe("Only tasks assigned to this user"),
      limit: z.number().int().min(1).max(50).default(20).describe("Page size (1-50)"),
      cursor: z.string().max(20).optional().describe("nextCursor from a previous call"),
    },
    annotations: R,
  }, (q) => guard(() => api.listTasks(q)));

  server.registerTool("get_task", {
    description: "[read] Get one task by id.",
    inputSchema: { taskId: id("Task id, e.g. acme-t1-3") },
    annotations: R,
  }, ({ taskId }) => guard(() => api.getTask(taskId)));

  server.registerTool("search", {
    description: "[read] Case-insensitive text search over project and task titles.",
    inputSchema: {
      query: z.string().min(2).max(200).describe("Text to look for"),
      limit: z.number().int().min(1).max(50).default(10),
    },
    annotations: R,
  }, ({ query, limit }) => guard(() => api.search(query, limit)));

  // ---- Write tools: blocked in READ_ONLY mode, and need confirm: true ----
  const write = (run: () => Promise<unknown>, confirmed: boolean | undefined, what: string) => {
    if (readOnly) return Promise.resolve(fail("This server is in read-only mode; write tools are disabled."));
    if (confirmed !== true) return Promise.resolve(fail(`Not done: ${what} needs explicit approval. Ask the user, then retry with confirm: true.`));
    return guard(run);
  };
  const W = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  server.registerTool("create_task", {
    description: "[write] Create a task in a project. Requires confirm: true; disabled in read-only mode.",
    inputSchema: {
      projectId: id("Project to add the task to"),
      title: z.string().trim().min(1).max(200).describe("Task title"),
      assignee: z.string().max(100).optional(),
      confirm,
    },
    annotations: W,
  }, (a) => write(() => api.createTask({ projectId: a.projectId, title: a.title, assignee: a.assignee }), a.confirm, `creating task "${a.title}"`));

  server.registerTool("update_task_status", {
    description: "[write] Change a task's status. Requires confirm: true; disabled in read-only mode.",
    inputSchema: { taskId: id("Task id"), status: z.enum(TASK_STATUSES), confirm },
    annotations: { ...W, idempotentHint: true },
  }, (a) => write(() => api.updateTaskStatus(a.taskId, a.status), a.confirm, `setting ${a.taskId} to ${a.status}`));

  return server;
}
