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
  authorUid: string;
  authorName?: string;
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
  // Prefer Profiles.username, fallback to auth.displayName
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
  const [closed, setClosed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // cache beacon expiry for TTL stamping
  const expiresAtRef = useRef<number | null>(null);

  // Subscribe to the beacon for expiry info
  useEffect(() => {
    const ref = doc(db, 'Beacons', beaconId);
    const unsub = onSnapshot(ref, (snap) => {
      setLoading(false);
      if (!snap.exists()) {
        setClosed(true);
        return;
      }
      const data: any = snap.data();
      const startAtMs = getMillis(data?.startAt);
      const expiresAtMs = getMillis(data?.expiresAt);
      expiresAtRef.current = expiresAtMs || null;

      const now = Date.now();
      // Hard close if explicit expiresAt is in the past
      const isExpired = !!expiresAtMs && now > expiresAtMs;
      setClosed(isExpired);

      // Soft close fallback: end of startAt day
      if (!expiresAtMs && startAtMs) {
        const eos = new Date(startAtMs);
        eos.setHours(23, 59, 59, 999);
        if (now > eos.getTime()) setClosed(true);
      }
    }, () => {
      setLoading(false);
    });

    return () => unsub();
  }, [beaconId]);

  // Subscribe to messages (always; visibility is handled at the screen/rules level)
  useEffect(() => {
    const col = collection(db, 'Beacons', beaconId, 'ChatMessages');
    const q = query(col, orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      const arr: ChatMessage[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        const createdAtMs = getMillis(data?.createdAt) || 0;
        arr.push({
          id: d.id,
          text: (data?.text || '').toString(),
          authorUid: (data?.authorUid || '').toString(),
          authorName: (data?.authorName || '').toString(),
          createdAt: createdAtMs ? new Date(createdAtMs) : new Date(0),
        });
      });
      setMessages(arr);
    });

    return () => unsub();
  }, [beaconId]);

  const canSend = useMemo(() => {
    return !!me && !closed && text.trim().length > 0 && !sending;
  }, [me, closed, text, sending]);

  const handleSend = async () => {
    if (!canSend || !me) return;
    try {
      setSending(true);
      const authorName = await resolveMyName(me.uid);
      const col = collection(db, 'Beacons', beaconId, 'ChatMessages');

      // TTL: stamp each message with the beacon's expiresAt for automatic cleanup if TTL is enabled
      const expiresAt = expiresAtRef.current
        ? Timestamp.fromMillis(expiresAtRef.current)
        : null;

      await addDoc(col, {
        text: text.trim(),
        authorUid: me.uid,
        authorName,
        createdAt: serverTimestamp(),
        ...(expiresAt ? { expiresAt } : {}),
      });

      setText('');
    } catch (e) {
      console.warn('send failed', e);
    } finally {
      setSending(false);
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
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 8, gap: 8 }}
        renderItem={({ item }) => {
          const mine = item.authorUid === me?.uid;
          return (
            <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={styles.msgMeta} numberOfLines={1}>
                  {item.authorName || (mine ? 'You' : 'Friend')} • {item.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={styles.msgText}>{item.text}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.inputRow, closed && { opacity: 0.5 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={closed ? 'Chat is closed' : 'Message'}
          placeholderTextColor="#9CA3AF"
          editable={!closed}
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

      {closed && (
        <Text style={styles.closedNote}>This beacon has ended — chat is closed.</Text>
      )}
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
  msgRow: {
    flexDirection: 'row',
  },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  bubbleMine: { backgroundColor: '#2F6FED' },
  bubbleTheirs: { backgroundColor: '#F3F4F6' },
  msgText: { color: '#111827' },
  msgMeta: { fontSize: 11, marginBottom: 2, color: '#6B7280' },
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
  closedNote: {
    textAlign: 'center',
    color: '#6B7280',
    paddingBottom: 8,
  },
});
