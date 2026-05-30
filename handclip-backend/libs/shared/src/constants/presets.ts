export const EXPORT_PRESETS = {
  tiktok:   { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '128k', crf: 18, preset: 'fast' },
  reels:    { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '128k', crf: 18, preset: 'fast' },
  shorts:   { width: 1080, height: 1920, videoBitrate: '8M',  audioBitrate: '128k', crf: 18, preset: 'fast' },
  draft:    { width: 720,  height: 1280, videoBitrate: '2M',  audioBitrate: '96k',  crf: 28, preset: 'ultrafast' },
  hq:       { width: 1080, height: 1920, videoBitrate: '20M', audioBitrate: '256k', crf: 15, preset: 'slow' },
} as const;

export type ExportPreset = keyof typeof EXPORT_PRESETS;