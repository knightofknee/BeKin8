// providers/TourProvider.tsx
// Coach-mark tour orchestration. Screens register "targets" (elements to point at) via
// useTourTarget(key); any screen can startTour(steps). The SpotlightTour overlay is rendered
// here, at the root, so it sits above the navigator AND the tab bar.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { View, BackHandler } from "react-native";
import SpotlightTour, { type Rect, type TourStep } from "../components/tutorial/SpotlightTour";

export type { TourStep } from "../components/tutorial/SpotlightTour";

type TargetRef = React.RefObject<View | null>;

type TourCtx = {
  registerTarget: (key: string, ref: TargetRef | null) => void;
  measureTarget: (key: string) => Promise<Rect | null>;
  startTour: (
    steps: TourStep[],
    opts?: { onFinish?: () => void; onClose?: () => void; startAtTarget?: string; startAtStepId?: string; isReplay?: boolean }
  ) => void;
  /**
   * Replace a SINGLE step (matched by id) in the active tour, splicing the provider's OWN current
   * steps, for live content that changes mid-tour (e.g. the final step's checklist + gated Done).
   * Operating on the provider's own array means a host screen can refresh one live step even after it
   * has remounted mid-tour and lost any local mirror. Same-index swap: no navigation, no runId bump.
   * No-op if no tour is running or no step has that id.
   */
  updateStepById: (id: string, next: TourStep) => void;
  endTour: (finished: boolean) => void;
  /**
   * Jump the active tour to the step whose target matches `key` (e.g. an optional branch).
   * `pushHistory` defaults true; pass false for a branch that should show no Back button.
   */
  goToTarget: (key: string, opts?: { pushHistory?: boolean }) => void;
  /** Advance the active tour to the next step (e.g. a screen reacting to the sheet closing). */
  advance: () => void;
  /** Step the active tour BACK (e.g. the sheet's own Cancel button returning to the previous step). */
  back: () => void;
  /** Swap the active tour to a new step array and restart from the first step (same onFinish/onClose).
   *  Used by the "Speed tour" button to switch the full tour into the short path. */
  restart: (steps: TourStep[]) => void;
  /** `id` of the step currently showing, so screens can react to which step is active. */
  currentStepId?: string;
  /** `target` of the step currently showing, so screens can react to it (e.g. open the sheet). */
  currentStepTarget?: string;
  /** Direction of the LAST navigation: 'back' (onPrev) restores a previously-seen state and should
   *  NOT replay entrance animations; 'forward'/'jump' may animate reveals. */
  navDir: "forward" | "back" | "jump";
  isActive: boolean;
};

const Ctx = createContext<TourCtx>({
  registerTarget: () => {},
  measureTarget: async () => null,
  startTour: () => {},
  updateStepById: () => {},
  endTour: () => {},
  goToTarget: () => {},
  advance: () => {},
  back: () => {},
  restart: () => {},
  currentStepId: undefined,
  currentStepTarget: undefined,
  navDir: "forward",
  isActive: false,
});

export const TourProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const targets = useRef<Map<string, TargetRef>>(new Map());
  const cb = useRef<{ onFinish?: () => void; onClose?: () => void }>({});
  // Stack of step indices actually visited, so Back follows the real path (handles branches).
  const history = useRef<number[]>([]);
  const activeRef = useRef(false);
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  // Bumped on each start/restart so SpotlightTour gets a fresh `key` and REMOUNTS (re-running the first
  // step's onEnter). updateStepById does NOT bump it, so live content swaps never re-navigate.
  const [runId, setRunId] = useState(0);
  // Direction of the last navigation. Hosts read this to RESTORE prior state on Back without replaying
  // entrance animations (e.g. the options sheet snaps open instead of sliding up). 'forward' by default.
  const [navDir, setNavDir] = useState<"forward" | "back" | "jump">("forward");
  // Whether this run is a REPLAY (the tour has ended at least once before). The dismiss button reads
  // "Skip tour" on the first run (you're opting out of onboarding) and "Close" on a replay (you've
  // already seen it, you're just leaving).
  const [isReplay, setIsReplay] = useState(false);

  const registerTarget = useCallback((key: string, ref: TargetRef | null) => {
    if (ref) targets.current.set(key, ref);
    else targets.current.delete(key);
  }, []);

  const measureTarget = useCallback((key: string): Promise<Rect | null> => {
    return new Promise((resolve) => {
      const node = targets.current.get(key)?.current as any;
      if (!node || typeof node.measureInWindow !== "function") {
        resolve(null);
        return;
      }
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        resolve(width || height ? { x, y, width, height } : null);
      });
    });
  }, []);

  const startTour = useCallback(
    (
      s: TourStep[],
      opts?: { onFinish?: () => void; onClose?: () => void; startAtTarget?: string; startAtStepId?: string; isReplay?: boolean }
    ) => {
      if (activeRef.current) return; // a tour is already running, don't clobber it
      activeRef.current = true;
      cb.current = { onFinish: opts?.onFinish, onClose: opts?.onClose };
      history.current = [];
      setNavDir("forward");
      setIsReplay(!!opts?.isReplay);
      setRunId((r) => r + 1);
      // Optionally start mid-flow (e.g. the resume banner jumping to the first incomplete step).
      // History stays empty so Back is hidden until the user moves forward from here.
      let start = 0;
      if (opts?.startAtStepId) {
        // Jump to a step by id (used to land on the final free step, which has no spotlight target).
        const i = s.findIndex((st) => st.id === opts.startAtStepId);
        if (i >= 0) start = i;
        else if (__DEV__) console.warn(`startTour: startAtStepId "${opts.startAtStepId}" not found; starting at 0`);
      } else if (opts?.startAtTarget) {
        const i = s.findIndex((st) => st.target === opts.startAtTarget);
        if (i >= 0) start = i;
        else if (__DEV__) console.warn(`startTour: startAtTarget "${opts.startAtTarget}" not found; starting at 0`);
      }
      setIndex(start);
      setSteps(s);
    },
    []
  );

  // Replace one step by id, operating on the provider's own current steps (which survive a host
  // remount). Same-index swap: no navigation, no runId bump.
  const updateStepById = useCallback((id: string, next: TourStep) => {
    if (!activeRef.current) return;
    setSteps((cur) => {
      if (!cur) return cur;
      const idx = cur.findIndex((st) => st.id === id);
      if (idx < 0) return cur;
      const copy = cur.slice();
      copy[idx] = next;
      return copy;
    });
  }, []);

  // Swap the running tour to a new step array and restart from the first step (clears history), keeping
  // the same onFinish/onClose. Bumps runId so SpotlightTour remounts and the new first step's onEnter
  // runs. Used by the "Speed tour" button to switch the full tour into the short path.
  const restart = useCallback((s: TourStep[]) => {
    if (!activeRef.current) return;
    history.current = [];
    setNavDir("forward");
    setIndex(0);
    setSteps(s);
    setRunId((r) => r + 1);
  }, []);

  const endTour = useCallback((finished: boolean) => {
    if (!activeRef.current) return; // idempotent: a double end (Next-past-last twice, or Next then Skip) is a no-op
    activeRef.current = false;
    setSteps(null);
    history.current = [];
    setIndex(0);
    if (finished) cb.current.onFinish?.();
    cb.current.onClose?.();
    cb.current = {};
  }, []);

  const onNext = useCallback(() => {
    setNavDir("forward");
    setIndex((i) => {
      if (!steps) return i;
      const cur = steps[i];
      let next: number;
      if (cur?.nextTarget) {
        const ni = steps.findIndex((s) => s.target === cur.nextTarget);
        next = ni >= 0 ? ni : i + 1;
      } else {
        next = i + 1;
      }
      if (next > steps.length - 1) {
        // Past the last step → finish (deferred out of the state updater).
        setTimeout(() => endTour(true), 0);
        return i;
      }
      history.current.push(i); // remember where we came from, for Back
      return next;
    });
  }, [steps, endTour]);

  // Back follows the visited path (not index-1), so it always returns to the step/screen that
  // actually came before, including across optional branches.
  const onPrev = useCallback(() => {
    setNavDir("back");
    setIndex((i) => {
      const prev = history.current.pop();
      return prev !== undefined ? prev : i;
    });
  }, []);

  const onSkip = useCallback(() => endTour(false), [endTour]);

  // Android hardware back: while a tour is up, map Back to the tour's OWN Back (step back through the
  // visited path) when there is history, else dismiss the tour. Returning true stops the OS from popping
  // the screen under the overlay or exiting the app. Registered only while a tour is running.
  useEffect(() => {
    if (!steps) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (history.current.length > 0) onPrev();
      else onSkip();
      return true;
    });
    return () => sub.remove();
  }, [steps, onPrev, onSkip]);

  const goToTarget = useCallback(
    (key: string, opts?: { pushHistory?: boolean }) => {
      setNavDir("jump");
      setIndex((i) => {
        if (!steps) return i;
        const ni = steps.findIndex((s) => s.target === key);
        if (ni < 0 || ni === i) return i;
        // A normal jump is part of the path (Back returns here); a branch entered with
        // pushHistory:false leaves history untouched so the branch shows no Back button.
        if (opts?.pushHistory !== false) history.current.push(i);
        return ni;
      });
    },
    [steps]
  );

  const currentStepId = steps?.[index]?.id;
  const currentStepTarget = steps?.[index]?.target;
  // Interactive steps let the user touch/edit the highlighted element, so the app subtree must stay
  // reachable by VoiceOver/TalkBack on those (see the app-hide wrapper below).
  const currentStepInteractive = !!steps?.[index]?.interactive;

  return (
    <Ctx.Provider
      value={{
        registerTarget,
        measureTarget,
        startTour,
        updateStepById,
        endTour,
        goToTarget,
        advance: onNext,
        back: onPrev,
        restart,
        currentStepId,
        currentStepTarget,
        navDir,
        isActive: !!steps,
      }}
    >
      {/* Hide the app from assistive tech on NON-interactive steps so VoiceOver focus stays in the
          coach-mark callout (which is accessibilityViewIsModal). On interactive steps the app subtree
          stays reachable, so screen-reader users can touch/edit the highlighted element and complete
          the gated Done. */}
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={!!steps && !currentStepInteractive}
        importantForAccessibility={steps && !currentStepInteractive ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {steps && (
        <SpotlightTour
          key={runId}
          steps={steps}
          index={index}
          canBack={history.current.length > 0}
          measureTarget={measureTarget}
          onNext={onNext}
          onPrev={onPrev}
          onSkip={onSkip}
          isReplay={isReplay}
        />
      )}
    </Ctx.Provider>
  );
};

export const useTour = () => useContext(Ctx);

/** Attach the returned ref to a View/Pressable to make it a spotlight target. */
export function useTourTarget(key: string) {
  const { registerTarget } = useTour();
  const ref = useRef<View | null>(null);
  useEffect(() => {
    registerTarget(key, ref);
    return () => registerTarget(key, null);
  }, [key, registerTarget]);
  return ref;
}
