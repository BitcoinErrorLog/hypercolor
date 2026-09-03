/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.@(ts|tsx)'],
  // exFAT volumes grow macOS AppleDouble (._*) junk files; never treat them as code
  testPathIgnorePatterns: ['/node_modules/', '/\\._', '/vrt/output/'],
  modulePathIgnorePatterns: ['/\\._'],
  clearMocks: true,
  // jest-expo default allow-list plus uuid@13 (pure ESM).
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|uuid))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
};
