function parseIpv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inIpv4Range(value: number, base: string, prefix: number): boolean {
  const baseValue = parseIpv4(base);
  if (baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function parseIpv6(address: string): number[] | null {
  const zoneIndex = address.indexOf("%");
  if (zoneIndex !== -1) return null;

  let normalized = address.toLowerCase();
  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const ipv4 = parseIpv4(ipv4Tail);
    if (ipv4 === null) return null;
    normalized =
      normalized.slice(0, -ipv4Tail.length) +
      `${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const [left = "", right = ""] = normalized.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  if (
    [...leftParts, ...rightParts].some((part) => !/^[\da-f]{1,4}$/.test(part))
  ) {
    return null;
  }
  const missing = 8 - leftParts.length - rightParts.length;
  if (
    (normalized.includes("::") && missing < 1) ||
    (!normalized.includes("::") && missing !== 0)
  ) {
    return null;
  }
  return [
    ...leftParts.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...rightParts.map((part) => Number.parseInt(part, 16)),
  ];
}

export function isForbiddenIp(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4 !== null) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, prefix]) =>
      inIpv4Range(ipv4, base as string, prefix as number),
    );
  }

  const ipv6 = parseIpv6(address);
  if (!ipv6) return true;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = ipv6;
  if (ipv6.every((part) => part === 0)) return true;
  if (ipv6.slice(0, 7).every((part) => part === 0) && ipv6[7] === 1)
    return true;
  if (
    (a & 0xfe00) === 0xfc00 ||
    (a & 0xffc0) === 0xfe80 ||
    (a & 0xff00) === 0xff00
  )
    return true;
  if (a === 0x2001 && b === 0x0db8) return true;
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true;
  if (a === 0x2001 && b === 0x0002) return true;
  if (a === 0x2001 && (b & 0xfff0) === 0x0010) return true;
  if (a === 0x0064 && b === 0xff9b && c === 1) return true;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    const mapped = (((ipv6[6] ?? 0) << 16) | (ipv6[7] ?? 0)) >>> 0;
    return isForbiddenIp(
      `${mapped >>> 24}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`,
    );
  }
  return false;
}
