import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Keyboard } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../providers/ThemeProvider";
import { tap } from "../utils/haptics";

type TabKey = "home" | "feed" | "friends" | "create-post" | "settings";
type IoniconName = keyof typeof Ionicons.glyphMap;
type Tab = {
  key: TabKey;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
  color: string;
  href: `/${string}`;
};

// Each tab keeps its own brand color so the bar reads as colorful, not gray.
const TABS: Tab[] = [
  { key: "home",        label: "Home",     icon: "home-outline",      iconActive: "home",      color: "#2F6FED", href: "/home" },
  { key: "feed",        label: "Feed",     icon: "newspaper-outline", iconActive: "newspaper", color: "#F97316", href: "/feed" },
  { key: "friends",     label: "Friends",  icon: "people-outline",    iconActive: "people",    color: "#10B981", href: "/friends" },
  { key: "create-post", label: "Post",     icon: "create-outline",    iconActive: "create",    color: "#A855F7", href: "/create-post" },
  { key: "settings",    label: "Settings", icon: "settings-outline",  iconActive: "settings",  color: "#64748B", href: "/settings" },
];

export default function BottomBar() {
  const { colors } = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  const activeKey: TabKey | null = useMemo(() => {
    if (pathname?.startsWith("/home"))         return "home";
    if (pathname?.startsWith("/feed"))         return "feed";
    if (pathname?.startsWith("/friends"))      return "friends";
    if (pathname?.startsWith("/create-post"))  return "create-post";
    if (pathname?.startsWith("/settings"))     return "settings";
    return null;
  }, [pathname]);

  const onNav = (href: `/${string}`) => {
    tap();
    Keyboard.dismiss();
    router.push(href as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <View style={styles.row}>
        {TABS.map((tab) => {
          const active = activeKey === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onNav(tab.href)}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.85 }]}
              android_ripple={{ color: colors.border, borderless: true }}
              hitSlop={6}
            >
              <Ionicons
                name={active ? tab.iconActive : tab.icon}
                size={24}
                color={tab.color}
                style={[styles.icon, !active && styles.iconInactive]}
              />
              <Text
                style={[
                  styles.label,
                  { color: colors.tabInactive },
                  active && { color: tab.color },
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
              {active ? <View style={[styles.activePill, { backgroundColor: tab.color }]} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.bottomInset} />
    </View>
  );
}

const BAR_HEIGHT = 64;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    zIndex: 999,
    borderTopWidth: 1,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: -2 } },
      android: { elevation: 10 },
    }),
  },
  row: {
    flexDirection: "row",
    height: BAR_HEIGHT,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "space-between",
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 6, paddingBottom: 10 },
  icon: { marginBottom: 2 },
  iconInactive: { opacity: 0.55 },
  label: { fontSize: 11, fontWeight: "700" },
  activePill: { position: "absolute", bottom: 2, width: 26, height: 3, borderRadius: 999 },
  bottomInset: { height: Platform.select({ ios: 8, android: 0 }) },
});
