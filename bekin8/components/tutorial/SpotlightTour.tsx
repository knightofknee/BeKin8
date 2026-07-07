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
   * edit/toggle it without ending the tour. Only the dimmed area is blocked, and only once the
   * hole is actually drawn (until then the whole screen is shielded). Combined with no `target`,
   * this becomes a "free interaction" step: a floating callout that blocks nothing, so the user
   * can use the whole screen underneath (e.g. fill in the beacon options sheet).
   */
  interactive?: boolean;
  /**
   * When true, tapping the spotlighted element ADVANCES the tour instead of triggering the real
   * element, used when the very next step opens/navigates to what this step points at.
   */
  advanceOnTargetTap?: boolean;
  /**
   * When set, advancing from this step jumps to the step with this target key instead of the
   * next in order, used to skip an optional branch (e.g. the profile detour).
   */
  nextTarget?: string;
  /**
   * Force the callout slot instead of auto-deciding. 'top' = fixed top slot (for a step whose content
   * sits BELOW the spotlight). 'low' = fixed bottom slot. 'below' = anchored JUST UNDER the highlighted
   * target and grown downward (as high as possible without covering it), with `belowGap` revealing a
   * peek of what's beneath the target for orientation.
   */
  placement?: "top" | "low" | "below";
  /** For placement 'below': px between the anchor's bottom and the callout top (default 12). */
  belowGap?: number;
  /** For placement 'below': anchor the callout below THIS target's rect instead of the spotlighted
   * target's, so several steps can share one callout height. The ring still tracks `target`. */
  belowTarget?: string;
  /**
   * For a LOW-placed step with a long body: anchor the callout by its TOP (not its bottom) and let it
   * grow DOWNWARD over the tab bar, so adding copy never pushes the box UP over the spotlighted
   * element. Used for the notifications step.
   */
  growDown?: boolean;
  /**
   * Extra spotlight padding ABOVE the target rect (px). Use when something drawn outside the target
   * should still be inside the highlight, e.g. the beacon flame towers well above the logs/structure
   * it's measured on, so the hole + ring need to reach up to enclose it.
   */
  holePadTop?: number;
  /**
   * Adjust the spotlight's BOTTOM edge (px; negative pulls it UP). Use to keep the hole/ring off an
   * element that sits just below the target, e.g. the "Open beacon chat" button under the logs.
   */
  holePadBottom?: number;
  /**
   * Extra spotlight padding on ALL sides (px), on top of the default. Use to give the ring a clear gap
   * from the target when the target is large or the same color as the ring (e.g. the blue "Open beacon
   * chat" button, which otherwise reads as one solid blue shape with the ring).
   */
  holePad?: number;
  /**
   * An optional side-step reached only via goToTarget (never the normal Next flow), NOT counted in
   * the "Step X of N" total, so jumping into it doesn't make the numbers leap.
   */
  branch?: boolean;
  /**
   * Gate the final "Done": when true (last step only), the CTA renders greyed/disabled and can't be
   * tapped. Used by the guided first-beacon step (Done unlocks once username + friend + a set beacon
   * are all complete). Re-evaluated live as the host updates the steps.
   */
  ctaDisabled?: boolean;
  /**
   * When set, the step shows a small GREEN "Speed tour" button next to Next that calls this. Used on
   * step 1 to switch the full tour into the abbreviated speed tour (username, friend, light a beacon).
   */
  speedTour?: () => void;
  /**
   * When set, the Back button SHOWS (even on a first step with no history) and calls this instead of the
   * normal Back. Used by the speed tour's first step to return to the full tour's step 1.
   */
  backAction?: () => void;
  /** Override the displayed step number with a custom label (e.g. "2a", "2b") instead of the count. */
  stepLabel?: string;
  /** Fixed callout position: anchor its TOP at this FRACTION of screen height (0..1), independent of
   *  the target. Use to hold sibling sub-steps (e.g. 2a + 2b) at the SAME, higher spot. */
  topFrac?: number;
};

type Props = {
  steps: TourStep[];
  index: number;
  canBack: boolean;
  measureTarget: (key: string) => Promise<Rect | null>;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  /** Replay run (tour already completed/skipped once): the dismiss button reads "Close" instead of
   *  "Skip tour", since a returning user isn't skipping onboarding, just leaving. */
  isReplay?: boolean;
};

const DIM = "rgba(0,0,0,0.62)";
const PAD = 8;

// Strip emoji from the SPOKEN step title so VoiceOver/TalkBack don't read "fire"/"party popper" after
// the sentence. The displayed title keeps its emoji; this is only for announceForAccessibility.
const stripEmoji = (s: string) =>
  s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

export default function SpotlightTour({ steps, index, canBack, measureTarget, onNext, onPrev, onSkip, isReplay = false }: Props) {
  const { colors } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<Rect | null>(null);
  // The step index the current `rect` was measured for. Just after a step change (before the new
  // target is measured) this lags `index`; we keep drawing the PREVIOUS ring (no full-screen dim
  // flash) but treat the hole as "not fresh" so taps stay blocked until the new rect lands, then snap.
  const rectForIdxRef = useRef(-1);
  // Optional SECOND measured rect: a step can anchor its 'below' callout under a different element than
  // the one it spotlights (e.g. several Friends steps share one height under the request field).
  const [belowRect, setBelowRect] = useState<Rect | null>(null);
  const belowRectForIdxRef = useRef(-1);
  const [kbHeight, setKbHeight] = useState(0);
  // TOP vs LOW slot, latched once per step from the first (keyboard-closed) measurement so focusing
  // a field mid-step, which shifts the sheet up, can't flip the callout's slot. null until latched.
  const [useLowLocked, setUseLowLocked] = useState<boolean | null>(null);
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

  // On each step: reset to a clean keyboard baseline, run the side effect, and announce it for
  // assistive tech. The target MEASUREMENT / spotlight tracking lives in the next effect.
  useEffect(() => {
    // Keep the previous ring drawn during the re-measure (avoids the full-screen dim FLASH that read as
    // the real between-step clunk); interaction stays gated on a FRESH measurement (rectForIdxRef).
    // Clear it for a target-less step, and for a 'below' step (whose callout is positioned FROM the
    // target, so a stale rect would briefly anchor it to the wrong place; we hide the callout instead).
    if (!step?.target || step.placement === "below") setRect(null);
    setBelowRect(null);
    setUseLowLocked(null);
    // No transition between steps, the callout swaps content in place (instant). An instant cut is
    // crisp and the eye tracks the moving spotlight ring. Blur whatever input was focused and collapse
    // the keyboard so the new step's callout isn't pinned low by a stale keyboard height.
    Keyboard.dismiss();
    setKbHeight(0);
    Promise.resolve(step?.onEnter?.()).catch(() => {});

    if (!step) return;
    AccessibilityInfo.announceForAccessibility(`${stripEmoji(step.title)}. Step ${step.stepLabel ?? current} of ${total}`);
    const a11yTimer = setTimeout(() => {
      const node = titleRef.current && findNodeHandle(titleRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 250);
    return () => clearTimeout(a11yTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Measure the step's target and keep the spotlight on it. Polls every 180ms WHILE the target is
  // moving (e.g. the sheet sliding open), then SETTLES: once the rect is stable for a short window it
  // STOPS, so a static step costs nothing (no perpetual measureInWindow churn). Re-arms on step change
  // and on keyboard show/hide (kbHeight), which is when the sheet actually shifts. A not-yet-measured
  // target never advances the tour, until a rect lands we show the centered fallback callout.
  useEffect(() => {
    if (!step?.target) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let stable = 0;
    let lastR: Rect | null = null;
    let lastBR: Rect | null = null;
    const SETTLE = 8; // ~1.4s of no movement → stop (the 220ms sheet slide is tracked first, then settles)
    const near = (a: Rect | null, b: Rect) =>
      !!a &&
      Math.abs(a.x - b.x) < 0.5 &&
      Math.abs(a.y - b.y) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5 &&
      Math.abs(a.height - b.height) < 0.5;
    const poll = async () => {
      if (cancelled) return;
      const r = await measureTarget(step.target!);
      if (cancelled) return;
      if (r && r.width > 0) {
        rectForIdxRef.current = index; // this step's target is measured → ring is "fresh"
        const moved = !near(lastR, r);
        lastR = r;
        if (moved) setRect((prev) => (near(prev, r) ? prev : r));
        // Latch the slot from the first keyboard-closed measurement so a later keyboard-driven sheet
        // shift can't flip TOP↔LOW mid-step.
        setUseLowLocked((v) => (v == null ? r.y - PAD < insets.top + 12 + 260 : v));
        let movedB = false;
        if (step.belowTarget) {
          const br = await measureTarget(step.belowTarget);
          if (!cancelled && br && br.width > 0) {
            belowRectForIdxRef.current = index;
            movedB = !near(lastBR, br);
            lastBR = br;
            if (movedB) setBelowRect((prev) => (near(prev, br) ? prev : br));
          }
        }
        stable = moved || movedB ? 0 : stable + 1;
      } else {
        stable = 0; // not measured yet; keep trying
      }
      if (!cancelled && stable < SETTLE) pollTimer = setTimeout(poll, 180);
    };
    poll();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, kbHeight]);

  // Announce to screen readers when the gated final "Done" UNLOCKS. The host enables it via updateStepById
  // at the SAME index, which the per-step announce (keyed on [index]) does not catch, so a VoiceOver user
  // would otherwise get no signal that the action became available.
  const prevCtaDisabledRef = useRef(true);
  useEffect(() => {
    const wasDisabled = prevCtaDisabledRef.current;
    const nowDisabled = !!step?.ctaDisabled;
    prevCtaDisabledRef.current = nowDisabled;
    if (wasDisabled && !nowDisabled && step?.id === "set-first-beacon") {
      AccessibilityInfo.announceForAccessibility("Setup complete. The Done button is now available.");
    }
  }, [step?.ctaDisabled, step?.id]);

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
  // The final "Done" can be gated (e.g. the guided first-beacon step keeps it greyed until the user
  // has a username, a friend, and a set beacon). Only meaningful on the last step.
  const ctaDisabled = isLast && !!step.ctaDisabled;

  // Hole geometry, symmetric padding clamped to the viewport on every axis, so the ring always
  // contains the FULL measured target (never crops the top to satisfy a bottom-overflow clamp).
  // holeBottom/holeRight are floored to hy/hx so an off-screen target can't yield a negative size.
  const xtra = step.holePad ?? 0; // extra padding on all sides (a clear gap from same-color targets)
  const hy = rect ? Math.max(0, rect.y - PAD - xtra - (step.holePadTop ?? 0)) : 0;
  const holeBottom = rect ? Math.max(hy, Math.min(H, rect.y + rect.height + PAD + xtra + (step.holePadBottom ?? 0))) : 0;
  const hh = holeBottom - hy;
  const hx = rect ? Math.max(0, rect.x - PAD - xtra) : 0;
  const holeRight = rect ? Math.max(hx, Math.min(W, rect.x + rect.width + PAD + xtra)) : 0;
  const hw = holeRight - hx;

  // True only once THIS step's target has been measured (not a stale ring kept from the previous step
  // for visual continuity). Position + interaction key off this so nothing ever reads a stale rect.
  const hasFreshHole = !!rect && rectForIdxRef.current === index;
  // Anchor bottom for a 'below' callout: the bottom of `belowTarget` (a shared reference) if set, else
  // this step's own spotlight ring. Null until that rect is freshly measured for this step.
  const belowFresh = !!belowRect && belowRectForIdxRef.current === index;
  const belowAnchorBottom =
    step.placement !== "below"
      ? null
      : step.belowTarget
      ? belowFresh
        ? belowRect!.y + belowRect!.height
        : null
      : hasFreshHole
      ? holeBottom
      : null;

  // Placement: ONE consistent spot the user can rely on. The callout sits at a fixed TOP position
  // (the same place as step 1) whenever it wouldn't cover the highlighted element; when the target
  // sits high enough that a top callout would cover it, it drops to a fixed LOW position just above
  // the tab bar, even if that overlaps the BOTTOM of the target. This stops the box from jumping
  // around between steps, and guarantees the title + Back/Next are always fully on-screen.
  const TOP_LIMIT = insets.top + 12;
  const CARD_PAD = 32; // styles.callout vertical padding (16 + 16)
  // BottomBar is 64 + 8 inset, flush at the screen bottom (the home indicator sits within it), so
  // clearing 72 + a small margin keeps Back/Next just above it, do NOT also add insets.bottom
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
      : step.placement === "top" || step.placement === "below"
      ? false
      : useLowLocked ?? (!!rect && hy < TOP_ZONE);
  let calloutPos: any;
  let calloutMaxH: number;
  if (step.topFrac != null) {
    // Fixed vertical anchor: callout TOP at a fraction of the screen, the same for sibling sub-steps so
    // it doesn't drift with the (differently sized) highlighted block. Grows down, scrolls if too tall.
    const top = Math.round(H * step.topFrac);
    calloutPos = { top, left: 18, right: 18 };
    calloutMaxH = Math.max(120, H - top - lowBottom);
  } else if (step.placement === "below" && belowAnchorBottom != null) {
    // Anchor JUST BELOW the anchor element (the spotlighted target, or a shared `belowTarget`) and grow
    // downward. `belowGap` leaves a peek of what's under it for orientation; the box scrolls if its
    // content is taller than the space left. Gated on a fresh measurement so it never anchors off the
    // previous step's (stale) rect; the callout is hidden until then.
    const top = Math.min(belowAnchorBottom + (step.belowGap ?? 12), H - 220);
    calloutPos = { top, left: 18, right: 18 };
    calloutMaxH = Math.max(120, H - top - 8);
  } else if (useLow && step.growDown) {
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
    // It sits above the target and will only overlap a tall target (e.g. the flame), acceptable.
    calloutMaxH = Math.max(120, bottomLimit - TOP_LIMIT - CARD_PAD);
  }

  // Block the whole screen unless this interactive step already has a FRESH hole to expose, so touches
  // never fall through during the navigate-then-measure window and the stale ring never takes a tap. A
  // "free interaction" step (interactive + no target) shows only a floating callout and blocks nothing,
  // so the user can use the whole screen underneath (e.g. fill in the options sheet).
  const freeStep = !!step.interactive && !step.target;
  const blockAll = !freeStep && !(step.interactive && hasFreshHole);
  const dimPE = step.interactive && hasFreshHole ? "auto" : "none";
  // A 'below' callout is positioned FROM its anchor, so hide it until that fresh measurement lands
  // (rather than letting it flash at a fallback spot and jump into place).
  const calloutHidden = step.placement === "below" && belowAnchorBottom == null;

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
      {step.advanceOnTargetTap && hasFreshHole && (
        <Pressable
          onPress={goNext}
          style={{ position: "absolute", left: hx, top: hy, width: hw, height: hh }}
          accessibilityRole="button"
          accessibilityLabel={`${step.title}. Tap to continue`}
        />
      )}

      {/* Distinct guidance surface: a blue-tinted, elevated card with a primary accent border that
          echoes the spotlight ring, deliberately NOT an app card, so it reads as "the tour talking". */}
      <View
        pointerEvents={calloutHidden ? "none" : "auto"}
        style={[
          styles.callout,
          { backgroundColor: colors.tourSurface, borderColor: colors.tourBorder },
          calloutPos,
          calloutHidden && styles.calloutHidden,
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
          {/* Eyebrow: brand-blue "STEP X OF N" + Skip tour, a small identity cue that this is the tour. */}
          <View style={styles.eyebrowRow}>
            <View style={styles.eyebrow}>
              <Ionicons name="sparkles" size={13} color={colors.primary} />
              <Text style={[styles.eyebrowTxt, { color: colors.primary }]}>
                {`STEP ${step.stepLabel ?? current} OF ${total}`}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={skip} accessibilityRole="button" accessibilityLabel={isReplay ? "Close tour" : "Skip tour"}>
              <Text style={[styles.skipTxt, { color: colors.subtle }]}>{isReplay ? "Close" : "Skip tour"}</Text>
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
            {/* Back shows when there's history OR the step provides a custom backAction (speed-tour step
                1, which returns to the full tour). It reserves NO space when neither applies. */}
            {(canBack || step.backAction) && (
              <Pressable
                onPress={step.backAction ? () => { tap(); step.backAction!(); } : goBack}
                style={styles.btnGhost}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <Text style={[styles.btnGhostTxt, { color: colors.subtle }]}>Back</Text>
              </Pressable>
            )}
            {/* Speed tour stays slim on the LEFT; Next is flex:1 so it fills the rest of the row. */}
            {step.speedTour && (
              <Pressable
                onPress={() => { tap(); step.speedTour!(); }}
                style={[styles.btnSpeed, { backgroundColor: colors.success }]}
                accessibilityRole="button"
                accessibilityLabel="Speed tour, the quick setup path"
              >
                <Text style={styles.btnSpeedTxt}>Speed{"\n"}tour</Text>
              </Pressable>
            )}
            <Pressable
              onPress={ctaDisabled ? undefined : goNext}
              disabled={ctaDisabled}
              style={[styles.btnPrimary, { backgroundColor: ctaDisabled ? colors.border : colors.primary }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: ctaDisabled }}
              accessibilityHint={ctaDisabled ? "Add a username and a friend, and light your beacon, to finish" : undefined}
            >
              <Text style={[styles.btnPrimaryTxt, ctaDisabled && { color: colors.subtle }]}>
                {step.cta ?? (isLast ? "Done" : "Next")}
              </Text>
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
  // Narrow GREEN button (stacked "Speed / tour" text) so it stays slim next to the wide Next button.
  btnSpeed: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  btnSpeedTxt: { color: "#fff", fontSize: 13, fontWeight: "800", textAlign: "center", lineHeight: 15 },
  calloutHidden: { opacity: 0 },
  btnPrimary: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  btnPrimaryTxt: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
