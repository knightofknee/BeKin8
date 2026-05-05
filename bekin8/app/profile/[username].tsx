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
  Platform,
  Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { tap, press, warning, selection } from '../../utils/haptics';

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
  order?: number;
  style?: 'bullets' | 'numbers';
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

  // Display name editing
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const displayNameInputRef = useRef<TextInput>(null);
  const bioInputRef = useRef<TextInput>(null);

  // Imperatively focus edit inputs after they mount — autoFocus is unreliable
  // when the TextInput is rendered inside a FlatList ListHeaderComponent.
  useEffect(() => {
    if (!editingDisplayName) return;
    const t = setTimeout(() => displayNameInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editingDisplayName]);
  useEffect(() => {
    if (!editingBio) return;
    const t = setTimeout(() => bioInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [editingBio]);

  // List menu
  const [listMenuFor, setListMenuFor] = useState<UserList | null>(null);
  const listTapRef = useRef(0);

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
      col,
      (snap) => {
        const arr: UserList[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          arr.push({
            id: d.id,
            title: data.title || '',
            items: Array.isArray(data.items) ? data.items : [],
            order: typeof data.order === 'number' ? data.order : (data.createdAt || 0),
            style: data.style === 'numbers' ? 'numbers' : 'bullets',
          });
        });
        // Fallback sort for lists without order field
        arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    selection();
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
    press();
    if (!me || !resolvedUid || me.uid !== resolvedUid) return;
    const trimmed = bioDraft.trim();
    // No-op when nothing changed — just dismiss the editor.
    if (trimmed === (bio || '').trim()) {
      setEditingBio(false);
      return;
    }
    try {
      await setDoc(doc(db, 'Profiles', me.uid), { bio: trimmed }, { merge: true });
      setBio(trimmed);
      setEditingBio(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save bio.');
    }
  };

  // ── Display Name ──
  const handleEditDisplayName = () => {
    setDisplayNameDraft(displayName === resolvedUsername ? '' : displayName);
    setEditingDisplayName(true);
  };

  const handleSaveDisplayName = async () => {
    press();
    if (!me || !resolvedUid || me.uid !== resolvedUid) return;
    const trimmed = displayNameDraft.trim();
    if (trimmed && (trimmed.length < 3 || trimmed.length > 40)) {
      Alert.alert('Invalid', 'Display name must be 3–40 characters, or empty to use your username.');
      return;
    }
    // No-op when nothing changed — just dismiss the editor (saves a Firestore write).
    const currentNormalized = displayName === resolvedUsername ? '' : displayName;
    if (trimmed === currentNormalized) {
      setEditingDisplayName(false);
      return;
    }
    try {
      await setDoc(doc(db, 'Profiles', me.uid), { displayName: trimmed || '' }, { merge: true });
      setDisplayName(trimmed || resolvedUsername);
      setEditingDisplayName(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save display name.');
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
          warning();
          try {
            await deleteDoc(doc(db, 'Profiles', me.uid, 'lists', list.id));
          } catch {}
        },
      },
    ]);
  };

  const [savingList, setSavingList] = useState(false);
  const handleSaveList = async () => {
    press();
    if (!me || !resolvedUid || !editingList || savingList) return;
    const title = editTitle.trim();
    if (!title) {
      Alert.alert('Title required', 'Please enter a list title.');
      return;
    }
    // Prevent duplicate titles (allow same title when editing the same list)
    const duplicate = lists.find(
      (l) => l.title.toLowerCase() === title.toLowerCase() && l.id !== editingList.id
    );
    if (duplicate) {
      Alert.alert('Duplicate title', 'You already have a list with that name.');
      return;
    }
    const items = editItems
      .filter((i) => i.text.trim())
      .map((i) => {
        const link = (i.link || '').trim();
        return link ? { text: i.text.trim(), link } : { text: i.text.trim() };
      });

    setSavingList(true);
    try {
      if (editingList.id) {
        await setDoc(
          doc(db, 'Profiles', me.uid, 'lists', editingList.id),
          { title, items },
          { merge: true }
        );
      } else {
        const newId = `list_${Date.now()}`;
        const maxOrder = lists.reduce((max, l) => Math.max(max, l.order ?? 0), 0);
        await setDoc(doc(db, 'Profiles', me.uid, 'lists', newId), {
          title,
          items,
          order: maxOrder + 1,
          createdAt: Date.now(),
        });
      }
      setEditingList(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save list.');
    } finally {
      setSavingList(false);
    }
  };

  const insets = useSafeAreaInsets();
  const editScrollRef = useRef<ScrollView>(null);
  const lastInputFocusedRef = useRef(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
      if (lastInputFocusedRef.current) {
        setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 50);
        setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 250);
      }
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  const addEditItem = () => {
    setEditItems((prev) => [...prev, { text: '', link: '' }]);
    setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 150);
  };

  const removeEditItem = (index: number) => {
    const item = editItems[index];
    if (item?.text?.trim()) {
      Alert.alert('Remove item?', `Delete "${item.text.trim()}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => setEditItems((prev) => prev.filter((_, i) => i !== index)) },
      ]);
    } else {
      setEditItems((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const updateEditItem = (index: number, field: 'text' | 'link', value: string) => {
    setEditItems((prev) => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const swapLists = async (indexA: number, indexB: number) => {
    if (!me || indexA < 0 || indexB < 0 || indexA >= lists.length || indexB >= lists.length) return;
    const a = lists[indexA];
    const b = lists[indexB];
    const orderA = a.order ?? indexA;
    const orderB = b.order ?? indexB;
    tap();
    try {
      await Promise.all([
        setDoc(doc(db, 'Profiles', me.uid, 'lists', a.id), { order: orderB }, { merge: true }),
        setDoc(doc(db, 'Profiles', me.uid, 'lists', b.id), { order: orderA }, { merge: true }),
      ]);
    } catch {}
  };

  // ── Post actions ──
  const handleDeletePost = (p: Post) => {
    Alert.alert('Delete post?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          warning();
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
    press();
    if (!editingPost) return;
    const content = editPostContent.trim();
    if (!content) { Alert.alert('Content required'); return; }
    const nextTitle = editPostTitle.trim();
    const nextUrl = editPostUrl.trim();
    // No-op when nothing changed — just dismiss (saves a Firestore write).
    const currTitle = (editingPost.title || '').trim();
    const currContent = (editingPost.content || '').trim();
    const currUrl = (editingPost.url || '').trim();
    if (content === currContent && nextTitle === currTitle && nextUrl === currUrl) {
      setEditingPost(null);
      return;
    }
    setEditPostSaving(true);
    try {
      const updates: any = { content, title: nextTitle };
      updates.url = nextUrl;
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
    selection();
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
              <Text style={[styles.addBtn, { color: colors.primary }]}>+ Add List</Text>
            </Pressable>
          )}
        </View>

        {lists.length === 0 && isOwnProfile && (
          <Text style={[styles.emptyHint, { color: colors.subtle }]}>
            Share your favorites with friends. Tap + Add to create a list.
          </Text>
        )}

        {lists.map((list, listIndex) => {
          const expanded = expandedListId === list.id;
          const visibleItems = expanded ? list.items : list.items.slice(0, 3);
          const hasMore = list.items.length > 3;

          return (
            <Pressable
              key={list.id}
              onPress={() => {
                if (!isOwnProfile) return;
                const now = Date.now();
                if (now - listTapRef.current < 350) {
                  tap();
                  handleEditList(list);
                  listTapRef.current = 0;
                } else {
                  listTapRef.current = now;
                }
              }}
              onLongPress={() => { if (isOwnProfile) { tap(); handleEditList(list); } }}
              style={[styles.listCard, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
            >
              <View style={styles.listCardHeader}>
                <Text style={[styles.listTitle, { color: colors.text }]}>{list.title}</Text>
                {isOwnProfile && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {lists.length > 1 && (
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); swapLists(listIndex, listIndex - 1); }}
                          hitSlop={8}
                          style={[styles.reorderBtn, { opacity: listIndex === 0 ? 0.2 : 1 }]}
                          disabled={listIndex === 0}
                        >
                          <Text style={{ fontSize: 16, color: colors.subtle }}>▲</Text>
                        </Pressable>
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); swapLists(listIndex, listIndex + 1); }}
                          hitSlop={8}
                          style={[styles.reorderBtn, { opacity: listIndex === lists.length - 1 ? 0.2 : 1 }]}
                          disabled={listIndex === lists.length - 1}
                        >
                          <Text style={{ fontSize: 16, color: colors.subtle }}>▼</Text>
                        </Pressable>
                      </View>
                    )}
                    <Pressable onPress={() => { tap(); setListMenuFor(list); }} hitSlop={10} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 18, color: colors.subtle }}>⋯</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {visibleItems.map((item, i) => (
                <View key={i} style={styles.listItemRow}>
                  <Text style={[styles.listItemText, { color: colors.text }]} numberOfLines={0}>
                    {list.style === 'numbers' ? `${i + 1}. ` : '• '}{item.text}
                    {item.link ? (
                      <>
                        <Text style={{ color: colors.text }}>{' - '}</Text>
                        <Text
                          style={[styles.listItemLink, { color: colors.primary }]}
                          onPress={() => Linking.openURL(
                            /^https?:\/\//i.test(item.link!) ? item.link! : `https://${item.link}`
                          )}
                        >
                          {item.link}
                        </Text>
                      </>
                    ) : null}
                  </Text>
                </View>
              ))}

              {hasMore && (
                <Pressable onPress={() => setExpandedListId(expanded ? null : list.id)} hitSlop={6}>
                  <Text style={[styles.expandBtn, { color: colors.primary }]}>
                    {expanded ? 'Show less' : `Show all ${list.items.length}`}
                  </Text>
                </Pressable>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderHeader = () => (
    <View>
      {/* Hero section */}
      <View style={styles.hero}>
        <Pressable onPress={isOwnProfile ? () => { selection(); setShowColorPicker((v) => !v); } : undefined} disabled={!isOwnProfile}>
          <View style={[styles.heroAvatar, { backgroundColor: profileColor }]}>
            <Text style={styles.heroInitial}>{initial}</Text>
          </View>
        </Pressable>
        {editingDisplayName ? (
          <View style={styles.displayNameEditWrap}>
            <TextInput
              ref={displayNameInputRef}
              style={[styles.displayNameInput, { borderColor: colors.border, color: colors.text }]}
              placeholder="Display name (or empty for username)"
              placeholderTextColor={colors.subtle}
              value={displayNameDraft}
              onChangeText={setDisplayNameDraft}
              maxLength={40}
            />
            <View style={styles.bioActions}>
              <Pressable onPress={() => { tap(); setEditingDisplayName(false); }} style={[styles.bioCancelBtn, { backgroundColor: colors.inputBg }]}>
                <Text style={[styles.bioCancelTxt, { color: colors.subtle }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={handleSaveDisplayName} style={[styles.bioSaveBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.bioSaveTxt}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={isOwnProfile ? handleEditDisplayName : undefined} disabled={!isOwnProfile}>
            <Text style={[styles.heroDisplayName, { color: colors.text }]}>{displayName || resolvedUsername}</Text>
            {isOwnProfile && <Text style={[styles.bioEditHint, { color: colors.subtle, textAlign: 'center' }]}>Tap to edit</Text>}
          </Pressable>
        )}
        {!editingDisplayName && displayName && resolvedUsername && displayName !== resolvedUsername && (
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
                ref={bioInputRef}
                style={[styles.bioInput, { borderColor: colors.border, color: colors.text }]}
                placeholder="Write a short bio..."
                placeholderTextColor={colors.subtle}
                value={bioDraft}
                onChangeText={setBioDraft}
                multiline
                maxLength={300}
              />
              <View style={styles.bioActions}>
                <Pressable onPress={() => { tap(); setEditingBio(false); }} style={[styles.bioCancelBtn, { backgroundColor: colors.inputBg }]}>
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
          <Pressable onPress={() => { tap(); router.back(); }} hitSlop={12} style={styles.backBtn}>
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
            keyboardShouldPersistTaps="handled"
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
        <View style={[styles.modalBackdrop, { backgroundColor: colors.backdrop, paddingTop: insets.top + 8, paddingBottom: keyboardHeight }]}>
            <View style={[styles.modalCard, { backgroundColor: colors.card, maxHeight: '100%', paddingBottom: keyboardHeight > 0 ? 0 : Math.max(insets.bottom, 16) }]}>
              <View style={styles.modalHeaderRow}>
                <Pressable
                  onPress={() => { tap(); Keyboard.dismiss(); setEditingList(null); }}
                  hitSlop={10}
                  style={styles.modalHeaderSideLeft}
                >
                  <Text style={[styles.modalCloseTxt, { color: colors.subtle }]}>✕</Text>
                </Pressable>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {editingList?.id ? 'Edit List' : 'New List'}
                </Text>
                <View style={styles.modalHeaderSide} />
              </View>

              <TextInput
                style={[styles.modalInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
                placeholder="List title"
                placeholderTextColor={colors.subtle}
                value={editTitle}
                onChangeText={setEditTitle}
                maxLength={100}
              />

              <ScrollView
                style={styles.editItemsScroll}
                keyboardShouldPersistTaps="handled"
                ref={editScrollRef}
                onContentSizeChange={() => {
                  if (lastInputFocusedRef.current) {
                    editScrollRef.current?.scrollToEnd({ animated: true });
                  }
                }}
              >
                {editItems.map((item, i) => (
                  <View key={i} style={[styles.editItemRow, { borderBottomColor: colors.border }]}>
                    {/* Reorder arrows */}
                    <View style={styles.reorderBtns}>
                      <Pressable
                        onPress={() => { if (i === 0) return; tap(); setEditItems((prev) => { const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; }); }}
                        hitSlop={10}
                        style={[styles.reorderBtn, { opacity: i === 0 ? 0.2 : 1 }]}
                      >
                        <Text style={{ fontSize: 20, color: colors.subtle }}>▲</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => { if (i === editItems.length - 1) return; tap(); setEditItems((prev) => { const next = [...prev]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next; }); }}
                        hitSlop={10}
                        style={[styles.reorderBtn, { opacity: i === editItems.length - 1 ? 0.2 : 1 }]}
                      >
                        <Text style={{ fontSize: 20, color: colors.subtle }}>▼</Text>
                      </Pressable>
                    </View>
                    <View style={{ flex: 1, gap: 6 }}>
                      <TextInput
                        style={[styles.modalInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
                        placeholder="Item text"
                        placeholderTextColor={colors.subtle}
                        value={item.text}
                        onChangeText={(v) => updateEditItem(i, 'text', v)}
                        multiline
                        onFocus={() => {
                          lastInputFocusedRef.current = i >= editItems.length - 1;
                          if (i >= editItems.length - 1) {
                            setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 100);
                            setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 350);
                          }
                        }}
                        onBlur={() => { lastInputFocusedRef.current = false; }}
                      />
                      <TextInput
                        style={[styles.modalInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.inputBg }]}
                        placeholder="Link (optional)"
                        placeholderTextColor={colors.subtle}
                        value={item.link || ''}
                        onChangeText={(v) => updateEditItem(i, 'link', v)}
                        autoCapitalize="none"
                        keyboardType="url"
                        onFocus={() => {
                          lastInputFocusedRef.current = i >= editItems.length - 1;
                          if (i >= editItems.length - 1) {
                            setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 100);
                            setTimeout(() => editScrollRef.current?.scrollToEnd({ animated: true }), 350);
                          }
                        }}
                        onBlur={() => { lastInputFocusedRef.current = false; }}
                      />
                    </View>
                    <Pressable onPress={() => removeEditItem(i)} hitSlop={8} style={styles.removeItemBtn}>
                      <Text style={{ color: colors.error, fontWeight: '700', fontSize: 18 }}>x</Text>
                    </Pressable>
                  </View>
                ))}

                <Pressable onPress={addEditItem} style={styles.addItemBtn}>
                  <Text style={[styles.addItemTxt, { color: colors.primary }]}>+ Add item</Text>
                </Pressable>
              </ScrollView>

              {keyboardHeight > 0 ? (
                <View style={[styles.kbAccessoryBar, { backgroundColor: colors.inputBg, borderTopColor: colors.border }]}>
                  <Pressable
                    onPress={() => { tap(); Keyboard.dismiss(); }}
                    hitSlop={10}
                    style={styles.kbDoneBtn}
                  >
                    <Text style={[styles.kbDoneTxt, { color: colors.primary }]}>Done</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.modalActions}>
                  <Pressable onPress={() => { tap(); setEditingList(null); }} style={[styles.modalCancelBtn, { borderColor: colors.border }]}>
                    <Text style={[styles.modalCancelTxt, { color: colors.subtle }]}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={handleSaveList} disabled={savingList} style={[styles.modalSaveBtn, { backgroundColor: colors.primary }, savingList && { opacity: 0.5 }]}>
                    {savingList ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveTxt}>Save</Text>}
                  </Pressable>
                </View>
              )}
            </View>
          </View>
      </Modal>

      {/* Post menu modal */}
      <Modal visible={!!menuFor} animationType="fade" transparent onRequestClose={() => setMenuFor(null)}>
        <Pressable style={[styles.menuBackdrop, { backgroundColor: colors.backdrop }]} onPress={() => { tap(); setMenuFor(null); }}>
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
            <Pressable style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.border }]} onPress={() => { tap(); setMenuFor(null); }}>
              <Text style={[styles.menuText, { color: colors.subtle }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* List menu modal */}
      <Modal visible={!!listMenuFor} animationType="fade" transparent onRequestClose={() => setListMenuFor(null)}>
        <Pressable style={[styles.menuBackdrop, { backgroundColor: colors.backdrop }]} onPress={() => { tap(); setListMenuFor(null); }}>
          <Pressable style={[styles.menuSheet, { backgroundColor: colors.card }]} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.menuRow} onPress={() => { const l = listMenuFor; setListMenuFor(null); if (l) handleEditList(l); }}>
              <Text style={[styles.menuText, { color: colors.text }]}>Edit list</Text>
            </Pressable>
            <Pressable style={styles.menuRow} onPress={async () => {
              const l = listMenuFor;
              if (!l || !me) return;
              const newStyle = l.style === 'numbers' ? 'bullets' : 'numbers';
              tap();
              setListMenuFor(null);
              try {
                await setDoc(doc(db, 'Profiles', me.uid, 'lists', l.id), { style: newStyle }, { merge: true });
              } catch {}
            }}>
              <Text style={[styles.menuText, { color: colors.text }]}>
                Switch to {listMenuFor?.style === 'numbers' ? 'bullets' : 'numbers'}
              </Text>
            </Pressable>
            <Pressable style={styles.menuRow} onPress={() => { const l = listMenuFor; setListMenuFor(null); if (l) handleDeleteList(l); }}>
              <Text style={[styles.menuText, { color: colors.error }]}>Delete list</Text>
            </Pressable>
            <Pressable style={[styles.menuRow, { borderTopWidth: 1, borderTopColor: colors.border }]} onPress={() => { tap(); setListMenuFor(null); }}>
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
              <Pressable onPress={() => { tap(); setEditingPost(null); }} style={[styles.modalCancelBtn, { borderColor: colors.border }]}>
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

  // ── Display name editor ──
  displayNameEditWrap: {
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 4,
  },
  displayNameInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    textAlign: 'center',
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
    paddingVertical: 4,
  },
  listItemText: {
    fontSize: 14,
    flexWrap: 'wrap',
  },
  listItemLink: {
    fontSize: 13,
    textDecorationLine: 'underline',
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
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  modalCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 0,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalHeaderSide: {
    minWidth: 32,
    alignItems: 'flex-end',
    paddingVertical: 4,
  },
  modalHeaderSideLeft: {
    minWidth: 32,
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  modalCloseTxt: {
    fontSize: 22,
    fontWeight: '600',
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
  reorderBtns: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 8,
  },
  reorderBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
  editItemsScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  kbAccessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: -20,
  },
  kbDoneBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  kbDoneTxt: {
    fontSize: 16,
    fontWeight: '700',
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
