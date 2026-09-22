import type { AuthContext } from "../oauth/bearer.js";
import type { AccountToolService } from "../tools/account.js";
import type { BusinessReadService } from "../tools/read.js";

export interface McpServices {
  db: D1Database;
  account?: AccountToolService;
  read?: BusinessReadService;
}

export interface McpRequestContext {
  auth: AuthContext;
  requestId: string;
  services: McpServices;
}
