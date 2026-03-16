import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Keyboard } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useTheme } from "../providers/ThemeProvider";

type TabKey = "home" | "feed" | "friends" | "create-post" | "settings";
type Tab = { key: TabKey; label: string; emoji: string; href: `/${string}` };

const TABS: Tab[] = [
  { key: "home",        label: "Home",     emoji: "🏠", href: "/home" },
  { key: "feed",        label: "Feed",     emoji: "📰", href: "/feed" },
  { key: "friends",     label: "Friends",  emoji: "👥", href: "/friends" },
  { key: "create-post", label: "Post",     emoji: "✍️", href: "/create-post" },
  { key: "settings",    label: "Settings", emoji: "⚙️", href: "/settings" },
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
              <Text style={[styles.emoji, active && styles.emojiActive]}>{tab.emoji}</Text>
              <Text style={[styles.label, { color: colors.tabInactive }, active && { color: colors.primary }]} numberOfLines={1}>
                {tab.label}
              </Text>
              {active ? <View style={[styles.activePill, { backgroundColor: colors.primary }]} /> : null}
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
  tab: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 6 },
  emoji: { fontSize: 20, marginBottom: 2, opacity: 0.7 },
  emojiActive: { opacity: 1 },
  label: { fontSize: 11, fontWeight: "700" },
  activePill: { position: "absolute", bottom: 6, width: 26, height: 3, borderRadius: 999 },
  bottomInset: { height: Platform.select({ ios: 8, android: 0 }) },
});
