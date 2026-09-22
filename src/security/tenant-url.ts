import { isForbiddenIp } from "./ip.js";

export interface DnsResolver {
  resolve(hostname: string): Promise<{ addresses: string[]; ttl: number }>;
}

export function assertPublicAddresses(addresses: string[]): void {
  if (addresses.length === 0)
    throw new Error("Odoo tenant DNS returned no addresses");
  if (addresses.some(isForbiddenIp))
    throw new Error("Unsafe Odoo tenant address");
}

export async function validateTenantOrigin(
  input: string,
  resolver: DnsResolver,
): Promise<{ origin: string; host: string }> {
  const invalid = () => new Error("Invalid Odoo tenant origin");
  if (!/^[\x21-\x7e]+$/.test(input)) throw invalid();

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalid();
  }
  const authority = input.match(/^https:\/\/([^/?#]+)/)?.[1];
  if (
    url.protocol !== "https:" ||
    !authority ||
    authority.includes("@") ||
    authority.includes(":") ||
    authority.includes("%") ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw invalid();
  }

  const host = url.hostname.toLowerCase();
  if (
    host.endsWith(".") ||
    !host.endsWith(".odoo.com") ||
    host === "odoo.com" ||
    host.length > 253 ||
    host
      .split(".")
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw invalid();
  }

  const result = await resolver.resolve(host);
  assertPublicAddresses(result.addresses);
  return { origin: `https://${host}`, host };
}

interface DnsJsonAnswer {
  data?: string;
  TTL?: number;
}

interface DnsJsonResponse {
  Answer?: DnsJsonAnswer[];
}

export class CloudflareDnsResolver implements DnsResolver {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async resolve(
    hostname: string,
  ): Promise<{ addresses: string[]; ttl: number }> {
    const answers = await Promise.all(
      ["A", "AAAA"].map(async (type) => {
        const url = new URL("https://cloudflare-dns.com/dns-query");
        url.searchParams.set("name", hostname);
        url.searchParams.set("type", type);
        const response = await this.fetcher(url, {
          headers: { accept: "application/dns-json" },
          redirect: "error",
        });
        if (!response.ok) throw new Error("Tenant DNS lookup failed");
        return (await response.json()) as DnsJsonResponse;
      }),
    );
    const records = answers.flatMap((answer) => answer.Answer ?? []);
    const ttls = records.map((record) => record.TTL ?? 0);
    return {
      addresses: records.flatMap((record) =>
        record.data && !record.data.endsWith(".") ? [record.data] : [],
      ),
      ttl: ttls.length > 0 ? Math.min(...ttls) : 0,
    };
  }
}
