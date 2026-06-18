// providers/TourProvider.tsx
// Coach-mark tour orchestration. Screens register "targets" (elements to point at) via
// useTourTarget(key); any screen can startTour(steps). The SpotlightTour overlay is rendered
// here, at the root, so it sits above the navigator AND the tab bar.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import SpotlightTour, { type Rect, type TourStep } from "../components/tutorial/SpotlightTour";

export type { TourStep } from "../components/tutorial/SpotlightTour";

type TargetRef = React.RefObject<View | null>;

type TourCtx = {
  registerTarget: (key: string, ref: TargetRef | null) => void;
  measureTarget: (key: string) => Promise<Rect | null>;
  startTour: (
    steps: TourStep[],
    opts?: { onFinish?: () => void; onClose?: () => void; startAtTarget?: string }
  ) => void;
  endTour: (finished: boolean) => void;
  /** Jump the active tour to the step whose target matches `key` (e.g. an optional branch). */
  goToTarget: (key: string) => void;
  /** Advance the active tour to the next step (e.g. a screen reacting to the sheet closing). */
  advance: () => void;
  /** `id` of the step currently showing, so screens can react to which step is active. */
  currentStepId?: string;
  isActive: boolean;
};

const Ctx = createContext<TourCtx>({
  registerTarget: () => {},
  measureTarget: async () => null,
  startTour: () => {},
  endTour: () => {},
  goToTarget: () => {},
  advance: () => {},
  currentStepId: undefined,
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
      opts?: { onFinish?: () => void; onClose?: () => void; startAtTarget?: string }
    ) => {
      if (activeRef.current) return; // a tour is already running — don't clobber it
      activeRef.current = true;
      cb.current = { onFinish: opts?.onFinish, onClose: opts?.onClose };
      history.current = [];
      // Optionally start mid-flow (e.g. the resume banner jumping to the first incomplete step).
      // History stays empty so Back is hidden until the user moves forward from here.
      let start = 0;
      if (opts?.startAtTarget) {
        const i = s.findIndex((st) => st.target === opts.startAtTarget);
        if (i >= 0) start = i;
        else if (__DEV__) console.warn(`startTour: startAtTarget "${opts.startAtTarget}" not found; starting at 0`);
      }
      setIndex(start);
      setSteps(s);
    },
    []
  );

  const endTour = useCallback((finished: boolean) => {
    activeRef.current = false;
    setSteps(null);
    history.current = [];
    setIndex(0);
    if (finished) cb.current.onFinish?.();
    cb.current.onClose?.();
    cb.current = {};
  }, []);

  const onNext = useCallback(() => {
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
  // actually came before — including across optional branches.
  const onPrev = useCallback(() => {
    setIndex((i) => {
      const prev = history.current.pop();
      return prev !== undefined ? prev : i;
    });
  }, []);

  const onSkip = useCallback(() => endTour(false), [endTour]);

  const goToTarget = useCallback(
    (key: string) => {
      setIndex((i) => {
        if (!steps) return i;
        const ni = steps.findIndex((s) => s.target === key);
        if (ni < 0 || ni === i) return i;
        history.current.push(i); // a jump (e.g. entering a branch) is part of the path
        return ni;
      });
    },
    [steps]
  );

  const currentStepId = steps?.[index]?.id;

  return (
    <Ctx.Provider
      value={{
        registerTarget,
        measureTarget,
        startTour,
        endTour,
        goToTarget,
        advance: onNext,
        currentStepId,
        isActive: !!steps,
      }}
    >
      {/* Hide the whole app from assistive tech while a tour is active so VoiceOver focus stays
          in the coach-mark callout (which is accessibilityViewIsModal). */}
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={!!steps}
        importantForAccessibility={steps ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {steps && (
        <SpotlightTour
          steps={steps}
          index={index}
          canBack={history.current.length > 0}
          measureTarget={measureTarget}
          onNext={onNext}
          onPrev={onPrev}
          onSkip={onSkip}
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
