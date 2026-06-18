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
  Animated,
  AccessibilityInfo,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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
  /**
   * Force the callout into the TOP or LOW slot instead of auto-deciding. Use 'top' for a step whose
   * important content sits BELOW the spotlight (so a low callout would cover it).
   */
  placement?: "top" | "low";
  /**
   * For a LOW-placed step with a long body: anchor the callout by its TOP (not its bottom) and let it
   * grow DOWNWARD over the tab bar, so adding copy never pushes the box UP over the spotlighted
   * element. Used for the notifications step.
   */
  growDown?: boolean;
  /**
   * Extra spotlight padding ABOVE the target rect (px). Use when something drawn outside the target
   * should still be inside the highlight — e.g. the beacon flame towers well above the logs/structure
   * it's measured on, so the hole + ring need to reach up to enclose it.
   */
  holePadTop?: number;
  /**
   * Adjust the spotlight's BOTTOM edge (px; negative pulls it UP). Use to keep the hole/ring off an
   * element that sits just below the target — e.g. the "Open beacon chat" button under the logs.
   */
  holePadBottom?: number;
  /**
   * An optional side-step reached only via goToTarget (never the normal Next flow) — NOT counted in
   * the "Step X of N" total, so jumping into it doesn't make the numbers leap.
   */
  branch?: boolean;
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
  // TOP vs LOW slot, latched once per step from the first (keyboard-closed) measurement so focusing
  // a field mid-step — which shifts the sheet up — can't flip the callout's slot. null until latched.
  const [useLowLocked, setUseLowLocked] = useState<boolean | null>(null);
  // Gentle fade + rise on each step so the callout settles into place instead of hard-cutting
  // (softens the necessary TOP↔LOW moves between steps). Native-driven (opacity + transform).
  const calloutAnim = useRef(new Animated.Value(0)).current;
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
  // Step numbering ignores branch steps (optional side-steps), so jumping into one doesn't make the
  // "Step X of N" count leap.
  const total = steps.filter((s) => !s.branch).length;
  const current = Math.max(1, steps.slice(0, index + 1).filter((s) => !s.branch).length);

  // On each step: reset to a clean keyboard baseline, run the side effect, announce it for
  // assistive tech, and CONTINUOUSLY re-measure the target so the ring tracks late layout, the
  // sheet animation, reflow, and scrolling. A not-yet-measured target NEVER advances the tour —
  // until a rect lands we just show the centered fallback callout (no silent skips, ever).
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let a11yTimer: ReturnType<typeof setTimeout> | undefined;
    setRect(null);
    setUseLowLocked(null);
    // Fade + rise the callout into its (new) slot.
    calloutAnim.setValue(0);
    Animated.timing(calloutAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    // Blur whatever input was focused (e.g. the time field) and collapse the keyboard, so the new
    // step's callout isn't pinned low by a stale keyboard height and no stray cursor lingers.
    Keyboard.dismiss();
    setKbHeight(0);
    Promise.resolve(step?.onEnter?.()).catch(() => {});

    if (step) {
      AccessibilityInfo.announceForAccessibility(`${step.title}. Step ${current} of ${total}`);
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
          // Latch the slot from this first keyboard-closed measurement (step entry dismissed the
          // keyboard), so a later keyboard-driven sheet shift can't flip TOP↔LOW mid-step.
          setUseLowLocked((v) => (v == null ? r.y - PAD < insets.top + 12 + 260 : v));
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
  const hy = rect ? Math.max(0, rect.y - PAD - (step.holePadTop ?? 0)) : 0;
  const holeBottom = rect ? Math.max(hy, Math.min(H, rect.y + rect.height + PAD + (step.holePadBottom ?? 0))) : 0;
  const hh = holeBottom - hy;
  const hx = rect ? Math.max(0, rect.x - PAD) : 0;
  const holeRight = rect ? Math.max(hx, Math.min(W, rect.x + rect.width + PAD)) : 0;
  const hw = holeRight - hx;

  // Placement: ONE consistent spot the user can rely on. The callout sits at a fixed TOP position
  // (the same place as step 1) whenever it wouldn't cover the highlighted element; when the target
  // sits high enough that a top callout would cover it, it drops to a fixed LOW position just above
  // the tab bar — even if that overlaps the BOTTOM of the target. This stops the box from jumping
  // around between steps, and guarantees the title + Back/Next are always fully on-screen.
  const TOP_LIMIT = insets.top + 12;
  const CARD_PAD = 32; // styles.callout vertical padding (16 + 16)
  // BottomBar is 64 + 8 inset, flush at the screen bottom (the home indicator sits within it), so
  // clearing 72 + a small margin keeps Back/Next just above it — do NOT also add insets.bottom
  // (that double-counts the home indicator and left a dead gap below the box).
  const TAB_BAR_CLEARANCE = 72;
  const kbActive = kbHeight > 0;
  const bottomLimit = kbActive ? H - kbHeight - 12 : H - TAB_BAR_CLEARANCE - 12;
  // Floor for a LOW-anchored callout: above the keyboard when typing, else just above the tab bar.
  const lowBottom = kbActive ? kbHeight + 12 : TAB_BAR_CLEARANCE + 12;
  // A top callout would cover the target if the target starts within the top zone. Fixed estimate
  // (not the measured height) so the TOP/LOW choice is stable and never flips frame-to-frame. A
  // step can force a slot via `placement` (e.g. step 1 forces TOP so it clears the caption below).
  const TOP_ZONE = TOP_LIMIT + 260;
  const useLow =
    step.placement === "low"
      ? true
      : step.placement === "top"
      ? false
      : useLowLocked ?? (!!rect && hy < TOP_ZONE);
  let calloutPos: any;
  let calloutMaxH: number;
  if (useLow && step.growDown) {
    // Pin the TOP roughly where the short box would have sat in the low slot, then allow the box to
    // grow DOWN toward the screen bottom (covering the tab bar if the body is long) instead of
    // creeping up over the highlighted controls. LOW_REF ≈ a typical short-callout height.
    const LOW_REF = 270;
    const topAnchor = Math.max(TOP_LIMIT, H - lowBottom - LOW_REF);
    calloutPos = { top: topAnchor, left: 18, right: 18 };
    calloutMaxH = Math.max(120, H - topAnchor - 8); // down to ~8px from the bottom (over the tab bar)
  } else if (useLow) {
    calloutPos = { bottom: lowBottom, left: 18, right: 18 };
    calloutMaxH = Math.max(120, H - lowBottom - TOP_LIMIT - CARD_PAD);
  } else {
    calloutPos = { top: TOP_LIMIT, left: 18, right: 18 };
    // Keep the callout FULLY visible (sized to its content): don't shrink it to clear the spotlight.
    // It sits above the target and will only overlap a tall target (e.g. the flame) — acceptable.
    calloutMaxH = Math.max(120, bottomLimit - TOP_LIMIT - CARD_PAD);
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

      {/* Distinct guidance surface: a blue-tinted, elevated card with a primary accent border that
          echoes the spotlight ring — deliberately NOT an app card, so it reads as "the tour talking". */}
      <Animated.View
        style={[
          styles.callout,
          { backgroundColor: colors.tourSurface, borderColor: colors.tourBorder },
          calloutPos,
          {
            // Subtle settle, not a blink: dip to 0.5 and rise 8px, never fully disappear.
            opacity: calloutAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
            transform: [{ translateY: calloutAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
        ]}
        accessibilityViewIsModal
      >
        {/* Capped to the available gap; if the content is ever taller than the gap it scrolls,
            so the eyebrow and Back/Next can never be pushed off-screen. */}
        <ScrollView
          style={{ maxHeight: Math.max(120, calloutMaxH) }}
          bounces={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Eyebrow: brand-blue "STEP X OF N" + Skip tour — a small identity cue that this is the tour. */}
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrow}>
              <Ionicons name="sparkles" size={13} color={colors.primary} />
              <Text style={[styles.eyebrowTxt, { color: colors.primary }]}>
                {`STEP ${current} OF ${total}`}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={skip} accessibilityRole="button" accessibilityLabel="Skip tour">
              <Text style={[styles.skipTxt, { color: colors.subtle }]}>Skip tour</Text>
            </Pressable>
          </View>

          <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {step.title}
          </Text>

          {typeof step.body === "string" ? (
            <Text style={[styles.body, { color: colors.text }]}>{step.body}</Text>
          ) : (
            step.body
          )}

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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: "absolute", backgroundColor: DIM },
  ring: { position: "absolute", borderWidth: 2, borderRadius: 12 },
  callout: {
    position: "absolute",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    // Lifted clearly above app cards (which use 0.18/14/8) so it floats as a separate layer.
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  eyebrowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 5 },
  eyebrowTxt: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  title: { fontSize: 18, fontWeight: "800", marginBottom: 8 },
  skipTxt: { fontSize: 14, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22 },
  nav: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  btnGhostTxt: { fontSize: 15, fontWeight: "600" },
  hidden: { opacity: 0 },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnPrimaryTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
