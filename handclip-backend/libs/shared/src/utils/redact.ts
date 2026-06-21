// ponytail: stdlib regex only, no new deps. Three minimal PII scrubbers
// for console logs. Each keeps a short prefix for debuggability and
// drops the rest. redactEmail expects a clean email; pass the user
// parameter (not the full error message) to avoid mangling prose.

export function redactEmail(email: string | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 0 || at === email.length - 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function redactPushToken(token: string | undefined): string {
  if (!token) return '';
  if (token.length <= 8) return '***';
  return `${token.slice(0, 8)}...`;
}

export function redactUserId(id: string | undefined): string {
  if (!id) return '';
  if (id.length <= 8) return '***';
  return `${id.slice(0, 8)}...`;
}
