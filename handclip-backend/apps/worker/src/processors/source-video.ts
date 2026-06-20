import { isIP } from 'net';
import * as dns from 'node:dns/promises';
import { SupabaseService } from '../modules/supabase/supabase.service';

const BUCKET = 'source-videos';
const MAX_HTTP_REDIRECTS = 5;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'instance-data',
  'metadata.google.internal',
]);

function ipToBigInt(ip: string): bigint {
  const parts = ip.split('.').map(Number);
  return BigInt(parts[0]) * 256n ** 3n + BigInt(parts[1]) * 256n ** 2n + BigInt(parts[2]) * 256n + BigInt(parts[3]);
}

const PRIVATE_RANGES: Array<[bigint, bigint]> = [
  [ipToBigInt('127.0.0.0'), ipToBigInt('127.255.255.255')],
  [ipToBigInt('10.0.0.0'), ipToBigInt('10.255.255.255')],
  [ipToBigInt('172.16.0.0'), ipToBigInt('172.31.255.255')],
  [ipToBigInt('192.168.0.0'), ipToBigInt('192.168.255.255')],
  [ipToBigInt('169.254.0.0'), ipToBigInt('169.254.255.255')],
  [ipToBigInt('0.0.0.0'), ipToBigInt('0.255.255.255')],
];

function isPrivateIPv4(ip: string): boolean {
  const num = ipToBigInt(ip);
  return PRIVATE_RANGES.some(([lo, hi]) => num >= lo && num <= hi);
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  const fc00 = ipToBigIntV6('fc00::');
  const fdff = ipToBigIntV6('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  const fe80 = ipToBigIntV6('fe80::');
  const febf = ipToBigIntV6('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  const num = ipToBigIntV6(ip);
  return (num >= fc00 && num <= fdff) || (num >= fe80 && num <= febf);
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

function ipToBigIntV6(ip: string): bigint {
  const expanded = expandIpv6(ip);
  const groups = expanded.split(':').map((g) => parseInt(g, 16));
  let result = 0n;
  for (const g of groups) {
    result = result * 65536n + BigInt(g);
  }
  return result;
}

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return false;
}

function normalizeIpLiteral(ip: string): string {
  return ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function isPrivateUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) return true;
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    return true;
  }

  const directIP = normalizeIpLiteral(hostname);
  const version = isIP(directIP);
  if (version !== 0) {
    return isPrivateIp(directIP);
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, family: 0 });
    return addresses.some((addr) => isPrivateIp(addr.address));
  } catch {
    // DNS failures are treated as non-private so the downstream fetch can
    // surface a clear error, but private-IP resolution is still blocked.
    return false;
  }
}

async function downloadStorageObject(
  supabaseService: SupabaseService,
  storagePath: string,
  localDest: string,
  label: string,
): Promise<string> {
  const client = supabaseService.getServiceRoleClient();
  const { data, error } = await client.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(
      `Failed to download ${label} from storage (${storagePath}): ${error?.message ?? 'empty response'}`,
    );
  }
  const arrayBuffer = await data.arrayBuffer();
  const fs = await import('fs');
  fs.writeFileSync(localDest, Buffer.from(arrayBuffer));
  return localDest;
}

async function downloadHttpAsset(url: string, localDest: string, label: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= MAX_HTTP_REDIRECTS; redirectCount++) {
      if (await isPrivateUrl(currentUrl)) {
        throw new Error(`Blocked ${label} URL (${currentUrl.slice(0, 80)}) resolving to a private or internal address`);
      }

      const res = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
      if (isRedirectStatus(res.status)) {
        const location = res.headers.get('location');
        if (!location) {
          throw new Error(`Failed to fetch ${label} (${currentUrl.slice(0, 80)}): HTTP ${res.status}`);
        }
        const nextUrl = new URL(location, currentUrl).toString();
        if (await isPrivateUrl(nextUrl)) {
          throw new Error(`Blocked ${label} redirect URL (${nextUrl.slice(0, 80)}) resolving to a private or internal address`);
        }
        currentUrl = nextUrl;
        continue;
      }

      if (!res.ok) {
        throw new Error(
          `Failed to fetch ${label} (${currentUrl.slice(0, 80)}): HTTP ${res.status}`,
        );
      }
      const fs = await import('fs');
      fs.writeFileSync(localDest, Buffer.from(await res.arrayBuffer()));
      return localDest;
    }

    throw new Error(`Too many redirects fetching ${label} (${url.slice(0, 80)})`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolves a job's `sourceVideoPath` to a local file path the worker can
 * read. If the file already exists locally it is reused.
 *
 * Accepts either:
 *  - A Supabase storage path (e.g. "userId/projectId/input.mp4"). The
 *    service role client is used to download; no signed URL involved,
 *    so the download is safe to perform any time after the job was queued
 *    (jobs can run for hours without expiring the URL).
 *  - A file:// path or absolute filesystem path (legacy / tests).
 *  - An http(s):// URL (legacy payloads from before the storage-path
 *    refactor — still functional for jobs that finished queuing before
 *    the deploy).
 */
export async function downloadSourceVideo(
  supabaseService: SupabaseService,
  sourceVideoPath: string | undefined,
  legacyVideoUrl: string | undefined,
  localDest: string,
): Promise<string> {
  if (sourceVideoPath && !sourceVideoPath.startsWith('http') && !sourceVideoPath.startsWith('/')) {
    return downloadStorageObject(supabaseService, sourceVideoPath, localDest, 'source video');
  }

  const candidate = legacyVideoUrl ?? sourceVideoPath;
  if (!candidate) {
    throw new Error('No source video path or URL provided in job payload');
  }

  if (candidate.startsWith('http')) {
    return downloadHttpAsset(candidate, localDest, 'source video');
  }

  // Filesystem path (legacy fallback for tests).
  const fs = await import('fs');
  fs.copyFileSync(candidate, localDest);
  return localDest;
}

export async function downloadMusicAsset(
  supabaseService: SupabaseService,
  musicUrl: string,
  localDest: string,
): Promise<string> {
  if (musicUrl.startsWith('file://') || musicUrl.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(musicUrl)) {
    throw new Error('Local music files must be uploaded before rendering');
  }

  if (musicUrl.startsWith('http')) {
    return downloadHttpAsset(musicUrl, localDest, 'music');
  }

  return downloadStorageObject(supabaseService, musicUrl, localDest, 'music');
}
