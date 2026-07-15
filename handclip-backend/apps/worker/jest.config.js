/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  rootDir: '.',
  // ponytail: transpile-only. The real type gate is `tsc --noEmit`
  // (pnpm --filter @handclip/worker type-check). ts-jest's full-program
  // type-check pulls pre-existing type errors from modules under test that
  // tsc --noEmit resolves away via project references (e.g. a fetch(object)
  // mismatch in transcription.processor.ts), which blocks loading the module
  // and running the unit tests.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
};
