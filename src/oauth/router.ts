import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "./metadata.js";
import { createAuthorizationSession } from "./authorize.js";
import { resolveCimd, type PublicFetcher } from "./cimd.js";
import { verifyClientAssertion } from "./client-assertion.js";
import { revokeToken } from "./revoke.js";
import { exchangeAuthorizationCode, refreshAccessToken } from "./token.js";
import { OAuthRepository } from "../storage/repositories.js";
import { CloudflareDnsResolver } from "../security/tenant-url.js";
import { publicHttpsFetch } from "../security/public-fetch.js";
import { oauthError } from "../http/forms.js";

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export interface OAuthRouterEnv {
  DB: D1Database;
  PUBLIC_ORIGIN?: string;
  TOKEN_HASH_PEPPER?: string;
}

export interface OAuthRouterDependencies {
  fetchPublic?: PublicFetcher;
  now?: () => number;
}

function publicFetcher(): PublicFetcher {
  const resolver = new CloudflareDnsResolver();
  return (url) => publicHttpsFetch(url, { resolver });
}

async function authenticatedClient(
  form: FormData,
  origin: string,
  env: OAuthRouterEnv,
  fetchPublic: PublicFetcher,
  now: number,
) {
  const clientId = form.get("client_id");
  const assertion = form.get("client_assertion");
  if (
    typeof clientId !== "string" ||
    typeof assertion !== "string" ||
    form.get("client_assertion_type") !==
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
  ) {
    throw new Error("invalid_client");
  }
  const client = await resolveCimd(clientId, fetchPublic);
  await verifyClientAssertion(
    { clientId, clientAssertion: assertion },
    client,
    `${origin}/token`,
    new OAuthRepository(env.DB),
    now,
  );
  return client;
}

export async function routeOAuth(
  request: Request,
  env: OAuthRouterEnv,
  dependencies: OAuthRouterDependencies = {},
): Promise<Response> {
  const origin = env.PUBLIC_ORIGIN ?? new URL(request.url).origin;
  const path = new URL(request.url).pathname;
  const now = dependencies.now?.() ?? Math.floor(Date.now() / 1000);
  const fetchPublic = dependencies.fetchPublic ?? publicFetcher();
  if (
    request.method === "GET" &&
    path === "/.well-known/oauth-protected-resource/mcp"
  ) {
    return json(protectedResourceMetadata(origin));
  }
  if (
    request.method === "GET" &&
    path === "/.well-known/oauth-authorization-server"
  ) {
    return json(authorizationServerMetadata(origin));
  }
  if (path === "/mcp") {
    return new Response(null, {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      },
    });
  }
  if (request.method === "GET" && path === "/authorize") {
    const url = new URL(request.url);
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const resource = url.searchParams.get("resource");
    const scope = url.searchParams.get("scope") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge");
    if (
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !clientId ||
      !redirectUri ||
      !state ||
      !codeChallenge ||
      resource !== `${origin}/mcp` ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) ||
      scope
        .split(" ")
        .some((value) => !["odoo.read", "odoo.write"].includes(value))
    ) {
      return oauthError("invalid_request");
    }
    try {
      const client = await resolveCimd(clientId, fetchPublic);
      if (!client.redirectUris.includes(redirectUri))
        return oauthError("invalid_request");
      if (!env.TOKEN_HASH_PEPPER) return oauthError("server_error", 500);
      const session = await createAuthorizationSession(
        {
          state,
          clientId,
          redirectUri,
          resource,
          scope,
          codeChallenge,
          expiresAt: now + 300,
        },
        env.TOKEN_HASH_PEPPER,
      );
      return new Response(
        "<!doctype html><title>Connect Odoo</title><h1>Connect Odoo</h1>",
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "set-cookie": `odoo_oauth_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300`,
          },
        },
      );
    } catch {
      return oauthError("invalid_request");
    }
  }
  if (request.method === "POST" && path === "/token") {
    if (!env.TOKEN_HASH_PEPPER) return oauthError("server_error", 500);
    try {
      const form = await request.formData();
      const client = await authenticatedClient(
        form,
        origin,
        env,
        fetchPublic,
        now,
      );
      const grantType = form.get("grant_type");
      const resource = form.get("resource");
      if (typeof resource !== "string") throw new Error("invalid_request");
      if (grantType === "authorization_code") {
        const code = form.get("code");
        const verifier = form.get("code_verifier");
        const redirectUri = form.get("redirect_uri");
        if (
          typeof code !== "string" ||
          typeof verifier !== "string" ||
          typeof redirectUri !== "string"
        ) {
          throw new Error("invalid_request");
        }
        return json(
          await exchangeAuthorizationCode(
            env.DB,
            {
              code,
              codeVerifier: verifier,
              clientId: client.clientId,
              redirectUri,
              resource,
            },
            env.TOKEN_HASH_PEPPER,
            now,
          ),
        );
      }
      if (grantType === "refresh_token") {
        const refresh = form.get("refresh_token");
        if (typeof refresh !== "string") throw new Error("invalid_request");
        return json(
          await refreshAccessToken(
            env.DB,
            refresh,
            client.clientId,
            resource,
            env.TOKEN_HASH_PEPPER,
            now,
          ),
        );
      }
      return oauthError("unsupported_grant_type");
    } catch (error) {
      const code =
        error instanceof Error && error.message === "invalid_grant"
          ? "invalid_grant"
          : "invalid_client";
      return oauthError(code, code === "invalid_client" ? 401 : 400);
    }
  }
  if (request.method === "POST" && path === "/revoke") {
    if (!env.TOKEN_HASH_PEPPER) return oauthError("server_error", 500);
    try {
      const form = await request.formData();
      await authenticatedClient(form, origin, env, fetchPublic, now);
      const token = form.get("token");
      if (typeof token === "string") {
        await revokeToken(env.DB, token, env.TOKEN_HASH_PEPPER, now);
      }
      return new Response(null, {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return oauthError("invalid_client", 401);
    }
  }
  return new Response("Not Found", { status: 404 });
}
