// components/StokeModal.tsx
// The hidden STOKE: relighting a beacon never re-pings friends (the server only announces a beacon
// once), but it arms a one-time nudge. Long-pressing the lit fire opens this; Send calls the
// stokeBeacon callable, which enforces the once-only cap server-side. Never advertised anywhere.
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useTheme } from '../providers/ThemeProvider';
import { press, success } from '../utils/haptics';

type Props = {
  visible: boolean;
  beaconId: string | null;
  /** The beacon's current message, shown as the placeholder and sent if left blank. */
  currentMessage: string;
  onClose: () => void;
};

export default function StokeModal({ visible, beaconId, currentMessage, onClose }: Props) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const send = async () => {
    if (!beaconId || busy) return;
    press();
    setBusy(true);
    try {
      await httpsCallable(getFunctions(), 'stokeBeacon')({ beaconId, message: text.trim() });
      success();
      onClose();
    } catch (e: any) {
      const code = String(e?.code || '');
      Alert.alert(
        "Couldn't stoke",
        code.includes('failed-precondition') ? 'This fire has already been stoked.' : 'Please try again.'
      );
      if (code.includes('failed-precondition')) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>Stoke the fire</Text>
          <Text style={[styles.body, { color: colors.subtle }]}>
            Send your friends one more nudge about your beacon. You can only do this once.
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={currentMessage}
            placeholderTextColor={colors.subtle}
            maxLength={200}
            multiline
            style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
          />
          <View style={styles.row}>
            <Pressable onPress={onClose} style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]} disabled={busy}>
              <Text style={[styles.btnTxt, { color: colors.text }]}>Not now</Text>
            </Pressable>
            <Pressable onPress={send} style={[styles.btn, { backgroundColor: colors.primary }]} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnTxt, { color: '#fff' }]}>Send</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', borderRadius: 20, padding: 24 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 72,
    fontSize: 16,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  row: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { fontSize: 16, fontWeight: '700' },
});
