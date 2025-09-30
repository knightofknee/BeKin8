// components/ChatRoom.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { auth, db } from '../firebase.config';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

type ChatMessage = {
  id: string;
  text: string;
  createdAt: Date;
  authorUid?: string; // absent for system messages
  authorName?: string;
  type?: 'user' | 'system';
  subtype?: 'im-in' | string;
  actorUid?: string;     // who triggered the system event
  actorName?: string;    // pretty name for system event
};

type ChatRoomProps = {
  beaconId: string;
  // optional height override for embedding in modals
  maxHeight?: number;
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

async function resolveMyName(uid: string): Promise<string> {
  // Prefer Profiles.username, fallback to auth.displayName/"Me"
  try {
    const snap = await getDoc(doc(db, 'Profiles', uid));
    const username = (snap.data() as any)?.username;
    if (typeof username === 'string' && username.trim()) return username.trim();
  } catch { /* ignore */ }
  const u = auth.currentUser;
  return (u?.displayName || '').toString().trim() || 'Me';
}

export default function ChatRoom({ beaconId, maxHeight = 220 }: ChatRoomProps) {
  const me = auth.currentUser;
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // Slim header state
  const [startLabel, setStartLabel] = useState<string>(''); // e.g. "Mon, Oct 6"

  // cache beacon expiry for TTL stamping (optional)
  const expiresAtRef = useRef<number | null>(null);

  // Subscribe to the beacon: for TTL + date label
  useEffect(() => {
    const ref = doc(db, 'Beacons', beaconId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          expiresAtRef.current = null;
          setStartLabel('');
          return;
        }
        const data: any = snap.data();
        const expiresAtMs = getMillis(data?.expiresAt);
        expiresAtRef.current = expiresAtMs || null;

        const stMs = getMillis(data?.startAt);
        if (stMs) {
          const d = new Date(stMs);
          setStartLabel(
            d.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
          );
        } else {
          setStartLabel('');
        }
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [beaconId]);

  // Subscribe to messages (always)
  useEffect(() => {
    const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
    const q = query(col, orderBy('createdAt', 'asc'), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      const arr: ChatMessage[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        const createdAtMs = getMillis(data?.createdAt) || 0;
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
        });
      });
      setMessages(arr);
    });

    return () => unsub();
  }, [beaconId]);

  // Have *I* already RSVP’d “I’m in”? (based on system message)
  const iAmIn = useMemo(() => {
    if (!me) return false;
    return messages.some(
      (m) => m.type === 'system' && m.subtype === 'im-in' && m.actorUid === me.uid
    );
  }, [messages, me]);

  const canSend = useMemo(() => {
    return !!me && text.trim().length > 0 && !sending;
  }, [me, text, sending]);

  const handleSend = async () => {
    if (!canSend || !me) return;
    try {
      setSending(true);
      const authorName = await resolveMyName(me.uid);
      const col = collection(db, 'Beacons', beaconId, 'ChatMessages');

      // TTL: stamp each message with the beacon's expiresAt if present
      const expiresAt = expiresAtRef.current ? Timestamp.fromMillis(expiresAtRef.current) : null;

      await addDoc(col, {
        text: text.trim(),
        authorUid: me.uid,
        authorName,
        type: 'user',
        createdAt: serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });

      setText('');
    } catch (e) {
      console.warn('send failed', e);
      Alert.alert('Send failed', 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleImIn = async () => {
    if (!me || iAmIn) return;
    try {
      const actorName = await resolveMyName(me.uid);
      const col = collection(db, 'Beacons', beaconId, 'ChatMessages');

      const expiresAt = expiresAtRef.current ? Timestamp.fromMillis(expiresAtRef.current) : null;

      // Post a *system* message that records my RSVP
      await addDoc(col, {
        type: 'system',
        subtype: 'im-in',
        actorUid: me.uid,
        actorName,
        text: `${actorName} is in`,
        createdAt: serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });
      // No local state toggle needed — the snapshot will pick it up and flip iAmIn
    } catch (e) {
      console.warn("I'm in failed", e);
      Alert.alert("Couldn't set status", 'Please try again.');
    }
  };

  if (loading) {
    return (
      <View style={[styles.wrap, { maxHeight }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.wrap, { maxHeight }]}
    >
      {/* Slim header with date + RSVP chip */}
      {(startLabel || true) && (
        <View style={styles.slimHeader}>
          <Text style={styles.slimDate}>{startLabel || 'Beacon'}</Text>

          {iAmIn ? (
            <View style={[styles.imInChip, styles.imInChipDone]}>
              <Text style={[styles.imInText, styles.imInTextDone]}>✓ I’m in</Text>
            </View>
          ) : (
            <Pressable
              onPress={handleImIn}
              style={({ pressed }) => [styles.imInChip, pressed && { opacity: 0.9 }]}
              hitSlop={8}
            >
              <Text style={styles.imInText}>I’m in</Text>
            </Pressable>
          )}
        </View>
      )}

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 8, gap: 8 }}
        renderItem={({ item }) => {
          if (item.type === 'system') {
            // Centered system line (no bubble, no name/time)
            return (
              <View style={styles.systemRow}>
                <Text style={styles.systemText}>{item.text}</Text>
              </View>
            );
          }

          const mine = item.authorUid === me?.uid;
          return (
            <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={styles.msgMeta} numberOfLines={1}>
                  {(item.authorName || (mine ? 'You' : 'Friend'))}{' '}
                  • {item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={styles.msgText}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor="#9CA3AF"
          editable
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          style={[styles.sendBtn, { opacity: canSend ? 1 : 0.5 }]}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendTxt}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },

  // Slim header
  slimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FCFCFF',
  },
  slimDate: { fontSize: 12, color: '#475569', fontWeight: '700' },

  imInChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#2F6FED',
  },
  imInText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  imInChipDone: { backgroundColor: '#E6FCEB', borderWidth: 1, borderColor: '#A7F3D0' },
  imInTextDone: { color: '#065F46' },

  // Message rows
  msgRow: { flexDirection: 'row' },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },

  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  bubbleMine: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7DAFF',
  },
  bubbleTheirs: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E5E7EB',
  },

  msgText: { color: '#0B1426', fontSize: 15, lineHeight: 20 },
  msgMeta: { fontSize: 11, marginBottom: 2, color: '#64748B' },

  // Centered system line
  systemRow: { alignItems: 'center', paddingVertical: 2 },
  systemText: { color: '#64748B', fontStyle: 'italic', fontSize: 12 },

  // Composer
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    padding: 8,
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    color: '#0B1426',
  },
  sendBtn: {
    backgroundColor: '#2F6FED',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendTxt: { color: '#fff', fontWeight: '800' },
});