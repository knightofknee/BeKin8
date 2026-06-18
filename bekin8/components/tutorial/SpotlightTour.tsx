// components/tutorial/SpotlightTour.tsx
// The visual layer of the coach-mark tour: dims the screen with a hole punched around the
// current step's target element, draws a highlight ring, and shows a callout with copy + nav.
// Rendered at the root (by TourProvider) so it sits above everything, including the tab bar.
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  Keyboard,
  Platform,
  AccessibilityInfo,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../providers/ThemeProvider";
import { tap, success } from "../../utils/haptics";

export type Rect = { x: number; y: number; width: number; height: number };

export type TourStep = {
  /** Key of a registered target to spotlight. Omit for a centered, no-target step. */
  target?: string;
  /** Stable identifier so a screen can react to which step is active (e.g. advance on sheet close). */
  id?: string;
  title: string;
  body: React.ReactNode;
  cta?: string;
  /** One-shot side effect on entering the step (e.g. open the options sheet / navigate). */
  onEnter?: () => void | Promise<void>;
  /**
   * When true, taps inside the spotlight hole pass through to the real element so the user can
   * edit/toggle it without ending the tour. Only the dimmed area is blocked — and only once the
   * hole is actually drawn (until then the whole screen is shielded). Combined with no `target`,
   * this becomes a "free interaction" step: a floating callout that blocks nothing, so the user
   * can use the whole screen underneath (e.g. fill in the beacon options sheet).
   */
  interactive?: boolean;
  /**
   * When true, tapping the spotlighted element ADVANCES the tour instead of triggering the real
   * element — used when the very next step opens/navigates to what this step points at.
   */
  advanceOnTargetTap?: boolean;
  /**
   * When set, advancing from this step jumps to the step with this target key instead of the
   * next in order — used to skip an optional branch (e.g. the profile detour).
   */
  nextTarget?: string;
};

type Props = {
  steps: TourStep[];
  index: number;
  canBack: boolean;
  measureTarget: (key: string) => Promise<Rect | null>;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
};

const DIM = "rgba(0,0,0,0.62)";
const PAD = 8;

export default function SpotlightTour({ steps, index, canBack, measureTarget, onNext, onPrev, onSkip }: Props) {
  const { colors } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<Rect | null>(null);
  const [kbHeight, setKbHeight] = useState(0);
  const titleRef = useRef<Text>(null);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKbHeight(e.endCoordinates?.height ?? 0)
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKbHeight(0)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  // On each step: reset to a clean keyboard baseline, run the side effect, announce it for
  // assistive tech, and CONTINUOUSLY re-measure the target so the ring tracks late layout, the
  // sheet animation, reflow, and scrolling. A not-yet-measured target NEVER advances the tour —
  // until a rect lands we just show the centered fallback callout (no silent skips, ever).
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let a11yTimer: ReturnType<typeof setTimeout> | undefined;
    setRect(null);
    // Blur whatever input was focused (e.g. the time field) and collapse the keyboard, so the new
    // step's callout isn't pinned low by a stale keyboard height and no stray cursor lingers.
    Keyboard.dismiss();
    setKbHeight(0);
    Promise.resolve(step?.onEnter?.()).catch(() => {});

    if (step) {
      AccessibilityInfo.announceForAccessibility(`${step.title}. Step ${index + 1} of ${steps.length}`);
      a11yTimer = setTimeout(() => {
        const node = titleRef.current && findNodeHandle(titleRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      }, 250);
    }

    if (step?.target) {
      const poll = async () => {
        if (cancelled) return;
        const r = await measureTarget(step.target!);
        if (!cancelled && r && r.width > 0) {
          // Update whenever the target actually moved (>0.5px on any axis) so a rect captured
          // mid-animation is replaced by the settled one, but a stable target doesn't churn.
          setRect((prev) =>
            prev &&
            Math.abs(prev.x - r.x) < 0.5 &&
            Math.abs(prev.y - r.y) < 0.5 &&
            Math.abs(prev.width - r.width) < 0.5 &&
            Math.abs(prev.height - r.height) < 0.5
              ? prev
              : r
          );
        }
        if (!cancelled) pollTimer = setTimeout(poll, 180);
      };
      poll();
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (a11yTimer) clearTimeout(a11yTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!step) return null;

  const goNext = () => {
    if (isLast) success();
    else tap();
    onNext();
  };
  const goBack = () => {
    tap();
    onPrev();
  };
  const skip = () => {
    tap();
    onSkip();
  };

  // Hole geometry — symmetric padding clamped to the viewport on every axis, so the ring always
  // contains the FULL measured target (never crops the top to satisfy a bottom-overflow clamp).
  // holeBottom/holeRight are floored to hy/hx so an off-screen target can't yield a negative size.
  const hy = rect ? Math.max(0, rect.y - PAD) : 0;
  const holeBottom = rect ? Math.max(hy, Math.min(H, rect.y + rect.height + PAD)) : 0;
  const hh = holeBottom - hy;
  const hx = rect ? Math.max(0, rect.x - PAD) : 0;
  const holeRight = rect ? Math.max(hx, Math.min(W, rect.x + rect.width + PAD)) : 0;
  const hw = holeRight - hx;

  // Place the callout in the LARGER free gap above/below the hole, anchored to the hole edge so it
  // never overlaps the ring, and cap its content height to that gap (it scrolls internally). This
  // guarantees the title/Skip and Back/Next stay on-screen even for a tall target (Settings group)
  // and even before the keyboard settles. The gap below shrinks to sit above the keyboard.
  const TOP_LIMIT = insets.top + 12;
  const kbLimit = kbHeight > 0 ? H - kbHeight - 12 : H - insets.bottom - 12;
  const CARD_PAD = 32; // styles.callout vertical padding (16 top + 16 bottom)
  let calloutPos: any;
  let calloutMaxH: number;
  if (!rect) {
    calloutPos = { top: TOP_LIMIT, left: 18, right: 18 };
    calloutMaxH = Math.max(0, kbLimit - TOP_LIMIT - CARD_PAD);
  } else {
    const gapTop = hy - 12 - TOP_LIMIT;
    const gapBottom = kbLimit - (holeBottom + 12);
    if (gapTop >= gapBottom) {
      calloutPos = { bottom: H - hy + 12, left: 18, right: 18 };
      calloutMaxH = Math.max(0, gapTop - CARD_PAD);
    } else {
      calloutPos = { top: holeBottom + 12, left: 18, right: 18 };
      calloutMaxH = Math.max(0, gapBottom - CARD_PAD);
    }
  }

  // Block the whole screen unless this is an interactive step that already has a real hole to
  // expose — so touches never fall through to the live app during the navigate→measure window.
  const hasHole = !!rect;
  // A "free interaction" step (interactive + no target) shows only a floating callout and blocks
  // nothing, so the user can use the whole screen underneath (e.g. fill in the options sheet).
  const freeStep = !!step.interactive && !step.target;
  const blockAll = !freeStep && !(step.interactive && hasHole);
  const dimPE = step.interactive && hasHole ? "auto" : "none";

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {blockAll && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {}}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
      )}

      {!freeStep &&
        (rect ? (
          <>
            <View pointerEvents={dimPE} style={[styles.dim, { left: 0, top: 0, width: W, height: hy }]} />
            <View
              pointerEvents={dimPE}
              style={[styles.dim, { left: 0, top: holeBottom, width: W, height: Math.max(0, H - holeBottom) }]}
            />
            <View pointerEvents={dimPE} style={[styles.dim, { left: 0, top: hy, width: hx, height: hh }]} />
            <View
              pointerEvents={dimPE}
              style={[styles.dim, { left: hx + hw, top: hy, width: Math.max(0, W - (hx + hw)), height: hh }]}
            />
            <View
              pointerEvents="none"
              style={[styles.ring, { left: hx, top: hy, width: hw, height: hh, borderColor: colors.primary }]}
            />
          </>
        ) : (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} />
        ))}

      {/* Tap-to-advance: the spotlighted element advances the tour (the next step opens it). Sits
          above the blocking layer so taps in the hole reach this instead of the real element. */}
      {step.advanceOnTargetTap && rect && (
        <Pressable
          onPress={goNext}
          style={{ position: "absolute", left: hx, top: hy, width: hw, height: hh }}
          accessibilityRole="button"
          accessibilityLabel={`${step.title}. Tap to continue`}
        />
      )}

      <View style={[styles.callout, { backgroundColor: colors.card }, calloutPos]} accessibilityViewIsModal>
        {/* Capped to the available gap; if the content is ever taller than the gap it scrolls,
            so the title/Skip and Back/Next can never be pushed off-screen. */}
        <ScrollView
          style={{ maxHeight: Math.max(120, calloutMaxH) }}
          bounces={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.calloutHeader}>
            <Text
              ref={titleRef}
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
              numberOfLines={2}
            >
              {step.title}
            </Text>
            <Pressable hitSlop={10} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip tutorial">
              <Text style={[styles.skipTxt, { color: colors.subtle }]}>Skip</Text>
            </Pressable>
          </View>

          {typeof step.body === "string" ? (
            <Text style={[styles.body, { color: colors.text }]}>{step.body}</Text>
          ) : (
            step.body
          )}

          <Text style={[styles.progress, { color: colors.subtle }]}>{`Step ${index + 1} of ${steps.length}`}</Text>

          <View style={styles.nav}>
            <Pressable
              onPress={goBack}
              disabled={!canBack}
              style={[styles.btnGhost, !canBack && styles.hidden]}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Text style={[styles.btnGhostTxt, { color: colors.subtle }]}>Back</Text>
            </Pressable>
            <Pressable
              onPress={goNext}
              style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
            >
              <Text style={styles.btnPrimaryTxt}>{step.cta ?? (isLast ? "Done" : "Next")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: "absolute", backgroundColor: DIM },
  ring: { position: "absolute", borderWidth: 2, borderRadius: 12 },
  callout: {
    position: "absolute",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  calloutHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: "800", paddingRight: 8 },
  skipTxt: { fontSize: 14, fontWeight: "700", paddingTop: 2 },
  body: { fontSize: 15, lineHeight: 22 },
  progress: { fontSize: 12, fontWeight: "600", textAlign: "center", marginTop: 14, marginBottom: 12, letterSpacing: 0.3 },
  nav: { flexDirection: "row", alignItems: "center", gap: 12 },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  btnGhostTxt: { fontSize: 15, fontWeight: "600" },
  hidden: { opacity: 0 },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnPrimaryTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
