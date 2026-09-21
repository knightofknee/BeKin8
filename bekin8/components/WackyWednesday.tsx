// components/WackyWednesday.tsx
// Wacky Wednesday: a small round BeKin-icon "W" button that exists ONLY on Wednesdays (device-local
// day), sized to match the home screen's help button. Tapping it opens a card explaining the idea.
// It is a philosophy nudge, not a feature with state: no network, no prefs, nothing to persist.
import React, { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tap } from '../utils/haptics';

// Verification switch: flip to true to check the button on a non-Wednesday. MUST ship as false.
const FORCE_SHOW = false;

const SIZE = 28; // same footprint as the help-circle icon it sits beside

export function isWackyWednesday(today: Date): boolean {
  return FORCE_SHOW || today.getDay() === 3;
}

type Props = {
  /** A Date inside "today" (home passes its midnight-aware day anchor so this flips at 12:00am). */
  today: Date;
  style?: StyleProp<ViewStyle>;
};

export default function WackyWednesday({ today, style }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!isWackyWednesday(today)) return null;

  return (
    <>
      <Pressable
        onPress={() => { tap(); setOpen(true); }}
        hitSlop={12}
        style={[styles.btn, style]}
        accessibilityRole="button"
        accessibilityLabel="Wacky Wednesday"
      >
        {/* The app icon is a hand-drawn W on white with wide margins: oversize it inside the
            clipped circle so the W itself fills the button. */}
        <Image source={require('../assets/icon.png')} style={styles.icon} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardIconWrap}>
              <Image source={require('../assets/icon.png')} style={styles.cardIcon} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>Wacky Wednesday</Text>
            <Text style={[styles.tagline, { color: colors.primary }]}>Creativity, Weird and Effort.</Text>
            <Text style={[styles.body, styles.bodyFirst, { color: colors.subtle }]}>
              Make the Effort to explore Creative mediums and let out your inner Weird. Find a regular
              time in your week to do art therapy, create with a process-over-product mentality. The
              result is not important.
            </Text>
            <Text style={[styles.body, { color: colors.subtle }]}>
              You can Wacky Wednesday on your own or with friends. If you make a habit of it, I
              recommend having someone bring a new medium or activity or theme for each week.
            </Text>
            <Pressable
              onPress={() => { tap(); setOpen(false); }}
              style={[styles.closeBtn, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
            >
              <Text style={styles.closeTxt}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: SIZE * 1.5, height: SIZE * 1.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 360, borderRadius: 20, padding: 24, alignItems: 'center' },
  cardIconWrap: {
    width: 64, height: 64, borderRadius: 32, overflow: 'hidden', backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  cardIcon: { width: 96, height: 96 },
  title: { fontSize: 20, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  tagline: { fontSize: 15, fontWeight: '700', marginTop: 4, marginBottom: 10, textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  bodyFirst: { marginBottom: 12 },
  closeBtn: { alignSelf: 'stretch', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  closeTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
