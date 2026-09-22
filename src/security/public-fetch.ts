import { isForbiddenIp } from "./ip.js";
import type { DnsResolver } from "./tenant-url.js";

export interface PublicFetchDependencies {
  resolver: DnsResolver;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function publicHttpsFetch(
  input: string,
  dependencies: PublicFetchDependencies,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid public URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new Error("Invalid public URL");
  }
  const dns = await dependencies.resolver.resolve(url.hostname);
  if (dns.addresses.length === 0 || dns.addresses.some(isForbiddenIp)) {
    throw new Error("Unsafe public address");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Public fetch timeout")),
    dependencies.timeoutMs ?? 10_000,
  );
  try {
    const response = await (dependencies.fetch ?? fetch)(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Public fetch failed");
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}
