import { isNewerVersion } from "../lib/appUpdate";

// Plain ts-jest environment (no Expo/RN transforms): stub the native modules
// appUpdate imports for its fetch path; only the pure comparator is under test
// here. jest hoists these above the import.
jest.mock(
  "expo-application",
  () => ({ applicationId: null, nativeApplicationVersion: null }),
  { virtual: true }
);
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }), { virtual: true });

describe("isNewerVersion", () => {
  it("detects a newer store version", () => {
    expect(isNewerVersion("1.2.25", "1.2.24")).toBe(true);
    expect(isNewerVersion("1.3.0", "1.2.24")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.2.10", "1.2.9")).toBe(true);
  });

  it("returns false when equal or older", () => {
    expect(isNewerVersion("1.2.24", "1.2.24")).toBe(false);
    expect(isNewerVersion("1.2.23", "1.2.24")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
  });

  it("treats missing segments as zero", () => {
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.2.1", "1.2")).toBe(true);
    expect(isNewerVersion("1.2", "1.1.9")).toBe(true);
  });

  it("never prompts on malformed versions", () => {
    expect(isNewerVersion("abc", "1.2.24")).toBe(false);
    expect(isNewerVersion("1.2.x", "1.2.24")).toBe(false);
    expect(isNewerVersion("", "1.2.24")).toBe(false);
  });
});
