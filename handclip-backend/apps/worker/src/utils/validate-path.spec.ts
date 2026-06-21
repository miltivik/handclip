import * as os from 'os';
import * as path from 'path';
import { validateTempPath } from './validate-path';

describe('validateTempPath', () => {
  it('accepts a path inside the OS temp directory', () => {
    const ok = path.join(os.tmpdir(), 'handclip-test', 'input.mp4');
    expect(validateTempPath(ok)).toBe(ok);
  });

  it('rejects a path that resolves outside the temp directory', () => {
    expect(() => validateTempPath('/etc/passwd')).toThrow(/outside/i);
    expect(() => validateTempPath(path.join(os.tmpdir(), '..', 'etc', 'passwd'))).toThrow(/outside/i);
  });

  // Shell metacharacter defense: validateTempPath runs as a final guard before
  // any execAsync; a stray ';' or '$(' would be a shell-injection vector.
  it.each([
    '/tmp/$(rm -rf /)/x.mp4',
    '/tmp/foo;rm.mp4',
    '/tmp/foo|cat.mp4',
    '/tmp/foo`id`.mp4',
    '/tmp/foo\nrm.mp4',
  ])('rejects path with shell metacharacters: %s', (bad) => {
    expect(() => validateTempPath(bad)).toThrow();
  });
});
