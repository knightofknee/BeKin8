// components/ui/webSwitch.ts
// react-native-web ignores `thumbColor` while a Switch is ON and paints its own teal knob
// (activeThumbColor, a web-only prop RN's types don't declare). Spread this next to thumbColor="#fff"
// so the knob stays white on the web build too. Native ignores the prop.
export const WEB_WHITE_KNOB = { activeThumbColor: "#fff" } as Record<string, unknown>;
