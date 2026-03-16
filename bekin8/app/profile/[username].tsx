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
  ScrollView,
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
  updateDoc,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import PostComments from '../../components/PostComments';
import ProfileListEditor, { type ProfileList } from '../../components/ProfileListEditor';
import { useAuth } from '../../providers/AuthProvider';

const DEFAULT_AVATAR_COLOR = '#2F6FED';
const AVATAR_COLORS = [
  '#2F6FED', '#6366F1', '#8B5CF6', '#A855F7',
  '#EC4899', '#EF4444', '#F97316', '#F59E0B',
  '#EAB308', '#22C55E', '#14B8A6', '#06B6D4',
  '#0EA5E9', '#3B82F6', '#6B7280', '#1F2937',
];

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
  const { user, profile: myProfile, updateProfile } = useAuth();

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
  const [avatarColor, setAvatarColor] = useState<string>(DEFAULT_AVATAR_COLOR);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [lists, setLists] = useState<ProfileList[]>([]);
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());
  const [editingList, setEditingList] = useState<ProfileList | null | undefined>(undefined); // undefined=closed, null=new, ProfileList=edit
  const [listEditorVisible, setListEditorVisible] = useState(false);

  const isOwnProfile = !!(resolvedUid && user?.uid && resolvedUid === user.uid);

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
      if (data.avatarColor) setAvatarColor(data.avatarColor);
    }).catch(() => {
      setNotFound(true);
      setLoading(false);
    });
  }, [username]);

  const handlePickColor = async (color: string) => {
    setAvatarColor(color);
    setShowColorPicker(false);
    if (!user?.uid) return;
    try {
      await updateDoc(doc(db, 'Profiles', user.uid), { avatarColor: color });
      updateProfile({ avatarColor: color });
    } catch {}
  };

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

  // Load lists
  const loadLists = useCallback(async (uid: string) => {
    try {
      const snap = await getDocs(
        query(collection(db, 'Profiles', uid, 'lists'), orderBy('order', 'asc'))
      );
      const arr: ProfileList[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setLists(arr);
    } catch {}
  }, []);

  useEffect(() => {
    if (!resolvedUid) return;
    loadLists(resolvedUid);
  }, [resolvedUid, loadLists]);

  const openListEditor = (list: ProfileList | null) => {
    setEditingList(list);
    setListEditorVisible(true);
  };

  const toggleExpandList = (listId: string) => {
    setExpandedLists((prev) => {
      const next = new Set(prev);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  };

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
  const initial = (String(username)?.[0] ?? '?').toUpperCase();

  const heroComponent = (
    <View style={styles.hero}>
      <Pressable
        onPress={isOwnProfile ? () => setShowColorPicker((v) => !v) : undefined}
        disabled={!isOwnProfile}
      >
        <View style={[styles.avatarLarge, { backgroundColor: avatarColor }]}>
          <Text style={styles.avatarLetter}>{initial}</Text>
        </View>
      </Pressable>
      {isOwnProfile && !showColorPicker && (
        <Text style={styles.tapHint}>Tap to change color</Text>
      )}
      {showColorPicker && (
        <View style={styles.colorGrid}>
          {AVATAR_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => handlePickColor(c)}
              style={[
                styles.colorDot,
                { backgroundColor: c },
                c === avatarColor && styles.colorDotActive,
              ]}
            />
          ))}
        </View>
      )}
      <Text style={styles.heroName}>{displayName || String(username)}</Text>
      {displayName && displayName !== String(username) ? (
        <Text style={styles.heroUsername}>{String(username)}</Text>
      ) : null}

      {/* Lists section */}
      {lists.length > 0 && (
        <View style={styles.listsSection}>
          <Text style={styles.sectionLabel}>Lists</Text>
          {lists.map((l) => {
            const expanded = l.id ? expandedLists.has(l.id) : false;
            const visibleItems = expanded ? l.items : l.items.slice(0, 3);
            const hasMore = l.items.length > 3;
            return (
              <View key={l.id} style={styles.listCard}>
                <View style={styles.listCardHeader}>
                  <Text style={styles.listTitle}>{l.title}</Text>
                  {isOwnProfile && (
                    <Pressable onPress={() => openListEditor(l)} hitSlop={8}>
                      <Text style={styles.editBtn}>Edit</Text>
                    </Pressable>
                  )}
                </View>
                {visibleItems.map((item, idx) => (
                  <View key={idx} style={styles.listItem}>
                    <Text style={styles.listItemBullet}>•</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listItemText}>{item.text}</Text>
                      {item.link ? (
                        <Pressable
                          onPress={() =>
                            Linking.openURL(
                              /^https?:\/\//i.test(item.link!) ? item.link! : `https://${item.link}`
                            )
                          }
                        >
                          <Text style={styles.listItemLink} numberOfLines={1}>
                            {String(item.link).replace(/^https?:\/\//i, '')}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ))}
                {hasMore && l.id && (
                  <Pressable onPress={() => toggleExpandList(l.id!)} style={styles.showAllBtn}>
                    <Text style={styles.showAllTxt}>
                      {expanded ? 'Show less' : `Show all (${l.items.length})`}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          {isOwnProfile && (
            <Pressable onPress={() => openListEditor(null)} style={styles.newListBtn}>
              <Text style={styles.newListTxt}>+ New List</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Own profile with no lists: prompt */}
      {isOwnProfile && lists.length === 0 && (
        <View style={styles.listsPrompt}>
          <Text style={styles.listsPromptText}>Share your recommendations</Text>
          <Pressable onPress={() => openListEditor(null)} style={styles.newListBtn}>
            <Text style={styles.newListTxt}>+ Add List</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.sectionLabel}>Posts</Text>
    </View>
  );

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
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={heroComponent}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No posts yet.</Text>
            }
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
              ) : posts.length > 0 ? (
                <Text style={styles.endTxt}>All posts loaded</Text>
              ) : null
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

      {/* List editor modal */}
      {resolvedUid && (
        <ProfileListEditor
          visible={listEditorVisible}
          list={editingList ?? null}
          ownerUid={resolvedUid}
          isFirstList={lists.length === 0}
          onClose={() => setListEditorVisible(false)}
          onSaved={() => resolvedUid && loadLists(resolvedUid)}
          onDeleted={() => resolvedUid && loadLists(resolvedUid)}
        />
      )}
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
  emptyText: { color: '#9CA3AF', fontSize: 15, textAlign: 'center', paddingVertical: 24 },

  hero: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 8,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarLetter: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
  },
  tapHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 8,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  colorDotActive: {
    borderWidth: 3,
    borderColor: '#111827',
  },
  heroName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  heroUsername: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    alignSelf: 'flex-start',
    marginTop: 24,
    marginBottom: 4,
  },

  listsSection: {
    alignSelf: 'stretch',
    marginTop: 8,
  },
  listCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    backgroundColor: '#FAFAFA',
  },
  listCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  listTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  editBtn: { fontSize: 13, color: '#2F6FED', fontWeight: '600' },
  listItem: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  listItemBullet: { color: '#6B7280', fontSize: 14, lineHeight: 20 },
  listItemText: { color: '#111827', fontSize: 14, lineHeight: 20 },
  listItemLink: { color: '#2F6FED', fontSize: 12, textDecorationLine: 'underline' },
  showAllBtn: { marginTop: 6, paddingVertical: 4 },
  showAllTxt: { color: '#2F6FED', fontSize: 13, fontWeight: '600' },
  newListBtn: {
    marginTop: 10,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    borderStyle: 'dashed',
  },
  newListTxt: { color: '#2F6FED', fontWeight: '700', fontSize: 14 },
  listsPrompt: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  listsPromptText: { color: '#9CA3AF', fontSize: 14 },

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
