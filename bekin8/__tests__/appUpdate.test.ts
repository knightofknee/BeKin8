import { DISMISS_SNOOZE_MS, isNewerVersion, isOlderBuild, isSnoozed } from "../lib/appUpdate";

// Plain ts-jest environment (no Expo/RN transforms): stub the native modules
// appUpdate imports for its fetch/storage paths; only the pure helpers are under
// test here. jest hoists these above the import.
jest.mock(
  "expo-application",
  () => ({ applicationId: null, nativeApplicationVersion: null }),
  { virtual: true }
);
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }), { virtual: true });
jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({ default: { getItem: jest.fn(), setItem: jest.fn() } }),
  { virtual: true }
);
jest.mock(
  "firebase/firestore",
  () => ({ doc: jest.fn(), getDoc: jest.fn() }),
  { virtual: true }
);
jest.mock("../firebase.config", () => ({ db: {} }), { virtual: true });

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

describe("isSnoozed", () => {
  const now = 1_000_000_000;

  it("is quiet within the snooze window for the dismissed version", () => {
    expect(isSnoozed("1.2.25", { version: "1.2.25", at: now - 1 }, now)).toBe(true);
    expect(
      isSnoozed("1.2.25", { version: "1.2.25", at: now - DISMISS_SNOOZE_MS + 1 }, now)
    ).toBe(true);
  });

  it("re-prompts once the snooze expires", () => {
    expect(
      isSnoozed("1.2.25", { version: "1.2.25", at: now - DISMISS_SNOOZE_MS }, now)
    ).toBe(false);
  });

  it("prompts immediately for a version other than the dismissed one", () => {
    expect(isSnoozed("1.2.26", { version: "1.2.25", at: now - 1 }, now)).toBe(false);
  });

  it("prompts when nothing was dismissed", () => {
    expect(isSnoozed("1.2.25", null, now)).toBe(false);
  });
});

describe("isOlderBuild (Android versionCode dials)", () => {
  it("prompts only when the running build is below the target", () => {
    expect(isOlderBuild(14, "13")).toBe(true);
    expect(isOlderBuild(14, "14")).toBe(false);
    expect(isOlderBuild(14, "15")).toBe(false);
    expect(isOlderBuild(100, "99")).toBe(true);
  });

  it("bails to false on unset or garbage values", () => {
    expect(isOlderBuild(undefined, "13")).toBe(false);
    expect(isOlderBuild("14", "13")).toBe(false);
    expect(isOlderBuild(0, "13")).toBe(false);
    expect(isOlderBuild(14.5, "13")).toBe(false);
    expect(isOlderBuild(14, null)).toBe(false);
    expect(isOlderBuild(14, "")).toBe(false);
    expect(isOlderBuild(14, "abc")).toBe(false);
  });
});
