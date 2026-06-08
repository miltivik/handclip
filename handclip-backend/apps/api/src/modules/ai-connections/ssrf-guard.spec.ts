import { validateOpenAiCompatibleBaseUrl, isPrivateIp } from './ssrf-guard';

describe('isPrivateIp', () => {
  it('detects loopback 127.0.0.1', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
  });

  it('detects 10.x.x.x', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
  });

  it('detects 172.16.x.x', () => {
    expect(isPrivateIp('172.16.0.1')).toBe(true);
  });

  it('detects 192.168.x.x', () => {
    expect(isPrivateIp('192.168.1.1')).toBe(true);
  });

  it('detects 169.254.x.x (metadata)', () => {
    expect(isPrivateIp('169.254.169.254')).toBe(true);
  });

  it('allows public IP', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('detects IPv6 loopback ::1', () => {
    expect(isPrivateIp('::1')).toBe(true);
  });

  it('detects IPv6 link-local fe80::', () => {
    expect(isPrivateIp('fe80::1')).toBe(true);
  });

  it('detects IPv6 unique-local fc00::', () => {
    expect(isPrivateIp('fc00::1')).toBe(true);
  });

  it('detects canonical IPv4-mapped IPv6 loopback', () => {
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
  });

  it('does not throw for non-IP hostnames that contain only hex letters', () => {
    expect(isPrivateIp('dead.beef')).toBe(false);
  });
});

describe('validateOpenAiCompatibleBaseUrl', () => {
  it('rejects non-http(s) protocols', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('ftp://example.com/v1', false),
    ).rejects.toThrow('baseUrl must use http or https');
  });

  it('rejects URLs with credentials', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('https://user:pass@example.com/v1', false),
    ).rejects.toThrow('baseUrl must not contain credentials');
  });

  it('rejects public http URLs when private endpoints are disabled', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://example.com/v1', false),
    ).rejects.toThrow('baseUrl must use https unless private endpoints are enabled');
  });

  it('rejects empty or invalid hostname', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('https://', false),
    ).rejects.toThrow();
  });

  it('rejects localhost when allowPrivate is false', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://localhost:11434/v1', false),
    ).rejects.toThrow('blocked hostname');
  });

  it('allows localhost when allowPrivate is true', async () => {
    const result = await validateOpenAiCompatibleBaseUrl(
      'http://localhost:11434/v1',
      true,
    );
    expect(result).toBe('http://localhost:11434/v1');
  });

  it('rejects 127.0.0.1 when allowPrivate is false', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://127.0.0.1:11434/v1', false),
    ).rejects.toThrow('private/link-local IP');
  });

  it('rejects IPv6 loopback literal when allowPrivate is false', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://[::1]:11434/v1', false),
    ).rejects.toThrow('private/link-local IP');
  });

  it('rejects IPv4-mapped IPv6 loopback literal when allowPrivate is false', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://[::ffff:127.0.0.1]:11434/v1', false),
    ).rejects.toThrow('private/link-local IP');
  });

  it('rejects IPv6 link-local literal when allowPrivate is false', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://[fe80::1]:11434/v1', false),
    ).rejects.toThrow('private/link-local IP');
  });

  it('rejects IPv6 unique-local literal when allowPrivate is false', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://[fc00::1]:11434/v1', false),
    ).rejects.toThrow('private/link-local IP');
  });

  it('rejects 169.254.169.254 (cloud metadata)', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('http://169.254.169.254/latest/meta-data', false),
    ).rejects.toThrow('private/link-local IP');
  });

  it('allows 127.0.0.1 when allowPrivate is true', async () => {
    const result = await validateOpenAiCompatibleBaseUrl(
      'http://127.0.0.1:11434/v1',
      true,
    );
    expect(result).toBe('http://127.0.0.1:11434/v1');
  });

  it('strips trailing slash', async () => {
    const result = await validateOpenAiCompatibleBaseUrl(
      'http://localhost:11434/v1/',
      true,
    );
    expect(result).toBe('http://localhost:11434/v1');
  });

  it('rejects invalid URL', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('not-a-url', false),
    ).rejects.toThrow('not a valid URL');
  });

  it('rejects empty string', async () => {
    await expect(
      validateOpenAiCompatibleBaseUrl('', false),
    ).rejects.toThrow('baseUrl is required');
  });
});
