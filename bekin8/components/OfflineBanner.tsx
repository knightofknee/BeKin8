// components/OfflineBanner.tsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOnline } from "../providers/NetworkProvider";
import { useTheme } from "../providers/ThemeProvider";

export default function OfflineBanner() {
  const online = useOnline();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (online) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        { paddingTop: insets.top + 4, backgroundColor: colors.danger },
      ]}
    >
      <Text style={styles.txt}>No internet connection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 6,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    elevation: 9999,
  },
  txt: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
