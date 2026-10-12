import { ApiError, type ApiClient, type ClientFactory, type Project, type Task } from "./api.js";

interface Workspace { projects: Project[]; tasks: Task[] }

/** In-memory stand-in for a SaaS backend: two workspaces, tokens map to workspaces. */
export class FakeSaas {
  private workspaces = new Map<string, Workspace>();
  private tokens = new Map<string, { user: string; workspace: string }>();
  private seq = 100;

  constructor() {
    this.seed("acme", "Acme Co", ["Website Relaunch", "Mobile App"], 25);
    this.seed("globex", "Globex", ["Secret Merger", "Q4 Planning"], 5);
  }

  /** Register a token for a user in a workspace. */
  addToken(token: string, user: string, workspace: string) { this.tokens.set(token, { user, workspace }); }

  private seed(ws: string, label: string, projects: string[], tasksPer: number) {
    const w: Workspace = { projects: [], tasks: [] };
    projects.forEach((name, i) => {
      const p = { id: `${ws}-p${i + 1}`, name, description: `${label}: ${name}` };
      w.projects.push(p);
      for (let t = 1; t <= tasksPer; t++) {
        w.tasks.push({
          id: `${ws}-t${i + 1}-${t}`, projectId: p.id, title: `${name} task ${t}`,
          status: (["todo", "in_progress", "done"] as const)[t % 3],
          assignee: t % 2 ? "alice" : "bob", createdAt: new Date(2026, 0, t).toISOString(),
        });
      }
    });
    this.workspaces.set(ws, w);
  }

  /** Plug into createMcpServer / HTTP transport as the ClientFactory. */
  factory: ClientFactory = (token) => {
    const t = this.tokens.get(token);
    return t ? this.clientFor(t.workspace) : undefined;
  };

  private clientFor(ws: string): ApiClient {
    const w = this.workspaces.get(ws)!;
    const task = (id: string) => w.tasks.find((t) => t.id === id) ?? (() => { throw new ApiError(`Task '${id}' not found.`, "not_found"); })();
    return {
      listProjects: async () => [...w.projects],
      listTasks: async ({ projectId, status, assignee, limit, cursor }) => {
        const all = w.tasks.filter((t) => (!projectId || t.projectId === projectId) &&
          (!status || t.status === status) && (!assignee || t.assignee === assignee));
        const start = cursor ? Number.parseInt(cursor, 10) : 0;
        if (!Number.isInteger(start) || start < 0) throw new ApiError("Invalid cursor; use nextCursor from a previous response.");
        const items = all.slice(start, start + limit);
        return { items, nextCursor: start + limit < all.length ? String(start + limit) : null };
      },
      getTask: async (id) => task(id),
      createTask: async ({ projectId, title, assignee }) => {
        if (!w.projects.some((p) => p.id === projectId)) throw new ApiError(`Project '${projectId}' not found.`, "not_found");
        const t: Task = { id: `${ws}-t${++this.seq}`, projectId, title, status: "todo", assignee: assignee ?? null, createdAt: new Date().toISOString() };
        w.tasks.push(t);
        return t;
      },
      updateTaskStatus: async (id, status) => { const t = task(id); t.status = status; return { ...t }; },
      search: async (query, limit) => {
        const q = query.toLowerCase();
        return [
          ...w.projects.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)).map((p) => ({ type: "project" as const, id: p.id, title: p.name })),
          ...w.tasks.filter((t) => t.title.toLowerCase().includes(q)).map((t) => ({ type: "task" as const, id: t.id, title: t.title })),
        ].slice(0, limit);
      },
    };
  }
}

/** Demo tokens (placeholders; see .env.example). */
export function demoSaas(): FakeSaas {
  const s = new FakeSaas();
  s.addToken("demo-token-alice", "alice", "acme");
  s.addToken("demo-token-bob", "bob", "acme");
  s.addToken("demo-token-mallory", "mallory", "globex");
  return s;
}
