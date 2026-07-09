// components/GifPicker.tsx
// A simple bottom-sheet GIF search backed by the Giphy REST API (no SDK, so it stays
// OTA-updatable and needs no dev-client rebuild). expo-image renders the animated WebP.
// The Giphy key comes from EXPO_PUBLIC_GIPHY_API_KEY (see .env). rating=g is hard-coded.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../providers/ThemeProvider';

export type PickedGif = {
  id: string;
  url: string; // animated webp shown in the thread
  previewUrl?: string; // smaller webp for the picker grid
  w: number;
  h: number;
};

const GIPHY_KEY = process.env.EXPO_PUBLIC_GIPHY_API_KEY || '';
const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';

type GiphyRendition = { webp?: string; url?: string; width?: string; height?: string };
type GiphyItem = {
  id: string;
  images?: {
    fixed_width?: GiphyRendition;
    fixed_width_small?: GiphyRendition;
  };
};

function toPicked(g: GiphyItem): PickedGif | null {
  const fw = g.images?.fixed_width;
  const url = fw?.webp || fw?.url;
  if (!url) return null;
  const fws = g.images?.fixed_width_small;
  return {
    id: g.id,
    url,
    previewUrl: fws?.webp || fws?.url || url,
    w: Number(fw?.width) || 200,
    h: Number(fw?.height) || 200,
  };
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (gif: PickedGif) => void;
};

export default function GifPicker({ visible, onClose, onPick }: Props) {
  const { colors: tc } = useTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PickedGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numColumns = 2;
  const gap = 8;
  const colW = Math.floor((width - 16 * 2 - gap) / numColumns);

  const fetchGifs = useCallback(async (q: string) => {
    if (!GIPHY_KEY) {
      setError('GIF search is not set up yet.');
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const base = q.trim()
        ? `${GIPHY_BASE}/search?q=${encodeURIComponent(q.trim())}&`
        : `${GIPHY_BASE}/trending?`;
      const url = `${base}api_key=${GIPHY_KEY}&limit=24&rating=g&bundle=messaging_non_clips`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const arr = ((json?.data as GiphyItem[]) || [])
        .map(toPicked)
        .filter((g): g is PickedGif => !!g);
      setItems(arr);
    } catch {
      setError("Couldn't load GIFs. Check your connection.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load trending on open, debounce typed queries. Reset when closed.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setItems([]);
      setError(null);
      return;
    }
    const h = setTimeout(() => fetchGifs(query), query ? 350 : 0);
    return () => clearTimeout(h);
  }, [visible, query, fetchGifs]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: tc.card }]}>
          <View style={styles.headerRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search GIPHY"
              placeholderTextColor={tc.subtle}
              style={[styles.search, { backgroundColor: tc.inputBg, color: tc.text, borderColor: tc.border }]}
              autoFocus
              returnKeyType="search"
            />
            <Pressable onPress={onClose} hitSlop={8} style={styles.doneBtn} accessibilityRole="button">
              <Text style={[styles.doneText, { color: tc.primary }]}>Done</Text>
            </Pressable>
          </View>

          {error ? (
            <View style={styles.center}>
              <Text style={{ color: tc.subtle, textAlign: 'center' }}>{error}</Text>
            </View>
          ) : loading && items.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator color={tc.primary} />
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(g) => g.id}
              numColumns={numColumns}
              columnWrapperStyle={{ gap, paddingHorizontal: 16 }}
              contentContainerStyle={{ gap, paddingVertical: 12 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPick(item)}
                  style={{ borderRadius: 10, overflow: 'hidden' }}
                  accessibilityRole="button"
                  accessibilityLabel="Send this GIF"
                >
                  <Image
                    source={{ uri: item.previewUrl || item.url }}
                    style={{ width: colW, height: colW, backgroundColor: tc.inputBg }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </Pressable>
              )}
              ListEmptyComponent={
                !loading ? (
                  <View style={styles.center}>
                    <Text style={{ color: tc.subtle }}>No GIFs found.</Text>
                  </View>
                ) : null
              }
            />
          )}

          <Text style={[styles.attribution, { color: tc.subtle }]}>Powered by GIPHY</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { height: '72%', borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  search: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  doneBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  doneText: { fontSize: 15, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  attribution: { textAlign: 'center', fontSize: 11, fontWeight: '600', paddingVertical: 8, letterSpacing: 0.4 },
});
