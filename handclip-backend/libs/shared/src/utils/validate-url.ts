import { promises as dns } from 'dns';

const PRIVATE_IPV4_RANGES: readonly [number, number][] = [
  [0x00000000, 0x00FFFFFF], // 0.0.0.0/8
  [0x0A000000, 0x0AFFFFFF], // 10.0.0.0/8
  [0x7F000000, 0x7FFFFFFF], // 127.0.0.0/8
  [0xA9FE0000, 0xA9FEFFFF], // 169.254.0.0/16
  [0xAC100000, 0xAC1FFFFF], // 172.16.0.0/12
  [0xC0A80000, 0xC0A8FFFF], // 192.168.0.0/16
];

const INTERNAL_HOSTNAMES: Record<string, true> = {
  localhost: true,
  local: true,
  redis: true,
  api: true,
  worker: true,
  db: true,
  database: true,
  postgres: true,
  mysql: true,
  mongo: true,
  elasticsearch: true,
  rabbitmq: true,
  kafka: true,
  supabase: true,
  storage: true,
  auth: true,
  realtime: true,
  kong: true,
  gotrue: true,
  rest: true,
};

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!;
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToInt(ip);
  for (const [low, high] of PRIVATE_IPV4_RANGES) {
    if (num >= low && num <= high) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // ::1 (loopback)
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  // fc00::/7 (unique local)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // fe80::/10 (link-local)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  return false;
}

function isInternalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  // No dot = single-label hostname (always internal)
  if (!lower.includes('.')) return true;
  // Check against known internal service names
  if (INTERNAL_HOSTNAMES[lower] !== undefined) return true;
  // Check dotted-prefix matches (e.g. redis.svc.cluster.local)
  const dotIdx = lower.indexOf('.');
  if (dotIdx > 0 && INTERNAL_HOSTNAMES[lower.substring(0, dotIdx)] !== undefined) return true;
  // Reject .local and .internal TLDs
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  return false;
}

/**
 * Validates that a URL points to a public, non-internal resource.
 *
 * Rejects:
 * - Non-HTTP/HTTPS schemes (file://, ftp://, etc.)
 *   Note: HTTPS enforcement is done at the DTO layer;
 *   this function also allows http:// for local dev.
 * - Hostnames that resolve to private/internal IPs
 * - Localhost / single-label hostnames / internal service names
 *
 * Returns the normalized URL string.
 */
export async function validatePublicUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Allow only http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}// (only http/https allowed)`);
  }

  const hostname = parsed.hostname;

  // Reject internal hostnames before DNS resolution
  if (isInternalHostname(hostname)) {
    throw new Error(`URL hostname is internal/disallowed: ${hostname}`);
  }

  // DNS resolution for both IPv4 and IPv6
  const ips: string[] = [];
  try {
    const [v4, v6] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);
    if (v4.status === 'fulfilled') ips.push(...v4.value.map(String));
    if (v6.status === 'fulfilled') ips.push(...v6.value.map(String));
  } catch {
    throw new Error(`DNS resolution failed for hostname: ${hostname}`);
  }

  // If no IPs resolved at all, reject
  if (ips.length === 0) {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  // Check every resolved IP against private ranges
  for (const ip of ips) {
    if (ip.includes(':')) {
      if (isPrivateIPv6(ip)) {
        throw new Error(`URL resolves to private IPv6 address: ${ip} (${hostname})`);
      }
    } else {
      if (isPrivateIPv4(ip)) {
        throw new Error(`URL resolves to private IPv4 address: ${ip} (${hostname})`);
      }
    }
  }

  return parsed.href;
}
