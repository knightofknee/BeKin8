// components/tutorial/TutorialModal.tsx
// A reusable, re-openable stepped tutorial presented as a bottom sheet.
// Deliberately NOT a measured-view spotlight overlay: home's controls live inside their
// own modals and the friend-beacon list uses dynamic measurement, so a punch-out spotlight
// would be race-prone on the new architecture. This reuses the app's existing modal idiom
// (transparent Modal + backdrop Pressable, see components/ItemMenu.tsx) and is themed.
import React, { useEffect, useState } from "react";
import {
  View,
  Modal,
  Pressable,
  Text,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../providers/ThemeProvider";
import { tap, success } from "../../utils/haptics";

export type TutorialStep = {
  title: string;
  /** A string, or any custom node (e.g. the example-beacon card or a toggles preview). */
  body: React.ReactNode;
  /** Optional override for the advance button label (defaults to "Next" / "Done"). */
  cta?: string;
  /** One-shot side effect fired when this step becomes visible (e.g. open the options modal). */
  onEnter?: () => void | Promise<void>;
};

type Props = {
  visible: boolean;
  steps: TutorialStep[];
  /** Called whenever the sheet closes — by finishing, skipping, or tapping the backdrop. */
  onClose: () => void;
  /** Called in addition to onClose, only when the user completes the final step. */
  onFinish?: () => void;
  startIndex?: number;
};

export default function TutorialModal({
  visible,
  steps,
  onClose,
  onFinish,
  startIndex = 0,
}: Props) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [index, setIndex] = useState(startIndex);

  // Reset to the start whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) setIndex(startIndex);
  }, [visible, startIndex]);

  // Fire the current step's side effect once on entry. Depends only on (visible, index) so
  // an inline `steps` array from the host doesn't retrigger it every render.
  useEffect(() => {
    if (!visible) return;
    const fn = steps[index]?.onEnter;
    if (fn) {
      try {
        Promise.resolve(fn()).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, index]);

  if (!steps.length) return null;
  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  const goNext = () => {
    if (isLast) {
      success();
      onFinish?.();
      onClose();
    } else {
      tap();
      setIndex((i) => Math.min(i + 1, steps.length - 1));
    }
  };
  const goBack = () => {
    if (isFirst) return;
    tap();
    setIndex((i) => Math.max(i - 1, 0));
  };
  const skip = () => {
    tap();
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={skip}>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.backdrop }]} onPress={skip}>
        {/* Inner Pressable swallows taps so they don't dismiss the sheet. */}
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, maxHeight: height * 0.82 }]}
          onPress={() => {}}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {step.title}
            </Text>
            <Pressable hitSlop={10} onPress={skip} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.subtle} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.bodyScroll}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {typeof step.body === "string" ? (
              <Text style={[styles.bodyText, { color: colors.text }]}>{step.body}</Text>
            ) : (
              step.body
            )}
          </ScrollView>

          <View style={styles.dots}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: i === index ? colors.primary : colors.border },
                  i === index && styles.dotActive,
                ]}
              />
            ))}
          </View>

          <View style={styles.footer}>
            <Pressable
              onPress={goBack}
              disabled={isFirst}
              style={[styles.btnGhost, isFirst && styles.btnHidden]}
            >
              <Text style={[styles.btnGhostText, { color: colors.subtle }]}>Back</Text>
            </Pressable>
            <Pressable onPress={goNext} style={[styles.btnPrimary, { backgroundColor: colors.primary }]}>
              <Text style={styles.btnPrimaryText}>{step.cta ?? (isLast ? "Done" : "Next")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
  },
  header: { marginBottom: 10, justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", textAlign: "center", paddingHorizontal: 26 },
  closeBtn: { position: "absolute", top: 0, right: 0, padding: 2 },
  bodyScroll: { flexGrow: 0 },
  bodyContent: { paddingBottom: 8 },
  bodyText: { fontSize: 15, lineHeight: 22 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 16, marginBottom: 16 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotActive: { width: 18 },
  footer: { flexDirection: "row", alignItems: "center", gap: 12 },
  btnGhost: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12 },
  btnGhostText: { fontSize: 15, fontWeight: "600" },
  btnHidden: { opacity: 0 },
  btnPrimary: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
