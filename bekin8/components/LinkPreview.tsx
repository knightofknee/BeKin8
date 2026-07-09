import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  Linking,
  StyleSheet,
  Animated,
  Alert,
  ActionSheetIOS,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useTheme } from "../providers/ThemeProvider";
import { tap } from "../utils/haptics";

interface OGData {
  title?: string;
  description?: string;
  image?: string;
}

// Module-scoped cache so each URL's preview is fetched from the server at most once per
// session (mirrors lib/prefetchBeaconMessages dedup). 'error' is a sentinel so a failed
// lookup falls back to a plain link without re-calling the function.
const previewCache = new Map<string, OGData | "error">();

function domain(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(
      /^www\./,
      ""
    );
  } catch {
    return url;
  }
}

function normaliseUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// ── Shimmer placeholder ──────────────────────────────────────────────
function Shimmer({ width, height, colors: c }: { width: number | `${number}%`; height: number; colors: any }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={{ width, height, borderRadius: 4, backgroundColor: c.skeleton, opacity: anim }}
    />
  );
}

// ── Main component ───────────────────────────────────────────────────
export default function LinkPreview({ url }: { url: string }) {
  const { colors } = useTheme();
  // Seed from the module cache so an already-resolved URL renders its card immediately.
  const [og, setOg] = useState<OGData | null>(() => {
    const c = previewCache.get(url);
    return c && c !== "error" ? c : null;
  });
  const [loading, setLoading] = useState(() => previewCache.get(url) === undefined);
  const [error, setError] = useState(() => previewCache.get(url) === "error");

  useEffect(() => {
    let cancelled = false;

    // Cache hit: apply the stored result (or the error sentinel) without a network call.
    const cached = previewCache.get(url);
    if (cached !== undefined) {
      if (cached === "error") { setOg(null); setError(true); }
      else { setOg(cached); setError(false); }
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    setOg(null);

    // Fetch the preview server-side so the author's chosen host never sees the viewer's IP,
    // and the HTML is fetched once (server) instead of up to 3x per row on-device.
    const fetchLinkPreview = httpsCallable<
      { url: string },
      { ok: boolean; title?: string; description?: string; image?: string; siteName?: string; url?: string }
    >(getFunctions(), "fetchLinkPreview");

    (async () => {
      try {
        const res = await fetchLinkPreview({ url: normaliseUrl(url) });
        const data = res.data;
        if (data?.ok && data.title) {
          const result: OGData = { title: data.title, description: data.description, image: data.image };
          previewCache.set(url, result);
          if (!cancelled) setOg(result);
        } else {
          previewCache.set(url, "error");
          if (!cancelled) setError(true);
        }
      } catch {
        // Callable errored or isn't deployed yet: fail soft to a plain tappable link.
        previewCache.set(url, "error");
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  const full = normaliseUrl(url);
  const open = () => Linking.openURL(full);
  const copyLink = () => {
    tap();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Copy Link", "Open Link", "Cancel"], cancelButtonIndex: 2 },
        (i) => {
          if (i === 0) {
            Clipboard.setStringAsync(full);
            Alert.alert("Copied!", full);
          }
          if (i === 1) open();
        }
      );
    } else {
      Clipboard.setStringAsync(full);
      Alert.alert("Copied!", full);
    }
  };

  // ── Loading shimmer ──
  if (loading) {
    return (
      <View style={[s.card, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
        <Shimmer width="100%" height={14} colors={colors} />
        <Shimmer width="70%" height={12} colors={colors} />
        <Shimmer width={100} height={10} colors={colors} />
      </View>
    );
  }

  // ── Fallback to plain link ──
  if (error || !og) {
    return (
      <Pressable onPress={open} onLongPress={copyLink} style={{ marginBottom: 6 }}>
        <Text style={[s.fallback, { color: colors.linkText }]} numberOfLines={1}>
          {String(url).replace(/^https?:\/\//i, "")}
        </Text>
      </Pressable>
    );
  }

  // ── Rich preview card ──
  return (
    <Pressable onPress={open} onLongPress={copyLink} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <View style={[s.card, { backgroundColor: colors.inputBg, borderColor: colors.border }]}>
        {og.image ? (
          <Image
            source={{ uri: og.image }}
            style={s.image}
            resizeMode="cover"
          />
        ) : null}
        {og.title ? (
          <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>
            {og.title}
          </Text>
        ) : null}
        {og.description ? (
          <Text style={[s.desc, { color: colors.subtle }]} numberOfLines={2}>
            {og.description}
          </Text>
        ) : null}
        <Text style={[s.domain, { color: colors.subtle }]} numberOfLines={1}>
          {domain(url)}
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 8,
    gap: 6,
    padding: 10,
  },
  image: {
    width: "100%",
    height: 140,
    borderRadius: 6,
    marginBottom: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  desc: {
    fontSize: 12,
    lineHeight: 16,
  },
  domain: {
    fontSize: 11,
    opacity: 0.7,
  },
  fallback: {
    fontSize: 14,
    textDecorationLine: "underline",
  },
});
