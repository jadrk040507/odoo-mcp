import { serveMcpRequest } from "./mcp/server.js";
import { authenticateBearer } from "./oauth/bearer.js";
import { routeOAuth } from "./oauth/router.js";
import { FixedWindowRateLimiter } from "./policy/rate-limit.js";
import { createDefaultToolServices } from "./tools/default-services.js";

export function handleHealth(environment: string): Response {
  return Response.json({ status: "ok", environment });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return handleHealth(env.ENVIRONMENT);
    }

    if (url.pathname === "/mcp") {
      try {
        const auth = await authenticateBearer(request, env);
        const rate = await new FixedWindowRateLimiter(env.DB).consume(
          auth.userId,
          120,
          60,
          Math.floor(Date.now() / 1000),
        );
        if (!rate.allowed) {
          return Response.json(
            { error: "rate_limited", reset_at: rate.resetAt },
            { status: 429 },
          );
        }
        return serveMcpRequest(request, env, ctx, {
          auth,
          requestId: crypto.randomUUID(),
          services: await createDefaultToolServices(
            env,
            auth,
            env.PUBLIC_ORIGIN ?? url.origin,
          ),
        });
      } catch {
        return routeOAuth(request, env);
      }
    }

    return routeOAuth(request, env);
  },
} satisfies ExportedHandler<Env>;
