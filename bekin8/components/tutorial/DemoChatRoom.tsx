// components/tutorial/DemoChatRoom.tsx
// A fully LOCAL demo of the beacon chat, opened by tapping the example "Coffee at the park?"
// beacon card that zero-friend users see. It looks and behaves like the real ChatRoom (header
// with date + going count, an I'm in / undo chip, message bubbles, a growing composer that
// really "sends") but every message lives in component state: nothing is written anywhere and
// NO ONE is notified. The point is to let a brand-new user feel the whole loop, RSVP + chat,
// before they have a single friend.
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../providers/ThemeProvider';
import { tap, press, success } from '../../utils/haptics';

type DemoMsg = {
  id: string;
  kind: 'user' | 'system';
  author: 'Alex' | 'Sam' | 'You';
  text: string;
  time: string;
};

const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// The seeded conversation: enough back-and-forth to show what a live beacon feels like.
const SEED: DemoMsg[] = [
  { id: 's1', kind: 'user', author: 'Alex', text: 'Coffee at the park? ☕ I brought the thermos and way too many cups', time: '10:02' },
  { id: 's2', kind: 'system', author: 'Sam', text: 'Sam is in', time: '10:05' },
  { id: 's3', kind: 'user', author: 'Sam', text: 'omw! grabbing croissants on the way 🥐', time: '10:06' },
  { id: 's4', kind: 'user', author: 'Alex', text: 'Legend. We are by the big oak near the north entrance', time: '10:09' },
];

export default function DemoChatRoom({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: tc } = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<DemoMsg[]>(SEED);
  const [text, setText] = useState('');
  const [imIn, setImIn] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const idRef = useRef(0);

  // Fresh demo each open.
  useEffect(() => {
    if (visible) {
      setMessages(SEED);
      setText('');
      setImIn(false);
    }
  }, [visible]);

  const scrollDown = () => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

  const send = () => {
    const body = text.trim();
    if (!body) return;
    press();
    idRef.current += 1;
    setMessages((prev) => [...prev, { id: `u${idRef.current}`, kind: 'user', author: 'You', text: body, time: nowTime() }]);
    setText('');
    scrollDown();
  };

  const toggleImIn = () => {
    if (imIn) {
      tap();
      setImIn(false);
      setMessages((prev) => prev.filter((m) => !(m.kind === 'system' && m.author === 'You')));
      return;
    }
    success();
    setImIn(true);
    idRef.current += 1;
    setMessages((prev) => [...prev, { id: `i${idRef.current}`, kind: 'system', author: 'You', text: 'You are in', time: nowTime() }]);
    scrollDown();
  };

  const going = 2 + (imIn ? 1 : 0); // Alex + Sam, plus you

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: tc.backdrop, paddingTop: insets.top + 8 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: tc.card, borderColor: tc.border, marginBottom: insets.bottom + 8 }]}>
          {/* header, real-ChatRoom layout */}
          <View style={[styles.header, { borderBottomColor: tc.border, backgroundColor: tc.headerBg }]}>
            <Text style={[styles.headerTitle, { color: tc.text }]}>Beacon from Alex</Text>
            <Text style={[styles.headerDate, { color: tc.subtle }]}>Today · 10:00</Text>
            <View style={[styles.goingChip, { backgroundColor: tc.inputBg, borderColor: tc.border }]}>
              <Text style={[styles.goingText, { color: tc.text }]}>{going} going</Text>
            </View>
            <View style={styles.imInWrap} pointerEvents="box-none">
              <Pressable
                onPress={toggleImIn}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.imInChip,
                  imIn ? styles.imInChipDone : { backgroundColor: tc.primary },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={[styles.imInText, imIn && styles.imInTextDone]}>{imIn ? "✓ I'm in" : "I'm in"}</Text>
              </Pressable>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close demo chat">
              <Ionicons name="close" size={22} color={tc.subtle} />
            </Pressable>
          </View>

          {/* demo banner: honest about what this is */}
          <View style={[styles.demoBanner, { backgroundColor: tc.inputBg, borderBottomColor: tc.border }]}>
            <Text style={[styles.demoBannerText, { color: tc.subtle }]}>
              Demo chat. Try it out, nothing is sent and no one is notified.
            </Text>
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={styles.thread}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.map((m) =>
              m.kind === 'system' ? (
                <View key={m.id} style={[styles.systemRow, { backgroundColor: tc.inputBg }]}>
                  <Text style={styles.systemText}>
                    <Text>🔥 </Text>
                    <Text style={{ color: tc.primary, fontWeight: '800' }}>{m.author === 'You' ? 'You' : m.author}</Text>
                    <Text style={{ color: tc.subtle }}>{m.author === 'You' ? ' are in' : ' is in'}</Text>
                  </Text>
                </View>
              ) : (
                <View key={m.id} style={[styles.msgRow, m.author === 'You' ? styles.msgRowMine : styles.msgRowTheirs]}>
                  <View style={{ maxWidth: '82%', alignItems: m.author === 'You' ? 'flex-end' : 'flex-start' }}>
                    {m.author !== 'You' && (
                      <Text style={[styles.senderName, { color: tc.subtle }]}>{m.author}</Text>
                    )}
                    <View
                      style={[
                        styles.bubble,
                        m.author === 'You'
                          ? { backgroundColor: tc.bubbleMine, borderColor: tc.bubbleMineBorder }
                          : { backgroundColor: tc.bubbleTheirs, borderColor: tc.bubbleTheirsBorder },
                      ]}
                    >
                      <Text style={[styles.msgText, { color: tc.text }]}>{m.text}</Text>
                    </View>
                    <Text style={[styles.msgTime, { color: tc.subtle }]}>{m.time}</Text>
                  </View>
                </View>
              )
            )}
          </ScrollView>

          {/* composer, real-ChatRoom look */}
          <View style={[styles.inputRow, { borderTopColor: tc.border, backgroundColor: tc.headerBg }]}>
            <View style={[styles.composerPill, { borderColor: tc.border, backgroundColor: tc.inputBg }]}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Message"
                placeholderTextColor={tc.subtle}
                style={[styles.composerInput, { color: tc.text }]}
                multiline
                maxLength={500}
                onFocus={scrollDown}
                blurOnSubmit={false}
                returnKeyType="send"
                onSubmitEditing={send}
              />
            </View>
            <Pressable
              onPress={send}
              disabled={!text.trim()}
              style={[styles.sendCircle, { backgroundColor: tc.primary, opacity: text.trim() ? 1 : 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel="Send demo message"
            >
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingHorizontal: 12 },
  card: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  headerDate: { fontSize: 12, marginTop: 2, textAlign: 'center' },
  goingChip: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  goingText: { fontSize: 11, fontWeight: '700' },
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
  imInChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  imInText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  imInChipDone: { backgroundColor: '#E6FCEB', borderWidth: 1, borderColor: '#A7F3D0' },
  imInTextDone: { color: '#065F46' },
  closeBtn: { position: 'absolute', top: 8, left: 8, padding: 4 },

  demoBanner: { paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1 },
  demoBannerText: { fontSize: 12, fontStyle: 'italic', textAlign: 'center' },

  thread: { padding: 8, gap: 6 },
  systemRow: {
    alignItems: 'center',
    paddingVertical: 4,
    marginVertical: 6,
    alignSelf: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  systemText: { fontWeight: '600', fontSize: 12 },
  msgRow: { flexDirection: 'row', marginTop: 8 },
  msgRowMine: { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  senderName: { fontSize: 11, fontWeight: '600', marginBottom: 2, marginHorizontal: 6 },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  msgText: { fontSize: 15, lineHeight: 21 },
  msgTime: { fontSize: 10, marginTop: 3, marginHorizontal: 4 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderTopWidth: 1,
    padding: 8,
  },
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
  sendCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
