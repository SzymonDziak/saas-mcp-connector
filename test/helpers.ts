import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { demoSaas } from "../src/fake-saas.js";
import { createMcpServer, type ServerOptions } from "../src/server.js";

export const saas = demoSaas();

/** Connect an in-memory MCP client acting as the user who owns `token`. */
export async function connect(token: string, opts: ServerOptions = {}) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createMcpServer(saas.factory(token)!, opts).connect(st);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(ct);
  return client;
}

export const text = (r: any): string => r.content[0].text;
export const data = (r: any) => JSON.parse(text(r));
