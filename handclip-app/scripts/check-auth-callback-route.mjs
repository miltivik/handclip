import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

const callbackRoute = join(root, 'app', 'auth', 'callback.tsx');
if (!existsSync(callbackRoute)) {
  failures.push('Missing app/auth/callback.tsx route for auth redirect URL /auth/callback.');
}

const authStorePath = join(root, 'stores', 'auth.store.ts');
const authStore = readFileSync(authStorePath, 'utf8');
if (authStore.includes('handclip://auth/callback')) {
  failures.push('Auth store still hardcodes handclip://auth/callback instead of runtime Linking redirect URI.');
}

if (!authStore.includes('createAuthRedirectUri')) {
  failures.push('Auth store does not use createAuthRedirectUri for OAuth and magic-link redirects.');
}

if (!authStore.includes('completeAuthCallback')) {
  failures.push('Google OAuth browser result is not completed through Supabase session callback handling.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Auth callback route and redirect wiring OK.');
