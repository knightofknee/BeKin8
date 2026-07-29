// Minimal ts-jest setup for plain unit tests (no Expo/RN transforms). Only files under
// __tests__ run here; native modules a lib file imports get stubbed per-test with
// jest.mock(..., { virtual: true }).
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        // The app tsconfig targets the Metro bundler; override the bits Node/Jest needs.
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          types: ["jest", "node"],
        },
      },
    ],
  },
};
