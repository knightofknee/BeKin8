// components/ChatRoom.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleProp,
  ViewStyle,
  Keyboard,
  InputAccessoryView,
} from 'react-native';
import { auth, db } from '../firebase.config';
import { SCREEN_PAD } from './ui/layout';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useTheme } from '../providers/ThemeProvider';
import { useOnline } from '../providers/NetworkProvider';
import { formatTimeHHmmDisplay } from '../lib/beaconTime';
import { tap, press, warning, selection } from '../utils/haptics';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import GifPicker, { PickedGif } from './GifPicker';
import * as Clipboard from 'expo-clipboard';

type MediaAttachment = {
  provider: 'giphy';
  id: string;
  url: string;        // animated webp shown in the thread
  previewUrl?: string;
  w: number;
  h: number;
};

type ChatMessage = {
  id: string;
  text: string;
  createdAt: Date;
  authorUid?: string;
  authorName?: string;
  type?: 'user' | 'system';
  subtype?: 'im-in' | string;
  actorUid?: string;
  actorName?: string;
  kind?: 'text' | 'gif';
  media?: MediaAttachment;
  reactions?: Record<string, string[]>;
};

type ChatRoomProps = {
  beaconId: string;
  maxHeight?: number;
  onClose?: () => void;
  style?: StyleProp<ViewStyle>;
  targetMessageId?: string;
};

function getMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}

function formatMsgTime(d: Date): string {
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + time;
}

// Fit a GIF into the thread: clamp width, preserve aspect ratio, cap height.
function gifDims(m: { w: number; h: number }): { w: number; h: number } {
  const MAX_W = 220, MAX_H = 260, MIN_W = 120;
  const srcW = m.w > 0 ? m.w : 200;
  const srcH = m.h > 0 ? m.h : 200;
  const ratio = srcH / srcW;
  let w = Math.min(MAX_W, Math.max(MIN_W, srcW));
  let h = w * ratio;
  if (h > MAX_H) { h = MAX_H; w = h / ratio; }
  return { w: Math.round(w), h: Math.round(h) };
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayLabel(d: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(d, now)) return 'Today';
  if (isSameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

async function resolveMyName(uid: string): Promise<string> {
  // Prefer Profiles.displayName (editable), then username, then auth/displayName, then email prefix.
  try {
    const profSnap = await getDoc(doc(db, 'Profiles', uid));
    const prof = profSnap.exists() ? (profSnap.data() as any) : {};
    const display = typeof prof.displayName === 'string' ? prof.displayName.trim() : '';
    if (display.length > 0) return display;

    // Username fallback from the world-readable Profiles doc (read above). No users/{uid} read:
    // that owner-only doc isn't readable for other people once the friend graph is locked.
    const unameProfiles = typeof prof.username === 'string' ? prof.username.trim() : '';
    if (unameProfiles) return unameProfiles;

    const authName = (auth.currentUser?.displayName || '').toString().trim();
    if (authName) return authName;

    const emailPrefix = (auth.currentUser?.email || '').split('@')[0] || '';
    if (emailPrefix) return emailPrefix;
  } catch {
    // ignore and continue to final fallback
  }
  return 'Me';
}

const CHAT_ACCESSORY_ID = 'chatroom-accessory';
const CHAT_MESSAGE_MAX = 500;
const REACTION_EMOJIS = ['🔥', '❤️', '😂', '👍', '🎉', '😮'];

// The composer owns its own text state so typing NEVER re-renders the whole chat panel (the
// per-keystroke re-render of a 300-message list was a visible input delay on device). It also
// persists the draft per beacon+user, so backgrounding the app (or Android killing the activity)
// never loses what was typed: the draft is restored on the next open and cleared on send.
type ChatComposerProps = {
  draftKey: string;
  sending: boolean;
  onSend: (body: string) => void;
  onOpenGif: () => void;
  onFocusScroll: () => void;
  composerFocusedRef: React.MutableRefObject<boolean>;
};

const ChatComposer = React.memo(function ChatComposer({
  draftKey, sending, onSend, onOpenGif, onFocusScroll, composerFocusedRef,
}: ChatComposerProps) {
  const { colors: tc } = useTheme();
  const [text, setText] = useState('');
  // Measured content height of the input. iOS keeps a multiline TextInput at its grown height
  // after a PROGRAMMATIC clear (sending), so height is driven from this and reset on send.
  const [composerContentH, setComposerContentH] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore any saved draft once per room.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(draftKey)
      .then((v) => { if (alive && v) setText(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, [draftKey]);

  const persistDraft = (t: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      (t.trim() ? AsyncStorage.setItem(draftKey, t) : AsyncStorage.removeItem(draftKey)).catch(() => {});
    }, 350);
  };
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const canSend = text.trim().length > 0 && !sending;
  const send = () => {
    if (!canSend) return;
    const body = text.trim();
    setText('');
    setComposerContentH(0);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    AsyncStorage.removeItem(draftKey).catch(() => {});
    onSend(body);
  };

  const remaining = CHAT_MESSAGE_MAX - text.length;
  // contentSize already INCLUDES the input's vertical padding (one line reports ~36).
  const composerH = Math.max(36, Math.min(120, Math.ceil(composerContentH)));

  return (
    <View style={[styles.inputRow, { borderTopColor: tc.border, backgroundColor: tc.headerBg }]}>
      <View style={[styles.composerPill, { borderColor: tc.border, backgroundColor: tc.inputBg }]}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            // Buzz once when the cap is first hit (maxLength already blocks further input).
            if (t.length >= CHAT_MESSAGE_MAX && text.length < CHAT_MESSAGE_MAX) warning();
            setText(t);
            persistDraft(t);
          }}
          placeholder="Message"
          placeholderTextColor={tc.subtle}
          editable
          style={[styles.composerInput, { color: tc.text, height: composerH }]}
          onContentSizeChange={(e) => setComposerContentH(e.nativeEvent.contentSize.height)}
          multiline
          maxLength={CHAT_MESSAGE_MAX}
          onFocus={() => {
            composerFocusedRef.current = true;
            onFocusScroll();
          }}
          onBlur={() => { composerFocusedRef.current = false; }}
          inputAccessoryViewID={Platform.OS === 'ios' ? CHAT_ACCESSORY_ID : undefined}
          blurOnSubmit={false}
          returnKeyType="send"
          onSubmitEditing={send}
        />
        {remaining <= 40 && (
          <Text
            style={[
              styles.charCount,
              { color: remaining <= 0 ? tc.danger : remaining <= 20 ? '#D97706' : tc.subtle },
            ]}
          >
            {remaining}
          </Text>
        )}
        <Pressable
          onPress={onOpenGif}
          hitSlop={8}
          style={({ pressed }) => [styles.gifBtn, { borderColor: tc.border }, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Add a GIF"
        >
          <Text style={[styles.gifBtnText, { color: tc.subtle }]}>GIF</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={send}
        disabled={!canSend}
        style={[styles.sendCircle, { backgroundColor: tc.primary, opacity: canSend ? 1 : 0.4 }]}
        accessibilityRole="button"
        accessibilityLabel="Send message"
      >
        {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
      </Pressable>
    </View>
  );
});

export default function ChatRoom({ beaconId, maxHeight, onClose, style, targetMessageId }: ChatRoomProps) {
  const { colors: tc } = useTheme();
  const online = useOnline();
  const me = auth.currentUser;

  const [loading, setLoading] = useState(true);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifViewer, setGifViewer] = useState<string | null>(null);

  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);

  const [startLabel, setStartLabel] = useState<string>('');
  const [timeLabel, setTimeLabel] = useState<string>('');
  const [ownerName, setOwnerName] = useState<string>('');
  const [ownerUid, setOwnerUid] = useState<string>('');
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const [beaconMessage, setBeaconMessage] = useState<string>('');
  const [msgExpanded, setMsgExpanded] = useState(false);
  const [msgTruncated, setMsgTruncated] = useState(false);
  const expiresAtRef = useRef<number | null>(null);
  // Parent beacon's audience, mirrored onto every message we write. The ChatMessages create rule
  // requires an exact match against the beacon's own array, so this is a copy, never a choice:
  // it is what scopes chat reads without a get() per message at read time.
  const beaconAudienceRef = useRef<string[]>([]);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const composerFocusedRef = useRef(false);
  const pendingScrollRef = useRef(false);
  const didInitialScrollRef = useRef(false);
  const lastScrolledTargetRef = useRef<string | undefined>(undefined);

  // Scroll-to-top arrow (only when list is scrollable and user has scrolled down)
  const [listViewportH, setListViewportH] = useState(0);
  const [listContentH, setListContentH] = useState(0);
  const [showJump, setShowJump] = useState(false);

  const isListScrollable = listContentH > listViewportH + 24;
  const hasRealMessages = useMemo(() => messages.some((m) => m.type !== 'system'), [messages]);

  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Store only the derived boolean, not the raw offset, so the message list
    // doesn't re-render on every scroll frame. Bail when it hasn't changed.
    const next = e.nativeEvent.contentOffset.y > 24;
    setShowJump((prev) => (prev === next ? prev : next));
  };

  const scrollToTop = () => {
    tap();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  // Reset per-room scroll state so it doesn't carry over between different beacons
  useEffect(() => {
    setShowJump(false);
    setListViewportH(0);
    setListContentH(0);
    pendingScrollRef.current = false;
    didInitialScrollRef.current = false;
    lastScrolledTargetRef.current = undefined;
  }, [beaconId]);

  // Tapping the composer scrolls to the newest message, but onFocus fires BEFORE the
  // keyboard opens and the parent KeyboardAvoidingView shrinks the list, so that first
  // scroll lands short. Snap to the end again once the keyboard is fully up so the latest
  // message and its timestamp sit right above the composer. Focus-guarded so a keyboard
  // opened by an overlay (e.g. GIF search) doesn't yank the thread. The user can still
  // scroll back up freely afterwards; this only fires on keyboard open.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (!composerFocusedRef.current) return;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    });
    return () => sub.remove();
  }, []);

  // Keyboard handling is owned by the parent modal via KeyboardAvoidingView
  // (see app/home.tsx beacon-details modal). Translating the panel here would
  // push the header off the top of the modal, instead, the parent shrinks the
  // panel's available space so the header stays pinned, the list shrinks, and
  // the composer sits just above the keyboard.

  // ---- Data subscriptions ----
  useEffect(() => {
    const ref = doc(db, 'Beacons', beaconId);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          expiresAtRef.current = null;
          setStartLabel('');
          setTimeLabel('');
          setOwnerName('');
          setOwnerUid('');
          return;
        }
        const data: any = snap.data();
        const expiresAtMs = getMillis(data?.expiresAt);
        expiresAtRef.current = expiresAtMs || null;

        const stMs = getMillis(data?.startAt);
        if (stMs) {
          const d = new Date(stMs);
          setStartLabel(
            d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
          );
        } else {
          setStartLabel('');
        }

        setTimeLabel(formatTimeHHmmDisplay(data?.timeHHmm));

        // Capture beacon message
        const msg = typeof data?.message === 'string' ? data.message.trim() : '';
        setBeaconMessage(msg);

        // Mirror the beacon's audience so outgoing messages can copy it verbatim.
        beaconAudienceRef.current = Array.isArray(data?.audienceUids) ? data.audienceUids : [];

        // Resolve owner display name
        const oUid = data?.ownerUid;
        setOwnerUid(typeof oUid === 'string' ? oUid : '');
        if (typeof oUid === 'string' && oUid) {
          try {
            const profSnap = await getDoc(doc(db, 'Profiles', oUid));
            const prof = profSnap.exists() ? (profSnap.data() as any) : {};
            const dn = (prof.displayName || prof.username || '').toString().trim();
            setOwnerName(dn || data?.ownerName || '');
          } catch {
            setOwnerName(data?.ownerName || '');
          }
        } else {
          setOwnerName(data?.ownerName || '');
        }
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [beaconId]);

  useEffect(() => {
    setMessagesLoaded(false);
    const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
    // Track the NEWEST 300 messages: query descending, then reverse to ascending
    // for render, so a thread past 300 messages still shows new arrivals.
    //
    // The array-contains filter is REQUIRED, not an optimization. Firestore rules are not filters:
    // a query is rejected unless its own constraints prove the read rule, and the ChatMessages read
    // rule is `uid in resource.data.audienceUids`. Without this the whole listener is denied.
    const q = query(
      col,
      where('audienceUids', 'array-contains', me?.uid ?? '__none__'),
      orderBy('createdAt', 'desc'),
      limit(300)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr: ChatMessage[] = [];
        snap.forEach((d) => {
          // serverTimestamps: 'estimate' gives a just-sent message a local-time
          // estimate instead of null, so a pending write never renders as 1969.
          const data: any = d.data({ serverTimestamps: 'estimate' });
          const createdAtMs =
            getMillis(data?.createdAt) || (d.metadata.hasPendingWrites ? Date.now() : 0);
          arr.push({
            id: d.id,
            text: (data?.text || '').toString(),
            authorUid: data?.authorUid ? String(data.authorUid) : undefined,
            authorName: data?.authorName ? String(data.authorName) : undefined,
            createdAt: createdAtMs ? new Date(createdAtMs) : new Date(0),
            type: (data?.type as any) || 'user',
            subtype: data?.subtype ? String(data.subtype) : undefined,
            actorUid: data?.actorUid ? String(data.actorUid) : undefined,
            actorName: data?.actorName ? String(data.actorName) : undefined,
            kind: data?.kind === 'gif' ? 'gif' : 'text',
            media:
              data?.media && typeof data.media?.url === 'string'
                ? {
                    provider: 'giphy' as const,
                    id: String(data.media.id || ''),
                    url: String(data.media.url),
                    previewUrl: data.media.previewUrl ? String(data.media.previewUrl) : undefined,
                    w: Number(data.media.w) || 0,
                    h: Number(data.media.h) || 0,
                  }
                : undefined,
            reactions:
              data?.reactions && typeof data.reactions === 'object'
                ? Object.fromEntries(
                    Object.entries(data.reactions)
                      .filter(([, v]) => Array.isArray(v))
                      .map(([k, v]) => [k, (v as any[]).map(String)])
                  )
                : undefined,
          });
        });
        arr.reverse();
        setMessages(arr);
        setMessagesLoaded(true);
      },
      () => setMessagesLoaded(true)
    );

    return () => unsub();
  }, [beaconId]);

  // Scroll-to-bottom on first load, OR to targetMessageId (initial or when it changes
  // to a new value after a follow-up notification arrives while the modal is open).
  useEffect(() => {
    if (messages.length === 0) return;

    // Initial scroll: to target if provided, otherwise to end.
    if (!didInitialScrollRef.current) {
      const targetIdx = targetMessageId
        ? messages.findIndex((m) => m.id === targetMessageId)
        : -1;
      requestAnimationFrame(() => {
        if (targetIdx >= 0) {
          listRef.current?.scrollToIndex({ index: targetIdx, animated: false, viewPosition: 0.3 });
          lastScrolledTargetRef.current = targetMessageId;
        } else {
          listRef.current?.scrollToEnd({ animated: false });
        }
        didInitialScrollRef.current = true;
      });
      return;
    }

    // Subsequent scroll-to-target: a follow-up notification arrived, targetMessageId changed.
    if (targetMessageId && targetMessageId !== lastScrolledTargetRef.current) {
      const idx = messages.findIndex((m) => m.id === targetMessageId);
      if (idx >= 0) {
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
          lastScrolledTargetRef.current = targetMessageId;
        });
        return;
      }
    }

    if (pendingScrollRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
        pendingScrollRef.current = false;
      });
    }
  }, [messages, targetMessageId]);

  const iAmIn = useMemo(() => {
    if (!me) return false;
    return messages.some((m) => m.type === 'system' && m.subtype === 'im-in' && m.actorUid === me.uid);
  }, [messages, me]);

  // Roster derived from state: the beacon lighter counts as 1, plus each DISTINCT
  // im-in actor (excluding the owner so they are never double-counted).
  const attendees = useMemo(() => {
    const byUid = new Map<string, string>();
    for (const m of messages) {
      if (m.type !== 'system' || m.subtype !== 'im-in') continue;
      if (!m.actorUid || m.actorUid === ownerUid) continue;
      if (!byUid.has(m.actorUid)) byUid.set(m.actorUid, (m.actorName || 'Someone').trim() || 'Someone');
    }
    const names = ownerName ? [ownerName] : [];
    for (const n of byUid.values()) names.push(n);
    return { count: 1 + byUid.size, names };
  }, [messages, ownerUid, ownerName]);

  // Copy of the parent beacon's audience for outgoing writes. OMITTED (not sent as []) until the
  // beacon doc has delivered a real list: the create rule allows an ABSENT copy (the trigger
  // stamps it) but rejects a present one that mismatches, and an empty-array copy against a
  // stamped beacon is a guaranteed permission-denied.
  const audienceCopy = () =>
    beaconAudienceRef.current.length ? { audienceUids: beaconAudienceRef.current } : {};

  const handleSendBody = useCallback((body: string) => {
    press();
    const meNow = auth.currentUser;
    if (!meNow) return;
    (async () => {
      try {
        setSending(true);
        const authorName = await resolveMyName(meNow.uid);
        const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
        const expiresAt = expiresAtRef.current ? Timestamp.fromMillis(expiresAtRef.current) : null;

        // Do NOT await the server ack: offline it never resolves and would lock
        // the composer. Firestore queues the write offline and the local snapshot
        // echo confirms delivery. Only surface hard failures.
        addDoc(col, {
          text: body,
          authorUid: meNow.uid,
          authorName,
          type: 'user',
          ...(beaconAudienceRef.current.length ? { audienceUids: beaconAudienceRef.current } : {}),
          createdAt: serverTimestamp(),
          ...(expiresAt ? { expiresAt } : {}),
        }).catch(() => {
          Alert.alert('Send failed', 'Please try again.');
        });

        pendingScrollRef.current = true;
      } catch {
        Alert.alert('Send failed', 'Please try again.');
      } finally {
        setSending(false);
      }
    })();
  }, [beaconId]);

  const handleSendGif = (gif: PickedGif) => {
    setGifOpen(false);
    if (!me) return;
    selection();
    (async () => {
      try {
        const authorName = await resolveMyName(me.uid);
        const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
        const expiresAt = expiresAtRef.current ? Timestamp.fromMillis(expiresAtRef.current) : null;

        // Fire-and-forget, same as handleSend: offline the ack never resolves.
        // authorUid is set so the sender can delete their own GIF (delete rule keys off it).
        addDoc(col, {
          type: 'user',
          kind: 'gif',
          authorUid: me.uid,
          authorName,
          ...audienceCopy(),
          text: '',
          media: {
            provider: 'giphy',
            id: gif.id,
            url: gif.url,
            previewUrl: gif.previewUrl ?? null,
            w: gif.w,
            h: gif.h,
          },
          createdAt: serverTimestamp(),
          ...(expiresAt ? { expiresAt } : {}),
        }).catch(() => Alert.alert('Send failed', 'Please try again.'));

        pendingScrollRef.current = true;
      } catch {
        Alert.alert('Send failed', 'Please try again.');
      }
    })();
  };

  const handleImIn = async () => {
    if (!me || iAmIn) return;
    try {
      const actorName = await resolveMyName(me.uid);
      const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
      const expiresAt = expiresAtRef.current ? Timestamp.fromMillis(expiresAtRef.current) : null;

      await addDoc(col, {
        type: 'system',
        subtype: 'im-in',
        actorUid: me.uid,
        actorName,
        // authorUid mirrors actorUid so the owner can delete their own RSVP:
        // the ChatMessages delete rule keys off authorUid. It's inert everywhere
        // else (roster, notifications, and the account sweep all read actorUid).
        authorUid: me.uid,
        ...audienceCopy(),
        text: `${actorName} is in`,
        createdAt: serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });

      pendingScrollRef.current = true;
    } catch {
      // Generic on purpose: if someone can see this chat, telling them the beacon "isn't shared
      // with them" reads as an accusation and is usually OUR stamping bug, not their standing.
      Alert.alert("Couldn't set status", 'Please try again.');
    }
  };

  const handleUndoImIn = async () => {
    if (!me || !iAmIn) return;
    tap();
    // The "going" count, the roster, and the button state all derive from the
    // im-in system messages, so removing mine reverts all three at once. Delete
    // every match in case an offline retry ever left a duplicate behind.
    const mine = messages.filter(
      (m) => m.type === 'system' && m.subtype === 'im-in' && m.actorUid === me.uid
    );
    if (mine.length === 0) return;
    try {
      await Promise.all(
        mine.map((m) => deleteDoc(doc(db, 'Beacons', beaconId, 'ChatMessages', m.id)))
      );
    } catch {
      Alert.alert("Couldn't undo", 'Please try again.');
    }
  };

  const openMenu = (msg: ChatMessage) => {
    if (msg.type === 'system') return;
    tap();
    // Unified sheet on both platforms: it carries the reaction row, which a native
    // ActionSheet can't render.
    setMenuFor(msg);
  };

  const handleReport = (msg: ChatMessage) => {
    setMenuFor(null);
    Alert.alert(
      'Report message?',
      'Are you sure you want to report this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            const uid = auth.currentUser?.uid;
            if (!uid) return;
            try {
              await addDoc(collection(db, 'Reports'), {
                targetType: 'beacon_message',
                beaconId,
                messageId: msg.id,
                messageAuthorUid: msg.authorUid || null,
                reporterUid: uid,
                createdAt: serverTimestamp(),
                status: 'open',
                snippet: String(msg.text || '').slice(0, 200),
              });
              Alert.alert('Thanks', 'We received your report.');
            } catch (e: any) {
              Alert.alert('Report failed', e?.message ?? 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleDelete = (msg: ChatMessage) => {
    setMenuFor(null);
    Alert.alert(
      'Delete message?',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            warning();
            const uid = auth.currentUser?.uid;
            if (!uid || msg.authorUid !== uid) return;
            try {
              await deleteDoc(doc(db, 'Beacons', beaconId, 'ChatMessages', msg.id));
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message ?? 'Please try again.');
            }
          },
        },
      ]
    );
  };

  // Toggle my reaction on a message. One reaction per person: picking a new emoji
  // moves me off any other. The whole (tiny) reactions map is rewritten, which the
  // narrow ChatMessages update rule (only 'reactions' may change) permits.
  const handleReact = (msg: ChatMessage, emoji: string) => {
    setMenuFor(null);
    const uid = me?.uid;
    if (!uid || msg.type === 'system') return;
    selection();
    const current = msg.reactions || {};
    const mineOnThis = Array.isArray(current[emoji]) && current[emoji].includes(uid);
    const next: Record<string, string[]> = {};
    for (const [em, uids] of Object.entries(current)) {
      const kept = (uids || []).filter((u) => u !== uid); // clear me everywhere first
      if (kept.length > 0) next[em] = kept;
    }
    if (!mineOnThis) next[emoji] = [...(next[emoji] || []), uid]; // then add me to the picked one
    const ref = doc(db, 'Beacons', beaconId, 'ChatMessages', msg.id);
    updateDoc(ref, { reactions: next }).catch(() => Alert.alert("Couldn't react", 'Please try again.'));
  };

  const handleCopy = async (msg: ChatMessage) => {
    setMenuFor(null);
    try {
      await Clipboard.setStringAsync(msg.text || '');
      tap();
    } catch {
      // no-op: copy failing is not worth an alert
    }
  };


  const openGif = useCallback(() => {
    tap();
    Keyboard.dismiss();
    setGifOpen(true);
  }, []);
  const focusScroll = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Stable props + memoized component = typing in the composer never re-renders this panel.
  const ComposerRow = (
    <ChatComposer
      draftKey={`@bekin_chat_draft_${me?.uid ?? 'anon'}:${beaconId}`}
      sending={sending}
      onSend={handleSendBody}
      onOpenGif={openGif}
      onFocusScroll={focusScroll}
      composerFocusedRef={composerFocusedRef}
    />
  );

  const PanelBody = (
    <>
      <View style={[styles.slimHeader, { borderBottomColor: tc.border, backgroundColor: tc.headerBg }]}>
        <Text style={[styles.headerTitle, { color: tc.text }]} numberOfLines={1} ellipsizeMode="tail">
          {ownerName ? `Beacon from ${ownerName}` : 'Beacon'}
        </Text>
        {(!!startLabel || !!timeLabel) && (
          <Text style={[styles.headerDate, { color: tc.subtle }]}>
            {startLabel}
            {startLabel && timeLabel ? ' · ' : ''}
            {timeLabel}
          </Text>
        )}
        <Pressable
          onPress={() => { tap(); setAttendeesOpen(true); }}
          hitSlop={6}
          style={({ pressed }) => [
            styles.goingChip,
            { backgroundColor: tc.inputBg, borderColor: tc.border },
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${attendees.count} going, tap to see who`}
        >
          <Text style={[styles.goingText, { color: tc.text }]}>
            {attendees.count} going
          </Text>
        </Pressable>

        {/* "I'm in" is a fully separate overlay: it does NOT touch the centered title/date/going
            column (that block is left exactly as it was). It floats in the right half of the header,
            centered in the gap right of the going chip and bottom-aligned to sit level with it. */}
        <View style={styles.imInWrap} pointerEvents="box-none">
          {iAmIn ? (
            <Pressable
              onPress={handleUndoImIn}
              style={({ pressed }) => [styles.imInChip, styles.imInChipDone, pressed && { opacity: 0.85 }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="You're in. Tap to undo."
            >
              <Text style={[styles.imInText, styles.imInTextDone]}>✓ I&apos;m in</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleImIn}
              style={({ pressed }) => [styles.imInChip, { backgroundColor: tc.primary }, pressed && { opacity: 0.9 }]}
              hitSlop={8}
            >
              <Text style={styles.imInText}>I&apos;m in</Text>
            </Pressable>
          )}
        </View>
      </View>

      {!!beaconMessage && (
        <View style={[styles.beaconMsgSection, { borderBottomColor: tc.border, backgroundColor: tc.headerBg }]}>
          {/* Hidden unclamped copy, measurement only: onTextLayout on a CLAMPED Text reports the
              truncated line count (3), never the full one, so "is there more?" must be measured
              against the full text in a zero-height in-flow wrapper (same width as the visible
              text). This is why See more never appeared on clamped descriptions. */}
          <View style={styles.beaconMsgMeasure} pointerEvents="none">
            <Text
              style={styles.beaconMsgText}
              onTextLayout={(e) => setMsgTruncated(e.nativeEvent.lines.length > 3)}
            >
              {beaconMessage}
            </Text>
          </View>
          <Text
            style={[styles.beaconMsgText, { color: tc.subtle }]}
            // 3-line clamp (was 5): long descriptions were eating the thread's space.
            numberOfLines={msgExpanded ? undefined : 3}
          >
            {beaconMessage}
          </Text>
          {(msgTruncated || msgExpanded) && (
            <Pressable onPress={() => setMsgExpanded((v) => !v)} hitSlop={6}>
              <Text style={[styles.beaconMsgToggle, { color: tc.primary }]}>{msgExpanded ? 'See less' : 'See more'}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View
        style={styles.listArea}
        onLayout={(e) => setListViewportH(e.nativeEvent.layout.height)}
      >
        {hasRealMessages && isListScrollable && showJump && (
          <Pressable
            onPress={scrollToTop}
            hitSlop={10}
            style={({ pressed }) => [
              styles.scrollTopBtn,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Jump to top"
          >
            <Text style={styles.scrollTopIcon}>↑</Text>
          </Pressable>
        )}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={
            messages.length === 0
              ? { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }
              : { padding: 6, gap: 6, paddingBottom: 6 }
          }
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={32}
          onScroll={onListScroll}
          onContentSizeChange={(_w, h) => setListContentH(h)}
          onScrollToIndexFailed={(info) => {
            const offset = info.averageItemLength * info.index;
            listRef.current?.scrollToOffset({ offset, animated: false });
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.3 });
            }, 100);
          }}
          style={{ flex: 1 }}
          ListEmptyComponent={
            !messagesLoaded ? (
              online ? (
                <ActivityIndicator />
              ) : (
                <Text style={{ color: tc.subtle, fontSize: 13 }}>
                  Can&apos;t load messages. No internet connection.
                </Text>
              )
            ) : (
              <Text style={{ color: tc.subtle, fontSize: 13 }}>
                {online ? "No messages yet. Say something 👋" : "Can&apos;t load messages. No internet connection."}
              </Text>
            )
          }
          renderItem={({ item, index }) => {
            // The beacon header already says "Beacon from X", so a "put out the beacon" row is just
            // noise (and doubled up on an off/on/off). Hide any that were written before.
            if (item.type === 'system' && item.subtype === 'extinguished') return null;

            // Day divider ("Today" / "Yesterday" / date) the first time each calendar day appears.
            const prevAny = messages[index - 1];
            const showDay =
              item.createdAt.getTime() > 0 &&
              (!prevAny || !isSameDay(prevAny.createdAt, item.createdAt));
            const dayDivider = showDay ? (
              <View style={styles.dayDivider}>
                <Text style={[styles.dayDividerText, { color: tc.subtle, backgroundColor: tc.inputBg }]}>
                  {formatDayLabel(item.createdAt)}
                </Text>
              </View>
            ) : null;

            if (item.type === 'system') {
              const isRsvp = item.subtype === 'im-in';
              return (
                <>
                  {dayDivider}
                  <View style={[styles.systemRow, { backgroundColor: tc.inputBg }]}>
                    {isRsvp ? (
                      <Text style={styles.systemText}>
                        <Text>🔥 </Text>
                        <Text style={{ color: tc.primary, fontWeight: '800' }}>{item.actorName || 'Someone'}</Text>
                        <Text style={{ color: tc.subtle }}> is in</Text>
                      </Text>
                    ) : (
                      <Text style={[styles.systemText, { color: tc.subtle }]}>{item.text}</Text>
                    )}
                  </View>
                </>
              );
            }

            const mine = item.authorUid === me?.uid;
            // Group consecutive messages from the same sender within 3 minutes: tighter spacing,
            // sender name only on the first of a THEIR-group, timestamp only on the last of a group.
            const prev = messages[index - 1];
            const next = messages[index + 1];
            const GROUP_MS = 3 * 60 * 1000;
            const samePrev =
              !!prev && prev.type !== 'system' && prev.authorUid === item.authorUid &&
              item.createdAt.getTime() - prev.createdAt.getTime() < GROUP_MS;
            const sameNext =
              !!next && next.type !== 'system' && next.authorUid === item.authorUid &&
              next.createdAt.getTime() - item.createdAt.getTime() < GROUP_MS;
            const showName = !mine && !samePrev;
            const showTime = !sameNext;
            const isGif = item.kind === 'gif' && !!item.media?.url;

            return (
              <>
              {dayDivider}
              <View
                style={[
                  styles.msgRow,
                  mine ? styles.msgRowMine : styles.msgRowTheirs,
                  { marginTop: samePrev ? 2 : 10 },
                ]}
              >
                <View style={[styles.msgCol, { alignItems: mine ? 'flex-end' : 'flex-start' }]}>
                  {showName && (
                    <Text style={[styles.senderName, { color: tc.subtle }]} numberOfLines={1}>
                      {item.authorName || 'Friend'}
                    </Text>
                  )}
                  <Pressable
                    onPress={isGif ? () => { tap(); setGifViewer(item.media!.url); } : undefined}
                    onLongPress={() => openMenu(item)}
                    delayLongPress={250}
                    style={
                      isGif
                        ? styles.gifBubble
                        : [
                            styles.bubble,
                            mine
                              ? [styles.bubbleMine, { backgroundColor: tc.bubbleMine, borderColor: tc.bubbleMineBorder }]
                              : [styles.bubbleTheirs, { backgroundColor: tc.bubbleTheirs, borderColor: tc.bubbleTheirsBorder }],
                          ]
                    }
                    accessibilityRole={isGif ? 'imagebutton' : 'text'}
                    accessibilityLabel={isGif ? `GIF from ${item.authorName || 'friend'}, double tap to expand` : undefined}
                    accessibilityHint="Long press for options"
                  >
                    {isGif ? (
                      <Image
                        source={{ uri: item.media!.url }}
                        style={{ width: gifDims(item.media!).w, height: gifDims(item.media!).h, borderRadius: 13 }}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={120}
                      />
                    ) : (
                      <Text style={[styles.msgText, { color: tc.text }]}>{item.text}</Text>
                    )}
                  </Pressable>
                  {item.reactions && Object.values(item.reactions).some((u) => u.length > 0) && (
                    <View style={[styles.reactionChipsRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
                      {Object.entries(item.reactions)
                        .filter(([, u]) => u.length > 0)
                        .map(([em, u]) => {
                          const active = !!(me && u.includes(me.uid));
                          return (
                            <Pressable
                              key={em}
                              onPress={() => handleReact(item, em)}
                              hitSlop={4}
                              style={[
                                styles.reactionChip,
                                { backgroundColor: tc.inputBg, borderColor: active ? tc.primary : tc.border },
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={`${em} reaction, ${u.length}, double tap to toggle`}
                            >
                              <Text style={styles.reactionChipEmoji}>{em}</Text>
                              {u.length > 1 && (
                                <Text style={[styles.reactionChipCount, { color: tc.subtle }]}>{u.length}</Text>
                              )}
                            </Pressable>
                          );
                        })}
                    </View>
                  )}
                  {showTime && (
                    <Text style={[styles.msgTime, { color: tc.subtle }]}>{formatMsgTime(item.createdAt)}</Text>
                  )}
                </View>
              </View>
              </>
            );
          }}
        />
      </View>

      {ComposerRow}

      <Modal
        visible={!!menuFor}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuFor(null)}
      >
        <Pressable style={[styles.menuBackdrop, { backgroundColor: tc.backdrop }]} onPress={() => setMenuFor(null)}>
          <View style={[styles.menuSheet, { backgroundColor: tc.card }]}>
            <View style={styles.reactionBar}>
              {REACTION_EMOJIS.map((em) => {
                const active = !!(menuFor && me && menuFor.reactions?.[em]?.includes(me.uid));
                return (
                  <Pressable
                    key={em}
                    onPress={() => { if (menuFor) handleReact(menuFor, em); }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.reactionEmojiBtn,
                      active && { backgroundColor: tc.inputBg },
                      pressed && { opacity: 0.6 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`React ${em}`}
                  >
                    <Text style={styles.reactionEmoji}>{em}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />

            {menuFor && menuFor.kind !== 'gif' && !!menuFor.text && (
              <Pressable style={styles.menuItem} onPress={() => { if (menuFor) handleCopy(menuFor); }}>
                <Text style={[styles.menuText, { color: tc.text }]}>Copy</Text>
              </Pressable>
            )}

            <Pressable
              style={styles.menuItem}
              onPress={() => { if (menuFor) handleReport(menuFor); }}
            >
              <Text style={[styles.menuText, { color: tc.text }]}>Report</Text>
            </Pressable>

            {menuFor && me && menuFor.authorUid === me.uid ? (
              <>
                <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { if (menuFor) handleDelete(menuFor); }}
                >
                  <Text style={[styles.menuText, styles.menuTextDestructive, { color: tc.danger }]}>Delete message</Text>
                </Pressable>
              </>
            ) : null}

            <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />
            <Pressable style={styles.menuItem} onPress={() => setMenuFor(null)}>
              <Text style={[styles.menuText, { color: tc.text }]}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={attendeesOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAttendeesOpen(false)}
      >
        <Pressable style={[styles.menuBackdrop, { backgroundColor: tc.backdrop }]} onPress={() => setAttendeesOpen(false)}>
          <View style={[styles.menuSheet, { backgroundColor: tc.card }]}>
            <Text style={[styles.attendeesTitle, { color: tc.text }]}>
              {attendees.count} going
            </Text>
            {attendees.names.map((n, i) => (
              <Text key={`${n}-${i}`} style={[styles.attendeeName, { color: tc.subtle }]} numberOfLines={1}>
                {n}
              </Text>
            ))}
            <View style={[styles.menuDivider, { backgroundColor: tc.border }]} />
            <Pressable style={styles.menuItem} onPress={() => setAttendeesOpen(false)}>
              <Text style={[styles.menuText, { color: tc.text }]}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <GifPicker visible={gifOpen} onClose={() => setGifOpen(false)} onPick={handleSendGif} />

      <Modal
        visible={!!gifViewer}
        transparent
        animationType="fade"
        onRequestClose={() => setGifViewer(null)}
      >
        <Pressable style={styles.gifViewerBackdrop} onPress={() => setGifViewer(null)}>
          {!!gifViewer && (
            <Image
              source={{ uri: gifViewer }}
              style={styles.gifViewerImage}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          )}
          <Pressable
            style={styles.gifViewerClose}
            onPress={() => setGifViewer(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );

  // ----- Render (apply only-overlap lift) -----

  const DoneAccessory = Platform.OS === 'ios' ? (
    <InputAccessoryView nativeID={CHAT_ACCESSORY_ID}>
      <View style={[styles.iosAccessory, { borderTopColor: tc.border, backgroundColor: tc.card }]}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={styles.iosDoneBtn}>
          <Text style={[styles.iosDoneText, { color: tc.text }]}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  ) : null;

  if (onClose) {
    return (
      <>
        <View style={[styles.modalShim, { backgroundColor: tc.backdrop }]}>
          {/* Backdrop tap closes */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close beacon chat"
          />

          <View style={[styles.cardWrap, { backgroundColor: tc.card }]}>
            <View style={[styles.wrap, maxHeight ? { height: maxHeight } : { flex: 1 }, { backgroundColor: tc.card, borderColor: tc.border }, style]}>{PanelBody}</View>
          </View>
        </View>
        {DoneAccessory}
      </>
    );
  }

  if (loading) {
    return (
      <View style={[styles.wrap, maxHeight ? { height: maxHeight } : { flex: 1 }, { backgroundColor: tc.card, borderColor: tc.border }, style]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <View
        style={[styles.wrap, maxHeight ? { height: maxHeight } : { flex: 1 }, { backgroundColor: tc.card, borderColor: tc.border }, style]}
      >
        {PanelBody}
      </View>
      {DoneAccessory}
    </>
  );
}

const styles = StyleSheet.create({
  // iOS input accessory
  iosAccessory: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 6,
  },
  iosDoneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(15,23,42,0.08)',
  },
  iosDoneText: { fontWeight: '700', color: '#0B1426' },

  modalShim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'center',
    padding: SCREEN_PAD,
  },
  cardWrap: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  wrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
  },

  slimHeader: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F8FAFF',
  },
  // "I'm in" overlay. Occupies the right slice of the header (left:'65%' -> right:0) and centers its
  // content, so the chip sits closer to the right edge (roughly halving the old gap to the container
  // edge) while staying clear of the centered going chip. Bottom padding matches the header's
  // paddingVertical so it sits level with the going chip's bottom. This is a pure overlay: it never
  // affects the layout of the centered title/date/going column.
  imInWrap: {
    position: 'absolute',
    left: '65%',
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0B1426',
    textAlign: 'center',
  },
  headerDate: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },
  goingChip: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  goingText: {
    fontSize: 11,
    fontWeight: '700',
  },
  attendeesTitle: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    paddingTop: 14,
    paddingBottom: 8,
  },
  attendeeName: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 16,
  },

  imInChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#2F6FED',
  },
  imInText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  imInChipDone: { backgroundColor: '#E6FCEB', borderWidth: 1, borderColor: '#A7F3D0' },
  imInTextDone: { color: '#065F46' },

  beaconMsgSection: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F8FAFF',
  },
  // zero-height in-flow wrapper: full-width like the visible text, contributes no layout height
  beaconMsgMeasure: { height: 0, overflow: 'hidden', opacity: 0 },
  beaconMsgText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  beaconMsgToggle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2F6FED',
    marginTop: 4,
  },

  listArea: {
    flex: 1,
    position: 'relative',
  },
  scrollTopBtn: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    zIndex: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scrollTopIcon: { color: '#fff', fontWeight: '800', fontSize: 14 },

  msgRow: { flexDirection: 'row', alignItems: 'flex-start' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },

  // NO maxWidth here: msgCol (below) caps the width against the full-width row. A percentage cap
  // on this level resolved against msgCol's CONTENT-derived width, so a short timestamp under a
  // message could set the column width first and squeeze the bubble to a couple of characters
  // ("test" rendering as "te"/"st" on two lines).
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  bubbleMine: { backgroundColor: '#EEF2FF', borderColor: '#D4DEFF' },
  bubbleTheirs: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB' },

  msgMeta: { fontSize: 11, color: '#94A3B8', marginBottom: 3, fontWeight: '500' },
  msgText: { color: '#0B1426', fontSize: 15, lineHeight: 21 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dotsInline: { fontSize: 14, color: '#94A3B8', paddingLeft: 4 },

  systemRow: {
    alignItems: 'center',
    paddingVertical: 4,
    marginVertical: 6,
    alignSelf: 'center',
    backgroundColor: '#F0F4FF',
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  systemText: { color: '#475569', fontWeight: '600', fontSize: 12 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    padding: 8,
    backgroundColor: '#FAFBFF',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    color: '#0B1426',
    backgroundColor: '#FFFFFF',
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: '#2F6FED',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },

  composerPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 4,
    minHeight: 40,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    paddingTop: Platform.OS === 'ios' ? 8 : 6,
    paddingBottom: Platform.OS === 'ios' ? 8 : 6,
    maxHeight: 120,
  },
  charCount: {
    fontSize: 11,
    fontWeight: '700',
    alignSelf: 'center',
    paddingHorizontal: 4,
  },
  gifBtn: {
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    marginLeft: 4,
  },
  gifBtnText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  sendCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  msgCol: { maxWidth: '82%' },
  senderName: { fontSize: 11, fontWeight: '600', marginBottom: 2, marginHorizontal: 6 },
  msgTime: { fontSize: 10, marginTop: 3, marginHorizontal: 4 },
  gifBubble: {
    padding: 3,
    borderRadius: 16,
    overflow: 'hidden',
  },
  gifViewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gifViewerImage: { width: '92%', height: '72%' },

  reactionBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  reactionEmojiBtn: { padding: 8, borderRadius: 999 },
  reactionEmoji: { fontSize: 24 },
  reactionChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  reactionChipEmoji: { fontSize: 12 },
  reactionChipCount: { fontSize: 11, fontWeight: '700' },

  dayDivider: { alignItems: 'center', marginVertical: 10 },
  dayDividerText: {
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  gifViewerClose: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#fff',
    paddingVertical: 4,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 16 },
  menuText: { fontSize: 16, color: '#0B1426', textAlign: 'center' },
  menuTextDestructive: { color: '#DC2626', fontWeight: '700' },
  menuDivider: { height: 1, backgroundColor: '#E5E7EB' },
});