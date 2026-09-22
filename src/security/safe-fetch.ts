import { assertPublicAddresses, type DnsResolver } from "./tenant-url.js";

export interface SafeFetchDependencies {
  resolver: DnsResolver;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

async function boundedResponse(
  response: Response,
  maximum: number,
): Promise<Response> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw new Error("Response too large");
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function safeTenantFetch(
  origin: string,
  path: string,
  init: RequestInit,
  dependencies: SafeFetchDependencies,
): Promise<Response> {
  const allowedOrigin = new URL(origin).origin;
  let url = new URL(path, `${allowedOrigin}/`);
  if (url.origin !== allowedOrigin || url.username || url.password)
    throw new Error("Unsafe request URL");
  const fetcher = dependencies.fetch ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? 10_000;

  for (let redirects = 0; ; redirects += 1) {
    const dns = await dependencies.resolver.resolve(url.hostname);
    assertPublicAddresses(dns.addresses);

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(
      () => controller.abort(new Error("Upstream timeout")),
      timeoutMs,
    );
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abortFromCaller);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return boundedResponse(
        response,
        dependencies.maxResponseBytes ?? 1_048_576,
      );
    }
    if (redirects >= 3) throw new Error("Too many redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Unsafe redirect");
    const redirected = new URL(location, url);
    if (
      redirected.origin !== allowedOrigin ||
      redirected.username ||
      redirected.password
    )
      throw new Error("Unsafe redirect");
    url = redirected;
  }
}
