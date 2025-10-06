import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { usePathname, useRouter } from "expo-router";

type TabKey = "home" | "feed" | "friends" | "create-post" | "settings";
type Tab = { key: TabKey; label: string; emoji: string; href: `/${string}` };

const TABS: Tab[] = [
  { key: "home",        label: "Home",     emoji: "🏠", href: "/home" },
  { key: "feed",        label: "Feed",     emoji: "📰", href: "/feed" },
  { key: "friends",     label: "Friends",  emoji: "👥", href: "/friends" },
  { key: "create-post", label: "Post",     emoji: "✍️", href: "/create-post" },
  { key: "settings",    label: "Settings", emoji: "⚙️", href: "/settings" }, // NEW last item
];

export default function BottomBar() {
  const router = useRouter();
  const pathname = usePathname();

  const activeKey: TabKey | null = useMemo(() => {
    if (pathname?.startsWith("/home"))         return "home";
    if (pathname?.startsWith("/feed"))         return "feed";
    if (pathname?.startsWith("/friends"))      return "friends";
    if (pathname?.startsWith("/create-post"))  return "create-post";
    if (pathname?.startsWith("/settings"))     return "settings"; // NEW
    return null;
  }, [pathname]);

  const onNav = (href: `/${string}`) => {
    router.push(href);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={styles.container}>
        <View style={styles.row}>
          {TABS.map((tab) => {
            const active = activeKey === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => onNav(tab.href)}
                style={({ pressed }) => [styles.tab, pressed && { opacity: 0.85 }]}
                android_ripple={{ color: "#E5E7EB", borderless: true }}
                hitSlop={6}
              >
                <Text style={[styles.emoji, active && styles.emojiActive]}>{tab.emoji}</Text>
                <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                  {tab.label}
                </Text>
                {active ? <View style={styles.activePill} /> : null}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.bottomInset} />
      </View>
    </View>
  );
}

const BAR_HEIGHT = 64;

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1, borderTopColor: "#E5E7EB",
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
  label: { fontSize: 11, fontWeight: "700", color: "#6B7280" },
  labelActive: { color: "#2F6FED" },
  activePill: { position: "absolute", bottom: 6, width: 26, height: 3, borderRadius: 999, backgroundColor: "#2F6FED" },
  bottomInset: { height: Platform.select({ ios: 8, android: 0 }) },
});
