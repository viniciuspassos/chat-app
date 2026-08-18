/** @type {import('jest').Config} */
module.exports = {
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['js', 'json', 'ts'],
  preset: 'ts-jest',
  rootDir: '.',
  setupFiles: ['<rootDir>/test/set-test-environment.ts'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.spec.ts'],
};
