import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

const appIndexPath = join(root, 'app', 'index.tsx');
const appIndex = readFileSync(appIndexPath, 'utf8');

if (appIndex.includes('/(onboarding)/index')) {
  failures.push('Root redirect uses invalid Expo Router href "/(onboarding)/index". Use "/onboarding".');
}

if (!appIndex.includes('href="/onboarding"')) {
  failures.push('Root redirect does not target visible onboarding route "/onboarding".');
}

if (existsSync(join(root, 'app', '(onboarding)', 'index.tsx'))) {
  failures.push('Onboarding screen is inside invisible group "(onboarding)", so its index route conflicts with root "/".');
}

if (!existsSync(join(root, 'app', 'onboarding', 'index.tsx'))) {
  failures.push('Missing visible app/onboarding/index.tsx route.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Onboarding route wiring OK.');
