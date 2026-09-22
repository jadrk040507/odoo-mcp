import type { AuthContext } from "../oauth/bearer.js";
import type { AccountToolService } from "../tools/account.js";
import type { BusinessReadService } from "../tools/read.js";
import type { WriteToolService } from "../tools/write.js";

export interface McpServices {
  db: D1Database;
  account?: AccountToolService;
  read?: BusinessReadService;
  write?: WriteToolService;
}

export interface McpRequestContext {
  auth: AuthContext;
  requestId: string;
  services: McpServices;
}
