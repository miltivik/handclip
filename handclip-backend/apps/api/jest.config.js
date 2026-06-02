module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@handclip/shared$': '<rootDir>/../../dist/libs/shared/src/index.js',
    '^@handclip/shared/(.*)$': '<rootDir>/../../dist/libs/shared/src/$1',
  },
};
