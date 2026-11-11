// components/WebFrame.tsx
// Native: renders children as-is. Web build (waldgrave.com/bekin/app): keeps the app in a centered,
// phone-width column so it reads like the app on a desktop browser instead of stretching edge to edge.
import React from "react";
import { Platform, View } from "react-native";
import { useTheme } from "../providers/ThemeProvider";

const MAX_WIDTH = 480;

export default function WebFrame({ children }: React.PropsWithChildren) {
  const { colors } = useTheme();
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: "center", backgroundColor: colors.bg }}>
      {/* overflow CLIP, not hidden: some beacon layers are sized to the whole browser window, and a
          hidden overflow can still be scrolled sideways (opening the tour slid the app 110px left). */}
      <View style={{ flex: 1, width: "100%", maxWidth: MAX_WIDTH, overflow: "clip" as any }}>{children}</View>
    </View>
  );
}
