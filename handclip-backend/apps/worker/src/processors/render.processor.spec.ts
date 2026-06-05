import { describe, it, expect } from 'vitest';
import { escapeDrawtextText, getDrawtextY, RenderProcessor } from './render.processor';

// Minimal config for testing buildFFmpegCommand
const minimalConfig = {
  width: 1080,
  height: 1920,
  videoBitrate: '8M',
  audioBitrate: '128k',
  crf: 18,
  preset: 'fast',
} as const;

const baseOpts = {
  inputPath: '/tmp/input.mp4',
  srtPath: null as string | null,
  musicPath: null as string | null,
  trimStart: 0,
  trimEnd: 10,
  config: minimalConfig,
  outputPath: '/tmp/output.mp4',
};

// Helper to call the private method via prototype
function callBuildFFmpegCommand(opts: Record<string, unknown>): string {
  const prototype = RenderProcessor.prototype as unknown as Record<string, unknown>;
  const method = prototype.buildFFmpegCommand as ((opts: Record<string, unknown>) => string) | undefined;
  return method ? method.call({}, opts) : '';
}

describe('render.processor helpers', () => {
  describe('escapeDrawtextText', () => {
    it('passes through simple text unchanged', () => {
      expect(escapeDrawtextText('Hello World')).toBe('Hello World');
    });

    it('escapes backslash', () => {
      // Use String.fromCharCode to create exact input bytes to avoid JS string escape confusion
      const backslash = String.fromCharCode(92);
      const input = 'C:' + backslash + 'tmp';
      const output = escapeDrawtextText(input);
      // After escaping, backslash becomes \\
      expect(output).toBe('C:' + backslash + backslash + 'tmp');
    });

    it('escapes single quote', () => {
      // Single quote becomes \' (backslash + quote) in FFmpeg escape
      expect(escapeDrawtextText("O'Reilly")).toBe("O\\'Reilly");
    });

    it('does NOT escape colon (non-escape mode)', () => {
      // Colons don't need escaping in simple text mode for drawtext
      expect(escapeDrawtextText('time: 12:30')).toBe('time: 12:30');
    });
    it('escapes percent for FFmpeg expansion', () => {
      expect(escapeDrawtextText('50% complete')).toBe('50%% complete');
    });
    it('replaces newline with space to prevent filtergraph break', () => {
      expect(escapeDrawtextText('line1\nline2')).toBe('line1 line2');
    });
    it('replaces carriage return with space to prevent filtergraph break', () => {
      expect(escapeDrawtextText('line1\rline2')).toBe('line1 line2');
    });
    it('handles complex real-world input: O\'Reilly: C:\\tmp', () => {
      // Input: O[apostrophe]Reilly[colon]C[backslash]tmp
      const backslash = String.fromCharCode(92);
      const input = 'O' + "'" + 'Reilly' + ':' + 'C' + backslash + 'tmp';
      // After escaping: O\'Reilly:C\\tmp (no colon escape, but backslash and quote escaped)
      const expected = 'O' + backslash + "'" + 'Reilly' + ':' + 'C' + backslash + backslash + 'tmp';
      expect(escapeDrawtextText(input)).toBe(expected);
    });

    it('escapes backslash first before other chars', () => {
      // Backslash in input must be escaped to \\ first,
      // otherwise \r becomes \n etc. during replacement
      const backslash = String.fromCharCode(92);
      const input = backslash + 'n'; // literal \n
      const output = escapeDrawtextText(input);
      expect(output).toBe(backslash + backslash + 'n'); // not space
    });
  });

  describe('getDrawtextY', () => {
    it('returns 80 for top position', () => {
      expect(getDrawtextY('top')).toBe('80');
    });

    it('returns (h-text_h)/2 for center position', () => {
      expect(getDrawtextY('center')).toBe('(h-text_h)/2');
    });

    it('returns h-text_h-160 for bottom position', () => {
      expect(getDrawtextY('bottom')).toBe('h-text_h-160');
    });

    it('defaults to bottom position for unknown', () => {
      expect(getDrawtextY('middle')).toBe('h-text_h-160');
      expect(getDrawtextY('')).toBe('h-text_h-160');
    });
  });
});

describe('buildFFmpegCommand speed options', () => {
  it('speed=2 includes setpts=PTS/2 in video filters', () => {
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 2 });
    expect(cmd).toContain('setpts=PTS/2');
  });

  it('speed=0.5 includes setpts=PTS/0.5 in video filters', () => {
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 0.5 });
    expect(cmd).toContain('setpts=PTS/0.5');
  });

  it('speed=1 does NOT include extra setpts', () => {
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 1 });
    // Should have setpts=PTS-STARTPTS from trim, but not setpts=PTS/1
    expect(cmd).not.toContain('setpts=PTS/1');
  });

  it('speed=2 includes atempo=2 in audio chain', () => {
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 2 });
    expect(cmd).toContain('atempo=2');
  });

  it('speed=0.5 includes atempo=0.5 in audio chain', () => {
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 0.5 });
    expect(cmd).toContain('atempo=0.5');
  });

  it('speed=1 does NOT include atempo', () => {
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 1 });
    expect(cmd).not.toContain('atempo');
  });
});

describe('buildFFmpegCommand textOverlay', () => {
  it('includes drawtext filter when textOverlay has text', () => {
    const cmd = callBuildFFmpegCommand({
      ...baseOpts,
      textOverlay: { text: 'Hello', position: 'top' },
    });
    expect(cmd).toContain('drawtext=');
    expect(cmd).toContain('Hello');
  });

  it('escapes text with special characters in drawtext', () => {
    const cmd = callBuildFFmpegCommand({
      ...baseOpts,
      textOverlay: { text: "Test's 50%", position: 'center' },
    });
    expect(cmd).toContain('drawtext=');
    expect(cmd).toContain("Test\\'s"); // escaped quote
    expect(cmd).toContain('50%%'); // escaped percent
  });

  it('does NOT include drawtext when textOverlay is null', () => {
    const cmd = callBuildFFmpegCommand({ ...baseOpts, textOverlay: null });
    expect(cmd).not.toContain('drawtext=');
  });

  it('does NOT include drawtext when textOverlay.text is empty', () => {
    const cmd = callBuildFFmpegCommand({
      ...baseOpts,
      textOverlay: { text: '', position: 'bottom' },
    });
    expect(cmd).not.toContain('drawtext=');
  });

  it('drawtext comes before subtitles in filter chain', () => {
    // With both text overlay and subtitles
    const cmd = callBuildFFmpegCommand({
      ...baseOpts,
      srtPath: '/tmp/subs.srt',
      textOverlay: { text: 'Overlay', position: 'top' },
    });
    const drawtextIdx = cmd.indexOf('drawtext=');
    const subtitlesIdx = cmd.indexOf('subtitles=');
    expect(drawtextIdx).toBeLessThan(subtitlesIdx);
  });
});

describe('buildFFmpegCommand outputDuration for fade', () => {
  it('uses outputDuration for fade-out timing when speed != 1', () => {
    // With speed=2, duration=10 becomes outputDuration=5
    // fade-out should start at 5 - 0.5 = 4.5
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 2 });
    // Original audio fade: outputDuration - 0.5 = 5 - 0.5 = 4.5
    expect(cmd).toContain('st=4.5:d=0.5');
  });

  it('uses original duration for fade-out timing when speed=1', () => {
    // With speed=1, duration=10, fade-out should start at 10 - 0.5 = 9.5
    const cmd = callBuildFFmpegCommand({ ...baseOpts, speed: 1 });
    expect(cmd).toContain('st=9.5:d=0.5');
  });
});