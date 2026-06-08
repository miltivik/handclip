import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, vi } from 'vitest';
import { downloadMusicAsset } from './source-video';

function blobFromText(text: string): Blob {
  return new Blob([text], { type: 'audio/mpeg' });
}

describe('downloadMusicAsset', () => {
  it('downloads a storage path from the source-videos bucket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'music-asset-'));
    const output = join(dir, 'music.mp3');
    const download = vi.fn().mockResolvedValue({ data: blobFromText('audio bytes'), error: null });
    const supabaseService = {
      getServiceRoleClient: () => ({
        storage: { from: vi.fn(() => ({ download })) },
      }),
    } as any;

    await expect(
      downloadMusicAsset(supabaseService, 'user-1/music/theme.mp3', output),
    ).resolves.toBe(output);
    expect(download).toHaveBeenCalledWith('user-1/music/theme.mp3');
    expect(readFileSync(output, 'utf8')).toBe('audio bytes');
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects local file URIs in queued render jobs', async () => {
    await expect(
      downloadMusicAsset({} as any, 'file:///tmp/theme.mp3', '/tmp/music.mp3'),
    ).rejects.toThrow('Local music files must be uploaded before rendering');
  });

  it('rejects absolute local file paths in queued render jobs', async () => {
    await expect(
      downloadMusicAsset({} as any, '/tmp/theme.mp3', '/tmp/music.mp3'),
    ).rejects.toThrow('Local music files must be uploaded before rendering');
  });
});
