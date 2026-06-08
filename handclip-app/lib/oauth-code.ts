export interface NormalizedOAuthUserCode {
  compact: string;
  formatted: string;
}

const STRIP_PATTERN = /[\s-]+/g;

export function normalizeOAuthUserCode(code: string): NormalizedOAuthUserCode {
  const compact = code.replace(STRIP_PATTERN, '').toUpperCase();
  return {
    compact,
    formatted: code.trim(),
  };
}
