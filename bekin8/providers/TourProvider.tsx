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
    opts?: { onFinish?: () => void; onClose?: () => void; startAtTarget?: string; startAtStepId?: string; isReplay?: boolean; dismissLabel?: string }
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
  /** Advance the active tour to the next step (e.g. a screen reacting to the sheet closing). */
  advance: () => void;
  /**
   * Advance ONLY if the step with this id is still the current one; otherwise a no-op. Use from
   * screen effects that can fire more than once (e.g. during a navigation both the outgoing and
   * incoming screen instance may react) so duplicates can't step past the intended target. Never
   * finishes the tour: advancing past the last step is ignored.
   */
  advanceFromStepId: (id: string) => void;
  /** Step the active tour BACK (e.g. the sheet's own Cancel button returning to the previous step). */
  back: () => void;
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
  advance: () => {},
  advanceFromStepId: () => {},
  back: () => {},
  currentStepId: undefined,
  currentStepTarget: undefined,
  navDir: "forward",
  isActive: false,
});

export const TourProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const targets = useRef<Map<string, TargetRef>>(new Map());
  // The overlay is drawn inside this provider's root view, so targets are measured RELATIVE to it.
  // On native the root is the whole window (offset 0,0, same size); on the web build the app sits in
  // a centered phone-width column, so window coordinates would put the spotlight in the wrong place.
  const rootRef = useRef<View | null>(null);
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
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
  const [dismissLabel, setDismissLabel] = useState<string | undefined>(undefined);

  const registerTarget = useCallback((key: string, ref: TargetRef | null) => {
    if (ref) targets.current.set(key, ref);
    else targets.current.delete(key);
  }, []);

  const measureTarget = useCallback((key: string): Promise<Rect | null> => {
    const inWindow = (node: any) =>
      new Promise<Rect | null>((resolve) => {
        if (!node || typeof node.measureInWindow !== "function") return resolve(null);
        node.measureInWindow((x: number, y: number, width: number, height: number) =>
          resolve(width || height ? { x, y, width, height } : null)
        );
      });
    return Promise.all([inWindow(targets.current.get(key)?.current), inWindow(rootRef.current)]).then(([r, root]) =>
      r && root ? { ...r, x: r.x - root.x, y: r.y - root.y } : r
    );
  }, []);

  const startTour = useCallback(
    (
      s: TourStep[],
      opts?: { onFinish?: () => void; onClose?: () => void; startAtTarget?: string; startAtStepId?: string; isReplay?: boolean; dismissLabel?: string }
    ) => {
      if (activeRef.current) return; // a tour is already running, don't clobber it
      activeRef.current = true;
      cb.current = { onFinish: opts?.onFinish, onClose: opts?.onClose };
      history.current = [];
      setNavDir("forward");
      setIsReplay(!!opts?.isReplay);
      setDismissLabel(opts?.dismissLabel);
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
      const next = i + 1;
      if (next > steps.length - 1) {
        // Past the last step → finish (deferred out of the state updater).
        setTimeout(() => endTour(true), 0);
        return i;
      }
      history.current.push(i); // remember where we came from, for Back
      return next;
    });
  }, [steps, endTour]);

  // Guarded advance: moves forward only while the NAMED step is still current, so duplicate calls
  // (two mounted screen instances during a navigation both reacting to the same state) collapse to
  // one advance instead of stepping past the target and accidentally finishing the tour.
  const advanceFromStepId = useCallback((id: string) => {
    setNavDir("forward");
    setIndex((i) => {
      if (!steps || steps[i]?.id !== id) return i; // someone already advanced (or wrong step): no-op
      const next = i + 1;
      if (next > steps.length - 1) return i; // never implicitly finish
      history.current.push(i);
      return next;
    });
  }, [steps]);

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
        advance: onNext,
        advanceFromStepId,
        back: onPrev,
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
        ref={rootRef}
        collapsable={false}
        style={{ flex: 1 }}
        onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
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
          dismissLabel={dismissLabel}
          frame={frame}
        />
      )}
      </View>
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
