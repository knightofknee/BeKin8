// app/profile/[username].tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  Linking,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../firebase.config';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  QueryDocumentSnapshot,
  onSnapshot,
} from 'firebase/firestore';
import PostComments from '../../components/PostComments';
import { useTheme } from '../../providers/ThemeProvider';

const PAGE_SIZE = 15;

function SkeletonBlock({ width, height, style, color }: { width: number | string; height: number; style?: any; color?: string }) {
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
      style={[{ width, height, borderRadius: 6, backgroundColor: color || '#E5E7EB', opacity: anim }, style]}
    />
  );
}

function ProfileSkeleton({ skeletonColor }: { skeletonColor?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 }}>
      <SkeletonBlock width={72} height={72} style={{ borderRadius: 36 }} color={skeletonColor} />
      <SkeletonBlock width={160} height={22} style={{ marginTop: 14 }} color={skeletonColor} />
      <SkeletonBlock width={100} height={14} style={{ marginTop: 8 }} color={skeletonColor} />
      <View style={{ width: '100%', marginTop: 32, gap: 16 }}>
        <SkeletonBlock width="100%" height={100} style={{ borderRadius: 8 }} color={skeletonColor} />
        <SkeletonBlock width="100%" height={100} style={{ borderRadius: 8 }} color={skeletonColor} />
      </View>
    </View>
  );
}

const PROFILE_COLORS = [
  '#2F6FED', '#6366F1', '#8B5CF6', '#EC4899', '#EF4444',
  '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#06B6D4',
  '#64748B', '#111827',
];

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

interface ListItem {
  text: string;
  link?: string;
}

interface UserList {
  id: string;
  title: string;
  items: ListItem[];
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
  const me = auth.currentUser;
  const { colors } = useTheme();

  const [resolvedUid, setResolvedUid] = useState<string | null>(null);
  const [resolvedUsername, setResolvedUsername] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [profileColor, setProfileColor] = useState<string>('#2F6FED');
  const [bio, setBio] = useState('');
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [authorCommentsEnabled, setAuthorCommentsEnabled] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  // Lists
  const [lists, setLists] = useState<UserList[]>([]);
  const [expandedListId, setExpandedListId] = useState<string | null>(null);
  const [editingList, setEditingList] = useState<UserList | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editItems, setEditItems] = useState<ListItem[]>([]);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Post menu
  const [menuFor, setMenuFor] = useState<Post | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editPostTitle, setEditPostTitle] = useState('');
  const [editPostContent, setEditPostContent] = useState('');
  const [editPostUrl, setEditPostUrl] = useState('');
  const [editPostSaving, setEditPostSaving] = useState(false);

  const isOwnProfile = !!(me && resolvedUid && me.uid === resolvedUid);

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
      setResolvedUsername(data.username || String(username));
      setDisplayName(data.displayName || data.username || String(username));
      setProfileColor(data.profileColor || '#2F6FED');
      setBio(data.bio || '');
      setAuthorCommentsEnabled(data.commentsEnabled === true);
    }).catch(() => {
      setNotFound(true);
      setLoading(false);
    });
  }, [username]);

  // Load lists
  useEffect(() => {
    if (!resolvedUid) return;
    const col = collection(db, 'Profiles', resolvedUid, 'lists');
    const unsub = onSnapshot(
      query(col, orderBy('createdAt', 'asc')),
      (snap) => {
        const arr: UserList[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          arr.push({
            id: d.id,
            title: data.title || '',
            items: Array.isArray(data.items) ? data.items : [],
          });
        });
        setLists(arr);
      },
      () => {}
    );
    return unsub;
  }, [resolvedUid]);

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

  // ── Color picker ──
  const handleColorChange = async (color: string) => {
    if (!me || !resolvedUid || me.uid !== resolvedUid) return;
    setProfileColor(color);
    try {
      await setDoc(doc(db, 'Profiles', me.uid), { profileColor: color }, { merge: true });
    } catch {}
  };

  // ── Bio ──
  const handleEditBio = () => {
    setBioDraft(bio);
    setEditingBio(true);
  };

  const handleSaveBio = async () => {
    if (!me || !resolvedUid || me.uid !== resolvedUid) return;
    const trimmed = bioDraft.trim();
    try {
      await setDoc(doc(db, 'Profiles', me.uid), { bio: trimmed }, { merge: true });
      setBio(trimmed);
      setEditingBio(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save bio.');
    }
  };

  // ── List CRUD ──
  const handleAddList = () => {
    const hasLists = lists.length > 0;
    setEditingList({ id: '', title: '', items: [] });
    setEditTitle(hasLists ? '' : 'Top Recommendations');
    setEditItems([{ text: '', link: '' }]);
  };

  const handleEditList = (list: UserList) => {
    setEditingList(list);
    setEditTitle(list.title);
    setEditItems(list.items.length > 0 ? [...list.items] : [{ text: '', link: '' }]);
  };

  const handleDeleteList = (list: UserList) => {
    if (!me || !resolvedUid) return;
    Alert.alert('Delete list?', `Remove "${list.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'Profiles', me.uid, 'lists', list.id));
          } catch {}
        },
      },
    ]);
  };

  const handleSaveList = async () => {
    if (!me || !resolvedUid || !editingList) return;
    const title = editTitle.trim();
    if (!title) {
      Alert.alert('Title required', 'Please enter a list title.');
      return;
    }
    const items = editItems
      .filter((i) => i.text.trim())
      .map((i) => ({ text: i.text.trim(), link: (i.link || '').trim() || undefined }));

    try {
      if (editingList.id) {
        // Update existing
        await setDoc(
          doc(db, 'Profiles', me.uid, 'lists', editingList.id),
          { title, items },
          { merge: true }
        );
      } else {
        // Create new
        const newId = `list_${Date.now()}`;
        await setDoc(doc(db, 'Profiles', me.uid, 'lists', newId), {
          title,
          items,
          createdAt: Date.now(),
        });
      }
      setEditingList(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save list.');
    }
  };

  const addEditItem = () => {
    setEditItems((prev) => [...prev, { text: '', link: '' }]);
  };

  const removeEditItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateEditItem = (index: number, field: 'text' | 'link', value: string) => {
    setEditItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  // ── Post actions ──
  const handleDeletePost = (p: Post) => {
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'Posts', p.id));
            setPosts((prev) => prev.filter((x) => x.id !== p.id));
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Could not delete post.');
          }
        },
      },
    ]);
  };

  const handleStartEdit = (p: Post) => {
    setEditingPost(p);
    setEditPostTitle(p.title || '');
    setEditPostContent(p.content);
    setEditPostUrl(p.url || '');
  };

  const handleSaveEdit = useCallback(async () => {
    if (!editingPost) return;
    const content = editPostContent.trim();
    if (!content) { Alert.alert('Content required'); return; }
    setEditPostSaving(true);
    try {
      const updates: any = { content, title: editPostTitle.trim() || '' };
      if (editPostUrl.trim()) updates.url = editPostUrl.trim();
      else updates.url = '';
      await updateDoc(doc(db, 'Posts', editingPost.id), updates);
      setPosts((prev) => prev.map((p) => p.id === editingPost.id
        ? { ...p, content, title: updates.title, url: updates.url || undefined } : p));
      setEditingPost(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save.');
    } finally {
      setEditPostSaving(false);
    }
  }, [editingPost, editPostTitle, editPostContent, editPostUrl]);

  const handleToggleComments = async (p: Post) => {
    const next = !(p.commentsEnabled !== false);
    try {
      await updateDoc(doc(db, 'Posts', p.id), { commentsEnabled: next });
      setPosts((prev) => prev.map((x) => x.id === p.id ? { ...x, commentsEnabled: next } : x));
    } catch {}
  };

  // ── Render helpers ──
  const initial = (displayName || resolvedUsername || '?')[0]?.toUpperCase() || '?';

  const renderListSection = () => {
    if (!isOwnProfile && lists.length === 0) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Lists</Text>
          {isOwnProfile && (
            <Pressable onPress={handleAddList} hitSlop={8}>
              <Text style={[styles.addBtn, { color: colors.primary }]}>+ Add</Text>
            </Pressable>
          )}
        </View>

        {lists.length === 0 && isOwnProfile && (
          <Text style={[styles.emptyHint, { color: colors.subtle }]}>
            Share your favorites with friends. Tap + Add to create a list.
          </Text>
        )}

        {lists.map((list) => {
          const expanded = expandedListId === list.id;
          const visibleItems = expanded ? list.items : list.items.slice(0, 3);
          const hasMore = list.items.length > 3;

          return (
            <View key={list.id} style={[styles.listCard, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
              <View style={styles.listCardHeader}>
                <Text style={[styles.listTitle, { color: colors.text }]}>{list.title}</Text>
                {isOwnProfile && (
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <Pressable onPress={() => handleEditList(list)} hitSlop={8}>
                      <Text style={[styles.listAction, { color: colors.primary }]}>Edit</Text>
                    </Pressable>
                    <Pressable onPress={() => handleDeleteList(list)} hitSlop={8}>
                      <Text style={[styles.listAction, { color: colors.error }]}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {visibleItems.map((item, i) => (
                <View key={i} style={styles.listItemRow}>
                  <Text style={[styles.listItemText, { color: colors.text }]}>{item.text}</Text>
                  {item.link ? (
                    <Pressable
                      onPress={() => Linking.openURL(
                        /^https?:\/\//i.test(item.link!) ? item.link! : `https://${item.link}`
                      )}
                      hitSlop={6}
                    >
                      <Text style={[styles.listItemLink, { color: colors.primary }]}>Link</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {hasMore && (
                <Pressable onPress={() => setExpandedListId(expanded ? null : list.id)} hitSlop={6}>
                  <Text style={[styles.expandBtn, { color: colors.primary }]}>
                    {expanded ? 'Show less' : `Show all ${list.items.length}`}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  const renderHeader = () => (
    <View>
      {/* Hero section */}
      <View style={styles.hero}>
        <Pressable onPress={isOwnProfile ? () => setShowColorPicker((v) => !v) : undefined} disabled={!isOwnProfile}>
          <View style={[styles.heroAvatar, { backgroundColor: profileColor }]}>
            <Text style={styles.heroInitial}>{initial}</Text>
          </View>
        </Pressable>
        <Text style={[styles.heroDisplayName, { color: colors.text }]}>{displayName || resolvedUsername}</Text>
        {displayName && resolvedUsername && displayName !== resolvedUsername && (
          <Text style={[styles.heroUsername, { color: colors.subtle }]}>@{resolvedUsername}</Text>
        )}

        {/* Color picker — own profile only, shown on avatar tap */}
        {isOwnProfile && showColorPicker && (
          <View style={styles.colorRow}>
            {PROFILE_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => handleColorChange(c)}
                style={[
                  styles.colorDot,
                  { backgroundColor: c },
                  c === profileColor && [styles.colorDotActive, { borderColor: colors.text }],
                ]}
              />
            ))}
          </View>
        )}
      </View>

      {/* Bio section */}
      {(bio || isOwnProfile) && (
        <View style={styles.bioSection}>
          {editingBio ? (
            <View style={styles.bioEditWrap}>
              <TextInput
                style={[styles.bioInput, { borderColor: colors.border, color: colors.text }]}
                placeholder="Write a short bio..."
                placeholderTextColor={colors.subtle}
                value={bioDraft}
                onChangeText={setBioDraft}
                multiline
                maxLength={300}
                autoFocus
              />
              <View style={styles.bioActions}>
                <Pressable onPress={() => setEditingBio(false)} style={[styles.bioCancelBtn, { backgroundColor: colors.inputBg }]}>
                  <Text style={[styles.bioCancelTxt, { color: colors.subtle }]}>Cancel</Text>
                </Pressable>
                <Pressable onPress={handleSaveBio} style={[styles.bioSaveBtn, { backgroundColor: colors.primary }]}>
                  <Text style={styles.bioSaveTxt}>Save</Text>
                </Pressable>
              </View>
            </View>
          ) : bio ? (
            <Pressable onPress={isOwnProfile ? handleEditBio : undefined} disabled={!isOwnProfile}>
              <Text style={[styles.bioText, { color: colors.text }]}>{bio}</Text>
              {isOwnProfile && <Text style={[styles.bioEditHint, { color: colors.subtle }]}>Tap to edit</Text>}
            </Pressable>
          ) : isOwnProfile ? (
            <Pressable onPress={handleEditBio}>
              <Text style={[styles.bioPlaceholder, { color: colors.subtle }]}>Add a bio...</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Lists section */}
      {renderListSection()}

      {/* Posts header */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Posts</Text>
      </View>
    </View>
  );

  return (
    <>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.headerBg }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
            <Text style={[styles.backArrow, { color: colors.primary }]}>&#8249;</Text>
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {displayName || resolvedUsername || (loading ? '' : String(username))}
          </Text>
          <View style={styles.backBtn} />
        </View>

        {loading ? (
          <ProfileSkeleton skeletonColor={colors.skeleton} />
        ) : notFound ? (
          <View style={styles.center}>
            <Text style={{ fontSize: 36, marginBottom: 8, color: colors.text }}>?</Text>
            <Text style={[styles.emptyText, { color: colors.subtle }]}>User not found</Text>
            <Text style={{ color: colors.subtle, fontSize: 13, marginTop: 4 }}>
              This profile doesn't exist or may have been removed.
            </Text>
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.list, { backgroundColor: colors.bg }]}
            ListHeaderComponent={renderHeader}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20 }}>
                <Text style={{ fontSize: 15, color: colors.subtle }}>No posts yet</Text>
              </View>
            }
            renderItem={({ item }) => {
              const commentsVisible =
                item.commentsEnabled !== false && item.authorCommentsEnabled === true;
              return (
                <View style={[styles.postContainer, { backgroundColor: colors.postBg, borderColor: colors.border }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      {item.title ? (
                        <Text style={[styles.postTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
                      ) : null}
                    </View>
                    {isOwnProfile && (
                      <Pressable onPress={() => setMenuFor(item)} hitSlop={10} style={{ padding: 4 }}>
                        <Text style={{ fontSize: 18, color: colors.subtle }}>⋯</Text>
                      </Pressable>
                    )}
                  </View>

                  {item.url ? (
                    <Pressable
                      onPress={() =>
                        Linking.openURL(
                          /^https?:\/\//i.test(item.url!) ? item.url! : `https://${item.url}`
                        )
                      }
                      style={{ marginBottom: 6 }}
                    >
                      <Text style={[styles.postLink, { color: colors.linkText }]} numberOfLines={1}>
                        {String(item.url).replace(/^https?:\/\//i, '')}
                      </Text>
                    </Pressable>
                  ) : null}

                  <Text style={[styles.postContent, { color: colors.text }]}>{item.content}</Text>

                  <View style={styles.postFooter}>
                    {commentsVisible ? (
                      <Pressable
                        onPress={() => setSelectedPost(item)}
                        hitSlop={8}
                        style={({ pressed }) => [styles.viewCommentsBtn, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={[styles.viewCommentsTxt, { color: colors.primary }]}>View comments</Text>
                      </Pressable>
                    ) : <View />}
                    <Text style={[styles.postDate, { color: colors.subtle }]}>{item.createdAt.toLocaleString()}</Text>
                  </View>
                </View>
              );
            }}
            ListFooterComponent={
              posts.length === 0 ? null :
              hasMore ? (
                <Pressable
                  onPress={loadMore}
                  disabled={loadingMore}
                  style={({ pressed }) => [
                    styles.loadMoreBtn,
                    { backgroundColor: colors.primary },
                    pressed && { opacity: 0.8 },
                    loadingMore && { opacity: 0.6 },
                  ]}
                >
                  {loadingMore
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.loadMoreTxt}>Load more</Text>}
                </Pressable>
              ) : (
                <Text style={[styles.endTxt, { color: colors.subtle }]}>All posts loaded</Text>
              )
            }
          />
        )}
      </SafeAreaView>

      {/* Comments modal */}
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
      <Modal
        visible={!!editingList}
        animationType="slide"
        transparent
        onRequestClose={() => setEditingList(null)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.backdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {editingList?.id ? 'Edit List' : 'New List'}
            </Text>

            <TextInput
              style={[styles.modalInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
              placeholder="List title"
              placeholderTextColor={colors.subtle}
              value={editTitle}
              onChangeText={setEditTitle}
              maxLength={100}
            />

            <ScrollView style={{ maxHeight: 300 }}>
              {editItems.map((item, i) => (
                <View key={i} style={[styles.editItemRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <TextInput
                      style={[styles.modalInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
                      placeholder="Item text"
                      placeholderTextColor={colors.subtle}
                      value={item.text}
                      onChangeText={(v) => updateEditItem(i, 'text', v)}
                      maxLength={200}
                    />
                    <TextInput
                      style={[styles.modalInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
                      placeholder="Link (optional)"
                      placeholderTextColor={colors.subtle}
                      value={item.link || ''}
                      onChangeText={(v) => updateEditItem(i, 'link', v)}
                      autoCapitalize="none"
                      keyboardType="url"
                      maxLength={500}
                    />
                  </View>
                  <Pressable onPress={() => removeEditItem(i)} hitSlop={8} style={styles.removeItemBtn}>
                    <Text style={{ color: colors.error, fontWeight: '700', fontSize: 18 }}>x</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <Pressable onPress={addEditItem} style={styles.addItemBtn}>
              <Text style={[styles.addItemTxt, { color: colors.primary }]}>+ Add item</Text>
            </Pressable>

            <View style={styles.modalActions}>
              <Pressable onPress={() => setEditingList(null)} style={[styles.modalCancelBtn, { borderColor: colors.border }]}>
                <Text style={[styles.modalCancelTxt, { color: colors.subtle }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveList} style={[styles.modalSaveBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.modalSaveTxt}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Post menu modal */}
      <Modal visible={!!menuFor} animationType="fade" transparent onRequestClose={() => setMenuFor(null)}>
        <Pressable style={[styles.menuBackdrop, { backgroundColor: colors.backdrop }]} onPress={() => setMenuFor(null)}>
          <Pressable style={[styles.menuSheet, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleStartEdit(p); }}>
              <Text style={[styles.menuText, { color: colors.text }]}>Edit post</Text>
            </Pressable>
            <Pressable style={styles.menuRow} onPress={() => { const p = menuFor; setMenuFor(null); if (p) handleDeletePost(p); }}>
              <Text style={[styles.menuText, { color: colors.error }]}>Delete post</Text>
            </Pressable>
            {authorCommentsEnabled && (
              <Pressable style={styles.menuRow} onPress={() => { if (menuFor) handleToggleComments(menuFor); setMenuFor(null); }}>
                <Text style={[styles.menuText, { color: colors.text }]}>{menuFor?.commentsEnabled !== false ? 'Turn off comments' : 'Turn on comments'}</Text>
              </Pressable>
            )}
            <Pressable style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.border }]} onPress={() => setMenuFor(null)}>
              <Text style={[styles.menuText, { color: colors.subtle }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit post modal */}
      <Modal visible={!!editingPost} animationType="slide" transparent onRequestClose={() => setEditingPost(null)}>
        <View style={[styles.modalBackdrop, { backgroundColor: colors.backdrop }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Post</Text>
            <TextInput
              style={[styles.modalInput, { marginBottom: 10, borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
              placeholder="Title (optional)"
              placeholderTextColor={colors.subtle}
              value={editPostTitle}
              onChangeText={setEditPostTitle}
              maxLength={200}
            />
            <TextInput
              style={[styles.modalInput, { minHeight: 80, textAlignVertical: 'top', marginBottom: 10, borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
              placeholder="What's on your mind?"
              placeholderTextColor={colors.subtle}
              value={editPostContent}
              onChangeText={setEditPostContent}
              multiline
              maxLength={2000}
            />
            <TextInput
              style={[styles.modalInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
              placeholder="Link (optional)"
              placeholderTextColor={colors.subtle}
              value={editPostUrl}
              onChangeText={setEditPostUrl}
              autoCapitalize="none"
              keyboardType="url"
              maxLength={500}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setEditingPost(null)} style={[styles.modalCancelBtn, { borderColor: colors.border }]}>
                <Text style={[styles.modalCancelTxt, { color: colors.subtle }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveEdit} disabled={editPostSaving} style={[styles.modalSaveBtn, { backgroundColor: colors.primary }, editPostSaving && { opacity: 0.6 }]}>
                <Text style={styles.modalSaveTxt}>{editPostSaving ? 'Saving...' : 'Save'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, alignItems: 'center' },
  backArrow: { fontSize: 32, fontWeight: '300', lineHeight: 36 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15 },

  // ── Hero ──
  hero: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  heroInitial: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
  },
  heroDisplayName: {
    fontSize: 24,
    fontWeight: '800',
  },
  heroUsername: {
    fontSize: 15,
    marginTop: 2,
  },

  // ── Color picker ──
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotActive: {
    borderWidth: 3,
  },

  // ── Bio ──
  bioSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  bioText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  bioEditHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  bioPlaceholder: {
    fontSize: 15,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  bioEditWrap: {
    width: '100%',
  },
  bioInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    textAlign: 'center',
    minHeight: 60,
  },
  bioActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 10,
  },
  bioCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  bioCancelTxt: { fontWeight: '700' },
  bioSaveBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 10,
  },
  bioSaveTxt: { fontWeight: '700', color: '#fff' },

  // ── Sections ──
  section: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  addBtn: {
    fontWeight: '700',
    fontSize: 14,
  },
  emptyHint: {
    fontSize: 13,
    fontStyle: 'italic',
    marginBottom: 12,
  },

  // ── List cards ──
  listCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  listCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  listAction: {
    fontWeight: '600',
    fontSize: 13,
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  listItemText: {
    fontSize: 14,
    flex: 1,
  },
  listItemLink: {
    fontWeight: '600',
    fontSize: 13,
    marginLeft: 8,
  },
  expandBtn: {
    fontWeight: '600',
    fontSize: 13,
    marginTop: 6,
  },

  // ── Posts ──
  list: { paddingBottom: 40 },

  postContainer: {
    marginBottom: 16,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  postTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  postLink: { textDecorationLine: 'underline', fontWeight: '600', marginBottom: 6 },
  postContent: { marginBottom: 8, marginTop: 4 },
  postFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  postDate: { fontSize: 12 },
  viewCommentsBtn: { paddingVertical: 2 },
  viewCommentsTxt: { fontSize: 13, fontWeight: '600' },

  loadMoreBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    marginHorizontal: 32,
    marginVertical: 16,
    alignItems: 'center',
  },
  loadMoreTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  endTxt: { textAlign: 'center', fontSize: 13, paddingVertical: 20 },

  // ── List editor modal ──
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  editItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  removeItemBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  addItemBtn: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  addItemTxt: {
    fontWeight: '700',
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelTxt: {
    fontWeight: '600',
    fontSize: 15,
  },
  modalSaveBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalSaveTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },

  // ── Post menu ──
  menuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingVertical: 4,
    paddingBottom: 30,
  },
  menuRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  menuText: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
});
