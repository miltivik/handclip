import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as dns from 'node:dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMusicAsset } from './source-video';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const lookupMock = vi.mocked(dns.lookup);

afterEach(() => {
  vi.restoreAllMocks();
  lookupMock.mockReset();
});

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

  it('rejects HTTP redirects to private addresses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'music-asset-'));
    const output = join(dir, 'music.mp3');
    lookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }] as any);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if ((init as RequestInit | undefined)?.redirect !== 'manual') {
        return new Response('private bytes', { status: 200 });
      }
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/latest/meta-data' },
      });
    });

    await expect(
      downloadMusicAsset({} as any, 'https://cdn.example.com/theme.mp3', output),
    ).rejects.toThrow('Blocked music redirect URL');
    expect(existsSync(output)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
