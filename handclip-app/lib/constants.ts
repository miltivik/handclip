
export interface PresetConfig {
  resolution: string;
  bitrate: number;
  fps: number;
  aspectRatio: string;
}

export const PRESETS: Record<'tiktok' | 'reels' | 'shorts', PresetConfig> = {
  tiktok: {
    resolution: '1080×1920',
    bitrate: 8000000,
    fps: 30,
    aspectRatio: '9:16',
  },
  reels: {
    resolution: '1080×1920',
    bitrate: 6000000,
    fps: 30,
    aspectRatio: '9:16',
  },
  shorts: {
    resolution: '1080×1920',
    bitrate: 10000000,
    fps: 60,
    aspectRatio: '9:16',
  },
};

export const MAX_VIDEO_DURATION_SEC = 600; // 10 minutes
export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB — must match libs/shared/src/constants/limits.ts
