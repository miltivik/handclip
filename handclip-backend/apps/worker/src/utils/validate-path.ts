import * as path from 'path';
import * as os from 'os';

/**
 * Validates that a file path is safe for use in shell commands.
 * - Must resolve within the OS temp directory
 * - Must not contain shell metacharacters that could enable injection
 */
export function validateTempPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const tmpdir = path.resolve(os.tmpdir());

  // Ensure the resolved path is within the temp directory
  if (!resolved.startsWith(tmpdir + path.sep) && resolved !== tmpdir) {
    throw new Error(
      `Path validation failed: "${filePath}" resolves outside of temp directory (${tmpdir})`,
    );
  }

  // Reject paths containing shell metacharacters (defense in depth)
  if (/[;&|`$(){}[\]!<>*\n\r]/.test(resolved)) {
    throw new Error(
      `Path validation failed: "${filePath}" contains shell metacharacters`,
    );
  }

  return resolved;
}
