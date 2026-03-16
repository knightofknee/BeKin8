// components/ui/colors.ts

export type ThemeColors = {
  primary: string;
  bg: string;
  card: string;
  text: string;
  subtle: string;
  border: string;
  error: string;
  success: string;
  danger: string;
  dark: string;
  inputBg: string;
  bubbleMine: string;
  bubbleMineText: string;
  bubbleMineBorder: string;
  bubbleTheirs: string;
  bubbleTheirsBorder: string;
  headerBg: string;
  skeleton: string;
  postBg: string;
  backdrop: string;
  tabInactive: string;
  linkText: string;
};

export const lightColors: ThemeColors = {
  primary: "#2F6FED",
  bg: "#F5F8FF",
  card: "#FFFFFF",
  text: "#111827",
  subtle: "#6B7280",
  border: "#E5E7EB",
  error: "#B00020",
  success: "#0E7A0D",
  danger: "#B00020",
  dark: "#111827",
  inputBg: "#FFFFFF",
  bubbleMine: "#EEF2FF",
  bubbleMineText: "#0B1426",
  bubbleMineBorder: "#D4DEFF",
  bubbleTheirs: "#FFFFFF",
  bubbleTheirsBorder: "#E5E7EB",
  headerBg: "#F8FAFF",
  skeleton: "#E5E7EB",
  postBg: "#f9f9f9",
  backdrop: "rgba(0,0,0,0.28)",
  tabInactive: "#6B7280",
  linkText: "#2F6FED",
};

export const darkColors: ThemeColors = {
  primary: "#4B8BFF",
  bg: "#0F1117",
  card: "#1A1D27",
  text: "#E5E7EB",
  subtle: "#9CA3AF",
  border: "#2D3140",
  error: "#EF4444",
  success: "#22C55E",
  danger: "#EF4444",
  dark: "#E5E7EB",
  inputBg: "#232733",
  bubbleMine: "#1E2A4A",
  bubbleMineText: "#E5E7EB",
  bubbleMineBorder: "#2D4A7A",
  bubbleTheirs: "#1A1D27",
  bubbleTheirsBorder: "#2D3140",
  headerBg: "#141620",
  skeleton: "#2D3140",
  postBg: "#1A1D27",
  backdrop: "rgba(0,0,0,0.55)",
  tabInactive: "#6B7280",
  linkText: "#4B8BFF",
};

// Legacy default export for files that haven't migrated yet
export const colors = lightColors;
