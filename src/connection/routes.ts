import type { ConnectionService } from "./service.js";

export interface ConnectionRouteDependencies {
  service: ConnectionService;
  userId: string;
  csrfSecret: string;
}

export async function connectionRoutes(
  request: Request,
  dependencies: ConnectionRouteDependencies,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/connection/status") {
    return Response.json(
      await dependencies.service.status(dependencies.userId),
      {
        headers: { "cache-control": "no-store" },
      },
    );
  }
  if (
    request.method === "GET" &&
    ["/connect", "/connection/replace"].includes(path)
  ) {
    return new Response(
      `<!doctype html><title>Connect Odoo</title><form method=post><input type=hidden name=csrf value="${dependencies.csrfSecret}"><input name=origin><input name=api_key type=password autocomplete=off><button>Connect</button></form>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
  if (
    request.method === "POST" &&
    ["/connect", "/connection/replace"].includes(path)
  ) {
    const form = await request.formData();
    if (form.get("csrf") !== dependencies.csrfSecret) {
      return new Response("Forbidden", { status: 403 });
    }
    const origin = form.get("origin");
    const apiKey = form.get("api_key");
    if (typeof origin !== "string" || typeof apiKey !== "string" || !apiKey) {
      return new Response("Bad Request", { status: 400 });
    }
    const profile = await dependencies.service.verifyAndSave(
      dependencies.userId,
      origin,
      apiKey,
    );
    return Response.json(profile, { headers: { "cache-control": "no-store" } });
  }
  if (request.method === "POST" && path === "/connection/delete") {
    const form = await request.formData();
    if (form.get("csrf") !== dependencies.csrfSecret) {
      return new Response("Forbidden", { status: 403 });
    }
    await dependencies.service.delete(dependencies.userId);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response("Not Found", { status: 404 });
}
