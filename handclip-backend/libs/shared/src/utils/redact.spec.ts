import { redactEmail, redactPushToken, redactUserId } from './redact';

describe('redactEmail', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['no-at-sign', 'no-at-sign'],
    ['@nolocal.com', '@nolocal.com'],
    ['user@', 'user@'],
    ['a@b.co', 'a***@b.co'],
    ['ab@b.co', 'ab***@b.co'],
    ['alice@example.com', 'al***@example.com'],
    ['chris.jones@sub.domain.io', 'ch***@sub.domain.io'],
  ])('redactEmail(%j) === %j', (input, expected) => {
    expect(redactEmail(input)).toBe(expected);
  });
});

describe('redactPushToken', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['short', '***'],
    ['12345678', '***'],
    ['ExponentPushToken[abcdef1234567890]', 'Exponent...'],
  ])('redactPushToken(%j) === %j', (input, expected) => {
    expect(redactPushToken(input)).toBe(expected);
  });
});

describe('redactUserId', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['short', '***'],
    ['12345678', '***'],
    ['550e8400-e29b-41d4-a716-446655440000', '550e8400...'],
  ])('redactUserId(%j) === %j', (input, expected) => {
    expect(redactUserId(input)).toBe(expected);
  });
});
