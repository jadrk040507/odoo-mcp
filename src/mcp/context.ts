import type { AuthContext } from "../oauth/bearer.js";

export interface McpServices {
  db: D1Database;
}

export interface McpRequestContext {
  auth: AuthContext;
  requestId: string;
  services: McpServices;
}
