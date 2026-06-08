import * as dns from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_RANGES: Array<[bigint, bigint]> = [
  // 127.0.0.0/8
  [ipToBigInt('127.0.0.0'), ipToBigInt('127.255.255.255')],
  // 10.0.0.0/8
  [ipToBigInt('10.0.0.0'), ipToBigInt('10.255.255.255')],
  // 172.16.0.0/12
  [ipToBigInt('172.16.0.0'), ipToBigInt('172.31.255.255')],
  // 192.168.0.0/16
  [ipToBigInt('192.168.0.0'), ipToBigInt('192.168.255.255')],
  // 169.254.0.0/16 (link-local / cloud metadata)
  [ipToBigInt('169.254.0.0'), ipToBigInt('169.254.255.255')],
  // 0.0.0.0/8
  [ipToBigInt('0.0.0.0'), ipToBigInt('0.255.255.255')],
];

const PRIVATE_V6: Array<[bigint, bigint]> = [
  // ::1 (loopback)
  [1n, 1n],
  // fc00::/7 (unique local)
  [ipToBigIntV6('fc00::'), ipToBigIntV6('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')],
  // fe80::/10 (link-local)
  [ipToBigIntV6('fe80::'), ipToBigIntV6('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff')],
];

const IPV4_MAPPED_V6_START = ipToBigIntV6('::ffff:0:0');
const IPV4_MAPPED_V6_END = ipToBigIntV6('::ffff:ffff:ffff');
const IPV4_MASK = 0xffff_ffffn;

function ipToBigInt(ip: string): bigint {
  const parts = ip.split('.').map(Number);
  return BigInt(parts[0]) * 256n ** 3n + BigInt(parts[1]) * 256n ** 2n + BigInt(parts[2]) * 256n + BigInt(parts[3]);
}

function ipToBigIntV6(ip: string): bigint {
  const expanded = expandIpv6(ip);
  const groups = expanded.split(':').map((g) => parseInt(g, 16));
  let result = 0n;
  for (const g of groups) {
    result = result * 65536n + BigInt(g);
  }
  return result;
}

function expandIpv6(ip: string): string {
  if (ip.includes('::')) {
    const parts = ip.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0000');
    return [...left, ...middle, ...right].map((g) => g.padStart(4, '0')).join(':');
  }
  return ip.split(':').map((g) => g.padStart(4, '0')).join(':');
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipToBigInt(ip);
  return PRIVATE_RANGES.some(([lo, hi]) => num >= lo && num <= hi);
}

function isPrivateIPv6(ip: string): boolean {
  const num = ipToBigIntV6(ip);
  return PRIVATE_V6.some(([lo, hi]) => num >= lo && num <= hi);
}

function normalizeIpLiteral(ip: string): string {
  return ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function ipv4BigIntToString(value: bigint): string {
  return [
    Number((value >> 24n) & 255n),
    Number((value >> 16n) & 255n),
    Number((value >> 8n) & 255n),
    Number(value & 255n),
  ].join('.');
}

function ipv4MappedToIPv4(ip: string): string | null {
  if (!ip.startsWith('::ffff:')) {
    return null;
  }

  const suffix = ip.slice('::ffff:'.length);
  if (isIP(suffix) === 4) {
    return suffix;
  }

  const num = ipToBigIntV6(ip);
  if (num < IPV4_MAPPED_V6_START || num > IPV4_MAPPED_V6_END) {
    return null;
  }

  return ipv4BigIntToString(num & IPV4_MASK);
}

export function isPrivateIp(ip: string): boolean {
  const normalized = normalizeIpLiteral(ip);
  const ipVersion = isIP(normalized);
  if (ipVersion === 0) {
    return false;
  }

  if (ipVersion === 4) {
    return isPrivateIPv4(normalized);
  }

  const mappedIPv4 = ipv4MappedToIPv4(normalized);
  if (mappedIPv4) {
    return isPrivateIPv4(mappedIPv4);
  }

  return isPrivateIPv6(normalized);
}
const BLOCKED_HOSTNAMES: Record<string, true> = { 'localhost': true, 'metadata.google.internal': true, 'instance-data': true };

/**
 * Validates a baseUrl for OpenAI-compatible connections, blocking private IPs
 * and SSRF-prone addresses. Returns the normalised URL on success.
 *
 * @param baseUrl  Raw URL string from user input.
 * @param allowPrivate  When true, skip private-IP checks (dev/self-hosted).
 */
export async function validateOpenAiCompatibleBaseUrl(
  baseUrl: string,
  allowPrivate: boolean,
): Promise<string> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('baseUrl is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('baseUrl is not a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }

  // Block credentials in URL
  if (parsed.username || parsed.password) {
    throw new Error('baseUrl must not contain credentials');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Block empty hostname
  if (!hostname) {
    throw new Error('baseUrl hostname is empty');
  }

  // Block *.localhost and known metadata hostnames
  if (BLOCKED_HOSTNAMES[hostname] || hostname.endsWith('.localhost')) {
    if (!allowPrivate) {
      throw new Error('baseUrl points to a blocked hostname (localhost)');
    }
  }

  // If hostname is already an IP, check directly
  const isDirectIP = isIP(hostname) !== 0;
  if (isDirectIP) {
    if (!allowPrivate && isPrivateIp(hostname)) {
      throw new Error('baseUrl resolves to a private/link-local IP');
    }
  }

  // DNS resolution check for hostnames
  if (!isDirectIP && !allowPrivate) {
    try {
      const addresses = await dns.lookup(hostname, { all: true, family: 0 });
      for (const addr of addresses) {
        if (isPrivateIp(addr.address)) {
          throw new Error(
            `baseUrl resolves to a private IP (${addr.address})`,
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('baseUrl resolves to')) {
        throw err;
      }
      // DNS lookup failures (NXDOMAIN etc.) — allow to proceed;
      // the actual fetch will fail with a clear error.
    }
  }

  if (!allowPrivate && parsed.protocol === 'http:') {
    throw new Error('baseUrl must use https unless private endpoints are enabled');
  }

  // Normalise: strip trailing slash
  return parsed.toString().replace(/\/+$/, '');
}
