// components/BeaconChatModal.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TextInput,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { auth, db } from '../firebase.config';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  onSnapshot as onUserSnapshot,
} from 'firebase/firestore';

type Beacon = {
  id: string;
  userId: string;
  displayName: string;
  message: string;
  startAt: Timestamp;
  expiresAt: Timestamp;
};

type ChatMsg = {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  createdAt: Timestamp;
  expireAt: Timestamp;
};

export default function BeaconChatModal({
  visible,
  beacon,
  onClose,
}: {
  visible: boolean;
  beacon?: Beacon;
  onClose: () => void;
}) {
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [meDisplayName, setMeDisplayName] = useState('Me');

  // My display name
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const unsub = onUserSnapshot(doc(db, 'users', user.uid), (snap) => {
      const data = snap.data() as any;
      setMeDisplayName(data?.username || data?.displayName || user.email || 'Me');
    });
    return unsub;
  }, []);

  // Subscribe to chat
  useEffect(() => {
    if (!visible || !beacon) {
      setChatMessages([]);
      return;
    }
    setLoadingChat(true);
    const msgsRef = collection(db, 'beacons', beacon.id, 'messages');
    const unsub = onSnapshot(query(msgsRef, orderBy('createdAt', 'asc'), limit(200)), (snap) => {
      const msgs: ChatMsg[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        msgs.push({
          id: d.id,
          text: data.text,
          senderId: data.senderId,
          senderName: data.senderName,
          createdAt: data.createdAt,
          expireAt: data.expireAt,
        });
      });
      setChatMessages(msgs);
      setLoadingChat(false);
    });
    return () => unsub();
  }, [visible, beacon?.id]);

  const sendChat = useCallback(async () => {
    if (!beacon) return;
    const user = auth.currentUser;
    if (!user) return;
    const text = chatInput.trim();
    if (!text) return;
    try {
      setChatInput('');
      await addDoc(collection(db, 'beacons', beacon.id, 'messages'), {
        text,
        senderId: user.uid,
        senderName: meDisplayName,
        createdAt: serverTimestamp(),
        // TTL: enable TTL on expireAt in Firestore to auto-delete after expiry
        expireAt: beacon.expiresAt,
      });
    } catch (e) {
      console.error(e);
    }
  }, [beacon, chatInput, meDisplayName]);

  if (!beacon) return null;

  const isToday = (() => {
    const a = beacon.startAt.toDate();
    const b = new Date();
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  })();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {isToday ? '🔥 Today' : '🗓 Upcoming'} — {beacon.displayName}
            </Text>
            <Pressable onPress={onClose}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <Text style={styles.modalMeta}>
            {beacon.startAt.toDate().toLocaleDateString()} • clears at{' '}
            {beacon.expiresAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={styles.modalMessage}>"{beacon.message || 'Beacon lit — who’s in?'}"</Text>

          <View style={styles.hr} />

          <Text style={styles.chatHeader}>Chat (auto-clears when the beacon expires)</Text>

          {loadingChat ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={chatMessages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ paddingVertical: 6 }}
              renderItem={({ item }) => (
                <View style={styles.msgBubble}>
                  <Text style={styles.msgSender}>{item.senderName}</Text>
                  <Text style={styles.msgText}>{item.text}</Text>
                  <Text style={styles.msgTime}>
                    {item.createdAt?.toDate
                      ? item.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '…'}
                  </Text>
                </View>
              )}
            />
          )}

          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Type a message…"
              value={chatInput}
              onChangeText={setChatInput}
              onSubmitEditing={sendChat}
              returnKeyType="send"
            />
            <TouchableOpacity style={styles.sendBtn} onPress={sendChat}>
              <Text style={styles.sendBtnText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const colors = {
  primary: '#2F6FED',
  ink: '#0B1426',
  dim: '#667085',
  border: '#E5E7EB',
};

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    padding: 14,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: '80%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  close: { fontSize: 22, paddingHorizontal: 8 },
  modalMeta: { color: colors.dim, marginTop: 6 },
  modalMessage: { marginTop: 10, fontSize: 16, fontStyle: 'italic', color: colors.ink },

  hr: { height: 1, backgroundColor: colors.border, marginVertical: 12 },

  chatHeader: { fontWeight: '700', marginBottom: 6, color: colors.ink },
  msgBubble: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  msgSender: { fontWeight: '700', marginBottom: 2, color: colors.ink },
  msgText: { color: colors.ink },
  msgTime: { color: colors.dim, fontSize: 12, marginTop: 4, alignSelf: 'flex-end' },

  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  sendBtnText: { color: '#fff', fontWeight: '700' },

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
});
