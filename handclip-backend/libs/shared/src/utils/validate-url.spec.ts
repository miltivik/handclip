import { validatePublicUrl } from './validate-url';

// validatePublicUrl rejects obvious non-public inputs before doing DNS.
// Real DNS for the public-URL happy path requires network; tested manually via smoke scripts.

describe('validatePublicUrl', () => {
  it('rejects non-http protocols', async () => {
    await expect(validatePublicUrl('ftp://example.com/video.mp4')).rejects.toThrow(/http/i);
  });

  it.each([
    'http://localhost/video.mp4',
    'http://redis:6379/video.mp4',
    'http://supabase/video.mp4',
    'http://database:5432/video.mp4',
  ])('rejects internal hostname %s', async (url) => {
    await expect(validatePublicUrl(url)).rejects.toThrow(/internal/i);
  });

  it.each([
    'http://127.0.0.1/video.mp4',
    'http://10.0.0.1/video.mp4',
    'http://192.168.1.1/video.mp4',
    'http://169.254.169.254/latest/meta-data/', // AWS metadata
  ])('rejects private IPv4 %s', async (url) => {
    await expect(validatePublicUrl(url)).rejects.toThrow();
  });

  it('rejects malformed URLs', async () => {
    await expect(validatePublicUrl('not-a-url')).rejects.toThrow();
  });
});
