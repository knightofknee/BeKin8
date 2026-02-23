// app/profile/[username].tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  Linking,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../../firebase.config';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import PostComments from '../../components/PostComments';

const PAGE_SIZE = 15;

interface Post {
  id: string;
  authorUid: string;
  authorUsername: string;
  title?: string;
  content: string;
  url?: string;
  createdAt: Date;
  commentsEnabled?: boolean;
  authorCommentsEnabled: boolean;
  _timestamp: number;
}

function toDate(rawTs: any): Date {
  if (!rawTs) return new Date();
  if (typeof rawTs?.toDate === 'function') return rawTs.toDate();
  if (rawTs instanceof Date) return rawTs;
  if (typeof rawTs === 'number') return new Date(rawTs);
  return new Date();
}

function toTimestamp(rawTs: any): number {
  if (typeof rawTs === 'number') return rawTs;
  if (typeof rawTs?.toDate === 'function') return rawTs.toDate().getTime();
  if (rawTs instanceof Date) return rawTs.getTime();
  return 0;
}

export default function ProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();

  const [resolvedUid, setResolvedUid] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>('');
  const [authorCommentsEnabled, setAuthorCommentsEnabled] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  // Resolve username → uid + profile
  useEffect(() => {
    if (!username) return;
    const lower = String(username).toLowerCase();
    getDocs(
      query(
        collection(db, 'Profiles'),
        where('usernameLower', '==', lower),
        limit(1)
      )
    ).then((snap) => {
      if (snap.empty) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const d = snap.docs[0];
      const data = d.data() as any;
      setResolvedUid(d.id);
      setDisplayName(data.displayName || data.username || String(username));
      setAuthorCommentsEnabled(data.commentsEnabled === true);
    }).catch(() => {
      setNotFound(true);
      setLoading(false);
    });
  }, [username]);

  const loadPage = useCallback(async (
    uid: string,
    commentsOn: boolean,
    after: QueryDocumentSnapshot | null
  ): Promise<Post[]> => {
    const base = query(
      collection(db, 'Posts'),
      where('author', '==', uid),
      orderBy('timestamp', 'desc'),
      limit(PAGE_SIZE),
    );
    const q = after ? query(base, startAfter(after)) : base;
    const snap = await getDocs(q);

    setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
    setHasMore(snap.docs.length >= PAGE_SIZE);

    return snap.docs.map((d) => {
      const data = d.data() as any;
      const rawTs = data.timestamp ?? data.createdAt;
      return {
        id: d.id,
        authorUid: uid,
        authorUsername: displayName,
        title: data.title ?? '',
        content: data.content ?? '',
        url: data.url ?? data.link ?? data.href ?? undefined,
        createdAt: toDate(rawTs),
        commentsEnabled: data.commentsEnabled !== false,
        authorCommentsEnabled: commentsOn,
        _timestamp: toTimestamp(rawTs),
      };
    });
  }, [displayName]);

  // Load first page once uid is resolved
  useEffect(() => {
    if (!resolvedUid) return;
    setLoading(true);
    loadPage(resolvedUid, authorCommentsEnabled, null)
      .then((fetched) => setPosts(fetched))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [resolvedUid]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !lastDoc || !resolvedUid) return;
    setLoadingMore(true);
    try {
      const fetched = await loadPage(resolvedUid, authorCommentsEnabled, lastDoc);
      setPosts((prev) => [...prev, ...fetched]);
    } catch {} finally {
      setLoadingMore(false);
    }
  };

  const headerName = displayName || (loading ? '' : String(username));

  return (
    <>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {headerName}
          </Text>
          <View style={styles.backBtn} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#2F6FED" />
          </View>
        ) : notFound ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>User not found.</Text>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No posts yet.</Text>
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const commentsVisible =
                item.commentsEnabled !== false && item.authorCommentsEnabled === true;
              return (
                <View style={styles.postContainer}>
                  {item.title ? (
                    <Text style={styles.postTitle} numberOfLines={2}>{item.title}</Text>
                  ) : null}

                  {item.url ? (
                    <Pressable
                      onPress={() =>
                        Linking.openURL(
                          /^https?:\/\//i.test(item.url!) ? item.url! : `https://${item.url}`
                        )
                      }
                      style={{ marginBottom: 6 }}
                    >
                      <Text style={styles.postLink} numberOfLines={1}>
                        {String(item.url).replace(/^https?:\/\//i, '')}
                      </Text>
                    </Pressable>
                  ) : null}

                  <Text style={styles.postContent}>{item.content}</Text>

                  <View style={styles.postFooter}>
                    {commentsVisible ? (
                      <Pressable
                        onPress={() => setSelectedPost(item)}
                        hitSlop={8}
                        style={({ pressed }) => [styles.viewCommentsBtn, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.viewCommentsTxt}>💬 View comments</Text>
                      </Pressable>
                    ) : <View />}
                    <Text style={styles.postDate}>{item.createdAt.toLocaleString()}</Text>
                  </View>
                </View>
              );
            }}
            ListFooterComponent={
              hasMore ? (
                <Pressable
                  onPress={loadMore}
                  disabled={loadingMore}
                  style={({ pressed }) => [
                    styles.loadMoreBtn,
                    pressed && { opacity: 0.8 },
                    loadingMore && { opacity: 0.6 },
                  ]}
                >
                  {loadingMore
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.loadMoreTxt}>Load more</Text>}
                </Pressable>
              ) : (
                <Text style={styles.endTxt}>All posts loaded</Text>
              )
            }
          />
        )}
      </SafeAreaView>

      {/* Comments modal — identical to feed */}
      <Modal
        visible={!!selectedPost}
        animationType="fade"
        transparent
        onRequestClose={() => setSelectedPost(null)}
      >
        {selectedPost && (
          <PostComments post={selectedPost} onClose={() => setSelectedPost(null)} />
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  backBtn: { width: 36, alignItems: 'center' },
  backArrow: { fontSize: 32, color: '#2F6FED', fontWeight: '300', lineHeight: 36 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#9CA3AF', fontSize: 15 },

  list: { padding: 16, backgroundColor: '#fff', paddingBottom: 40 },

  postContainer: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#eee',
  },
  postTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  postLink: { color: '#2F6FED', textDecorationLine: 'underline', fontWeight: '600', marginBottom: 6 },
  postContent: { marginBottom: 8, color: '#111827', marginTop: 4 },
  postFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  postDate: { fontSize: 12, color: '#555' },
  viewCommentsBtn: { paddingVertical: 2 },
  viewCommentsTxt: { fontSize: 13, color: '#2F6FED', fontWeight: '600' },

  loadMoreBtn: {
    backgroundColor: '#2F6FED',
    borderRadius: 12,
    paddingVertical: 12,
    marginHorizontal: 32,
    marginVertical: 16,
    alignItems: 'center',
  },
  loadMoreTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  endTxt: { textAlign: 'center', color: '#9CA3AF', fontSize: 13, paddingVertical: 20 },
});
