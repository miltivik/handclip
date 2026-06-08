import { SupabaseService } from '../modules/supabase/supabase.service';

const BUCKET = 'source-videos';

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
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${label} (${url.slice(0, 80)}): HTTP ${res.status}`,
    );
  }
  const fs = await import('fs');
  fs.writeFileSync(localDest, Buffer.from(await res.arrayBuffer()));
  return localDest;
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
