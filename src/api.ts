/** The only surface the MCP server knows about. Implement this against a real REST API to go live. */
export type TaskStatus = "todo" | "in_progress" | "done";
export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;

export interface Project { id: string; name: string; description: string }
export interface Task {
  id: string; projectId: string; title: string; status: TaskStatus;
  assignee: string | null; createdAt: string;
}
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface ListTasksQuery {
  projectId?: string; status?: TaskStatus; assignee?: string; limit: number; cursor?: string;
}
export interface SearchHit { type: "project" | "task"; id: string; title: string }

/** An ApiClient is already bound to ONE user's workspace: it has no way to name another one. */
export interface ApiClient {
  listProjects(): Promise<Project[]>;
  listTasks(q: ListTasksQuery): Promise<Page<Task>>;
  getTask(id: string): Promise<Task>;
  createTask(input: { projectId: string; title: string; assignee?: string }): Promise<Task>;
  updateTaskStatus(id: string, status: TaskStatus): Promise<Task>;
  search(query: string, limit: number): Promise<SearchHit[]>;
}

/** Turns a bearer token into a scoped client, or undefined if the token is unknown/revoked. */
export type ClientFactory = (token: string) => ApiClient | undefined;

/** Errors safe to show to the model/user. Anything else is reported generically. */
export class ApiError extends Error {
  constructor(message: string, readonly code: "not_found" | "invalid" | "unauthorized" = "invalid") {
    super(message);
  }
}
