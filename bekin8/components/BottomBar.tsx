import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Keyboard } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../firebase.config";
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
  const insets = useSafeAreaInsets();

  const activeKey: TabKey | null = useMemo(() => {
    if (pathname?.startsWith("/home"))         return "home";
    if (pathname?.startsWith("/feed"))         return "feed";
    if (pathname?.startsWith("/friends"))      return "friends";
    if (pathname?.startsWith("/create-post"))  return "create-post";
    if (pathname?.startsWith("/settings"))     return "settings";
    return null;
  }, [pathname]);

  // Pending incoming friend-request count -> badge on the Friends tab. Mirrors the exact query
  // app/friends.tsx uses for its incoming list: FriendRequests where receiverUid == me AND
  // status == "pending". Surfaces requests that otherwise have no push + no badge.
  const [pendingRequests, setPendingRequests] = useState(0);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setPendingRequests(0);
      return;
    }
    const qIn = query(
      collection(db, "FriendRequests"),
      where("receiverUid", "==", uid),
      where("status", "==", "pending")
    );
    const unsub = onSnapshot(
      qIn,
      (snap) => setPendingRequests(snap.size),
      () => setPendingRequests(0)
    );
    return unsub;
  }, [pathname]);

  const onNav = (href: `/${string}`, isActive: boolean) => {
    tap();
    Keyboard.dismiss();
    // Already on this tab: do nothing. router.push would stack a duplicate mounted instance
    // (extra Firestore listeners, audio, Skia; broken Android back). navigate dedupes to the
    // existing route rather than pushing a new one.
    if (isActive) return;
    router.navigate(href as any);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      <View style={styles.row}>
        {TABS.map((tab) => {
          const active = activeKey === tab.key;
          const showBadge = tab.key === "friends" && pendingRequests > 0;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onNav(tab.href, active)}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.85 }]}
              android_ripple={{ color: colors.border, borderless: true }}
              hitSlop={6}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                showBadge
                  ? `${tab.label}, ${pendingRequests} pending friend request${pendingRequests === 1 ? "" : "s"}`
                  : tab.label
              }
            >
              <View>
                <Ionicons
                  name={active ? tab.iconActive : tab.icon}
                  size={24}
                  color={tab.color}
                  style={[styles.icon, !active && styles.iconInactive]}
                />
                {showBadge ? (
                  <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.card }]}>
                    <Text style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                      {pendingRequests > 9 ? "9+" : pendingRequests}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[
                  styles.label,
                  { color: colors.tabInactive },
                  active && { color: tab.color },
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
              >
                {tab.label}
              </Text>
              {active ? <View style={[styles.activePill, { backgroundColor: tab.color }]} /> : null}
            </Pressable>
          );
        })}
      </View>
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
  badge: {
    position: "absolute",
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800", lineHeight: 13 },
});
