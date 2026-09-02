/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.@(ts|tsx)'],
  // exFAT volumes grow macOS AppleDouble (._*) junk files; never treat them as code
  testPathIgnorePatterns: ['/node_modules/', '/\\._', '/vrt/output/'],
  modulePathIgnorePatterns: ['/\\._'],
  clearMocks: true,
};
