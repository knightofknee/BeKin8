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
import { useTheme } from "../providers/ThemeProvider";
import { tap } from "../utils/haptics";

interface OGData {
  title?: string;
  description?: string;
  image?: string;
}

function extractMeta(html: string): OGData {
  const get = (property: string): string | undefined => {
    // match <meta property="og:X" content="…"> or <meta content="…" property="og:X">
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']` +
        `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1] || m[2] : undefined;
  };

  return {
    title: get("og:title") || get("twitter:title"),
    description: get("og:description") || get("twitter:description"),
    image: get("og:image") || get("twitter:image"),
  };
}

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
  const [og, setOg] = useState<OGData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const tryFetch = async (target: string): Promise<OGData | null> => {
      const res = await fetch(target, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
      });
      const html = await res.text();
      const data = extractMeta(html);
      if (data.title) return data;

      // Some shortlinks use JS/meta-refresh redirects — try to follow them
      const refresh = html.match(
        /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["']\d+;\s*url=([^"']+)["']/i
      );
      if (refresh?.[1]) {
        const r2 = await fetch(refresh[1], {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
        });
        const h2 = await r2.text();
        const d2 = extractMeta(h2);
        if (d2.title) return d2;
      }

      // If redirect was followed, res.url may differ — re-fetch the final destination
      if (res.url && res.url !== target) {
        const r3 = await fetch(res.url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" },
        });
        const h3 = await r3.text();
        const d3 = extractMeta(h3);
        if (d3.title) return d3;
      }

      return null;
    };

    (async () => {
      try {
        const data = await tryFetch(normaliseUrl(url));
        if (!cancelled) {
          if (data) {
            setOg(data);
          } else {
            setError(true);
          }
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
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
