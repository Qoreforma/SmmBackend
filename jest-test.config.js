module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1"
  },
  globalSetup: "<rootDir>/src/tests/globalSetup.ts",
  globalTeardown: "<rootDir>/src/tests/globalTeardown.ts",
  setupFilesAfterEnv: ["<rootDir>/src/tests/setup.ts"]
};
