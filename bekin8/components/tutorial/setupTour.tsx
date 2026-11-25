// components/tutorial/setupTour.tsx
// The onboarding flow, built around the setup bar (TutorialResumeBanner):
//
//   WELCOME (Home only, auto-shown once, replayed by the ? button)
//     1. "This is your beacon"  tap it for a PRACTICE light (local only, nothing is written)
//     2. "Plan it out"          points at Beacon options
//   SETUP (one step per unfinished item; also what the setup bar starts, from any screen)
//     add a friend -> notifications
//     (A username is assigned automatically at signup, see lib/autoUsername, so "pick a username"
//     only ever shows if that assignment failed, e.g. the first launch was offline.)
//     Each step is the real control under a spotlight. Doing the thing completes the step on its
//     own: the callout flips to a check + "Next up", a success haptic fires, and it moves on.
//     "Skip for now" moves past it; "Later" closes the tour and the bar keeps what's left.
//   FINALE  "You're all set" (or "Nice start" + the bar takes it from here)
//
// SetupTourDriver (mounted once at the root) does the auto-complete + the finale's live copy, so it
// works no matter which screen is showing.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../providers/ThemeProvider";
import { useAuth } from "../../providers/AuthProvider";
import { useOnboarding, type OnboardingStepKey } from "../../providers/OnboardingProvider";
import { useTour, type TourStep } from "../../providers/TourProvider";
import { getBeaconSkinId, onBeaconSkinChange } from "../../lib/beaconSkinPref";
import { getSkin } from "../../lib/beaconSkins";
import { ensureNotifyPermission, emitNotifyPermissionChange, onNotifyPermissionChange } from "../../lib/notifyPermission";
import { syncPushTokenIfGranted } from "../../lib/push";
import { enableDefaultNotifyFlags } from "../../lib/rsvp";
import { addBrianAsFriend } from "../../lib/addBrian";
import { shareMyFriendLink } from "../../lib/shareInvite";
import { track } from "../../lib/analytics";
import { setSeen } from "../../lib/tutorialFlags";
import { success, tap } from "../../utils/haptics";

// ---------- ids ----------

export const WELCOME_BEACON_ID = "welcome-beacon";
const FINALE_ID = "setup-finale";

type Mission = { id: string; key: OnboardingStepKey; n: number; doneLabel: string; nextLabel: string };
const MISSIONS: Mission[] = [
  { id: "setup-username", key: "username", n: 1, doneLabel: "Username saved", nextLabel: "Pick a username" },
  { id: "setup-friend", key: "friend", n: 2, doneLabel: "You've got a friend 🎉", nextLabel: "Add a friend" },
  { id: "setup-notifications", key: "notifications", n: 3, doneLabel: "Notifications are on", nextLabel: "Turn on notifications" },
];

const goFriends = () => router.navigate("/friends");
const goHome = () => router.navigate("/home");

// ---------- shared bits ----------

// "Next up: …" line under a finished step: the next unfinished item, or the wrap-up.
function DoneBody({ after }: { after: OnboardingStepKey }) {
  const { colors } = useTheme();
  const { steps } = useOnboarding();
  const order = MISSIONS.map((m) => m.key);
  const nextKey = order.slice(order.indexOf(after) + 1).find((k) => !steps.find((s) => s.key === k)?.done);
  const next = MISSIONS.find((m) => m.key === nextKey);
  const notifsOn = useNotifsGranted();
  return (
    <View style={s.doneRow}>
      <Ionicons name="checkmark-circle" size={26} color={colors.success} />
      <Text style={[s.body, { color: colors.text, flex: 1 }]}>
        {after === "notifications" && !notifsOn
          ? "You can turn them on anytime in Settings."
          : next
          ? `Next up: ${next.nextLabel.toLowerCase()}.`
          : "That's everything on the list."}
      </Text>
    </View>
  );
}

// ---------- welcome ----------

// "Tap the {noun}" tracks the CURRENT skin (the noun differs per skin: pyre, lighthouse, lanterns…).
function TapNounBody({ initialNoun }: { initialNoun: string }) {
  const { colors } = useTheme();
  const [noun, setNoun] = useState(initialNoun);
  useEffect(() => {
    let mounted = true;
    getBeaconSkinId().then((id) => mounted && setNoun(getSkin(id).tap.noun));
    const off = onBeaconSkinChange((id) => setNoun(getSkin(id).tap.noun));
    return () => { mounted = false; off(); };
  }, []);
  return (
    <Text style={[s.body, { color: colors.text }]}>
      Light it when you&apos;re free to hang out, and your friends see it. Tap the {noun} to try it. Just
      practice, so nobody gets pinged.
    </Text>
  );
}

export type WelcomeBeaconCtx = {
  tapNoun: string;
  /** Spotlight headroom above the structure for the current skin's flame (computed by Home). */
  holePadTop: number;
  /** The user's REAL beacon is lit right now (a replay): describe it instead of inviting a tap. */
  alreadyLit: boolean;
};

/** Step 1, live: Home swaps in the `practiceLit` variant when the practice light happens. */
export function makeWelcomeBeaconStep(ctx: WelcomeBeaconCtx, practiceLit: boolean): TourStep {
  const base: TourStep = {
    id: WELCOME_BEACON_ID,
    target: "beacon-logs",
    eyebrow: "WELCOME",
    title: "This is your beacon",
    body: "",
    placement: "top",
    holePadTop: ctx.holePadTop,
    holePadBottom: -16,
    onEnter: goHome,
  };
  if (ctx.alreadyLit) {
    return {
      ...base,
      body: "Yours is lit right now, so your friends can see you're free and jump in. Tap it again whenever you want to put it out.",
    };
  }
  if (practiceLit) {
    return {
      ...base,
      title: "It's lit! 🔥",
      body: "That's BeKin. When your beacon is lit, friends know you're free and can say they're in. This one was practice, so it goes out when you move on.",
      interactive: true,
    };
  }
  return {
    ...base,
    body: <TapNounBody initialNoun={ctx.tapNoun} />,
    interactive: true,
    // Soft Next: the fun move here is tapping the beacon, not the button.
    ctaVariant: "tonal",
  };
}

function makeWelcomeOptionsStep(isLast: boolean): TourStep {
  return {
    id: "welcome-options",
    target: "beacon-options-cta",
    eyebrow: "WELCOME",
    title: "Plan it out",
    body: "Beacon options is where you pick a day and time, choose which friends see it, add a note, and give your beacon its own look.",
    cta: isLast ? "Done" : "Next",
    onEnter: goHome,
  };
}

// ---------- setup steps ----------

function FriendStepBody() {
  const { colors } = useTheme();
  const { user, profile } = useAuth();
  const hasUsername = !!profile?.username?.trim();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const share = async () => {
    if (sharing || !user?.uid) return;
    tap();
    setErr(null);
    setSharing(true);
    const res = await shareMyFriendLink(user.uid, null, "tour");
    setSharing(false);
    if (res === "no-code") setErr("Couldn't get your link. Check your connection and try again.");
  };
  const addBrian = async () => {
    if (busy) return;
    tap();
    setErr(null);
    setBusy(true);
    const res = await addBrianAsFriend();
    setBusy(false);
    if (!res.ok && res.error !== "SELF") {
      setErr(res.error === "BLOCKED" ? "You've blocked Brian. Unblock him first." : "Couldn't add Brian. Try again in a sec.");
    }
    // Success needs no handling here: the friend lands, the setup state flips, and the step celebrates.
  };
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        {hasUsername
          ? "Send your friend link to someone you'd actually hang out with. When they tap it, you're connected, even if they're new to BeKin."
          : "You'll need a username first, so pick one at the top. Then share your friend link."}
      </Text>
      {/* Sharing with a real friend is the point; it comes first. */}
      <Pressable
        onPress={share}
        disabled={!hasUsername || sharing}
        style={({ pressed }) => [
          s.actionBtn,
          { backgroundColor: colors.primary },
          (!hasUsername || sharing) && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Share your friend link"
      >
        {sharing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="share-outline" size={18} color="#fff" />
            <Text style={[s.actionTxt, { color: "#fff" }]}>Share</Text>
          </>
        )}
      </Pressable>
      {/* Brian is the extra: someone to see content from while nobody else is here yet. */}
      <Pressable
        onPress={addBrian}
        disabled={!hasUsername || busy}
        style={({ pressed }) => [s.quietBtn, (!hasUsername || busy) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel="Add Brian, the creator of BeKin, as a friend"
      >
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={[s.quietTxt, { color: colors.subtle }]}>
            Nobody around yet? <Text style={{ color: colors.primary, fontWeight: "700" }}>Add Brian, BeKin&apos;s creator</Text>
          </Text>
        )}
      </Pressable>
      {err ? <Text style={[s.note, { color: colors.error }]}>{err}</Text> : null}
    </View>
  );
}

// The OS prompt straight from the button the user just tapped (no extra "are you sure" alert). A
// permanently denied permission falls back to ensureNotifyPermission's open-Settings path.
async function turnOnNotifications(): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
      if (granted) {
        try { await syncPushTokenIfGranted(); } catch { /* ignore */ }
      }
      track("notif_permission", { granted, source: "tour" });
      emitNotifyPermissionChange(); // a denial also resolves the step (it can't be asked again)
    } else if (!granted) {
      granted = await ensureNotifyPermission();
    }
    if (granted) await enableDefaultNotifyFlags();
  } catch {
    // best effort; Settings has the toggles
  }
}

function useNotifsGranted(): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    let mounted = true;
    const check = () => Notifications.getPermissionsAsync().then((p) => mounted && setGranted(!!p.granted)).catch(() => {});
    check();
    const off = onNotifyPermissionChange(check);
    return () => { mounted = false; off(); };
  }, []);
  return granted;
}

function NotifStepBody() {
  const { colors } = useTheme();
  const granted = useNotifsGranted();
  const [busy, setBusy] = useState(false);
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        BeKin only pings you when a friend lights a beacon. Everything else stays off unless you turn it
        on in Settings, and you can mute any friend.
      </Text>
      {granted ? null : (
        <Pressable
          onPress={async () => {
            if (busy) return;
            tap();
            setBusy(true);
            await turnOnNotifications();
            setBusy(false);
          }}
          style={({ pressed }) => [s.actionBtn, { backgroundColor: colors.success }, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Turn on notifications"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="notifications" size={18} color="#fff" />
              <Text style={[s.actionTxt, { color: "#fff" }]}>Turn on notifications</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

// Where each mission sits among the ones actually being shown this run ("SETUP · 1 OF 2"), set
// when the steps are built so the live done-state swap (SetupTourDriver) keeps the same numbering.
const shownAt = new Map<string, { pos: number; total: number }>();

function makeMissionStep(m: Mission, done: boolean): TourStep {
  const at = shownAt.get(m.id);
  const eyebrow = at && at.total > 1 ? `SETUP · ${at.pos} OF ${at.total}` : "SETUP";
  const common = { id: m.id, eyebrow, hideBack: true } as const;
  const where: Partial<TourStep> =
    m.key === "username"
      ? { target: "friends-username", placement: "below", belowGap: 10, interactive: true, onEnter: goFriends }
      : m.key === "friend"
      ? { target: "friends-add-card", placement: "below", belowGap: 10, interactive: true, onEnter: goFriends }
      : { placement: "center" };
  if (done) {
    return { ...common, ...where, title: m.doneLabel, body: <DoneBody after={m.key} />, cta: "Next" };
  }
  const copy =
    m.key === "username"
      ? { title: "Pick a username", body: "It's how friends find and add you. Type one, then tap Save." as React.ReactNode }
      : m.key === "friend"
      ? { title: "Add a friend", body: <FriendStepBody /> }
      : { title: "Know when friends light up", body: <NotifStepBody /> };
  return { ...common, ...where, ...copy, cta: "Skip for now", ctaVariant: "tonal" };
}

// ---------- finale ----------

function FinaleBody({ allDone }: { allDone: boolean }) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={[s.finaleIcon, { backgroundColor: (allDone ? colors.success : colors.primary) + "22" }]}>
        <Ionicons name={allDone ? "flame" : "rocket-outline"} size={34} color={allDone ? colors.success : colors.primary} />
      </View>
      <Text style={[s.body, { color: colors.text, textAlign: "center" }]}>
        {allDone
          ? "Light your beacon whenever you're free. Your friends will see it and can jump in."
          : "Whatever's left waits in the bar at the top of Home. Tap it anytime to pick up where you left off."}
      </Text>
    </View>
  );
}

function makeFinaleStep(allDone: boolean): TourStep {
  return {
    id: FINALE_ID,
    eyebrow: allDone ? "ALL SET" : "SETUP",
    title: allDone ? "You're all set! 🎉" : "Nice start",
    body: <FinaleBody allDone={allDone} />,
    placement: "center",
    cta: allDone ? "Done" : "Got it",
    hideBack: true,
    hideDismiss: true,
    titleCenter: true,
    onEnter: goHome,
  };
}

// ---------- starting it ----------

type StartOpts = { onClose?: () => void };

export function useSetupTour() {
  const { startTour } = useTour();
  const onboarding = useOnboarding();
  const missing = MISSIONS.filter((m) => !onboarding.steps.find((st) => st.key === m.key)?.done);

  const setupSteps = (): TourStep[] => {
    shownAt.clear();
    missing.forEach((m, i) => shownAt.set(m.id, { pos: i + 1, total: missing.length }));
    return [...missing.map((m) => makeMissionStep(m, false)), makeFinaleStep(false)];
  };
  const handlers = (opts?: StartOpts) => ({
    onFinish: () => {
      success();
      setSeen("beacon");
      track("tutorial_complete");
    },
    onClose: () => {
      setSeen("beacon_intro");
      setSeen("first_tour_done");
      opts?.onClose?.();
    },
  });

  /** From the setup bar (any screen): straight into the first unfinished item. */
  const startSetup = useCallback(
    (opts?: StartOpts) => {
      if (!missing.length) return;
      startTour(setupSteps(), { dismissLabel: "Later", ...handlers(opts) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startTour, missing.map((m) => m.key).join("|")]
  );

  /** First launch (auto) and the ? button: the welcome beats, then setup if anything's left. */
  const startWelcome = useCallback(
    (ctx: WelcomeBeaconCtx & StartOpts & { isReplay?: boolean }) => {
      const steps: TourStep[] = [makeWelcomeBeaconStep(ctx, false), makeWelcomeOptionsStep(missing.length === 0)];
      // Straight from the welcome beats into the first unfinished item: no checklist screen in between.
      if (missing.length) steps.push(...setupSteps());
      if (!ctx.isReplay) track("tutorial_begin");
      startTour(steps, {
        isReplay: ctx.isReplay,
        dismissLabel: missing.length ? "Later" : ctx.isReplay ? "Close" : "Skip",
        ...handlers(ctx),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startTour, missing.map((m) => m.key).join("|")]
  );

  return { startSetup, startWelcome };
}

// ---------- driver ----------

/**
 * Mounted once at the root (inside Tour + Onboarding providers). While a setup step is showing and
 * its item becomes done (a username saved, a friend added, permission granted), flips the step to
 * its "done" state with a success haptic and advances after a short beat. Also keeps the finale's
 * copy honest as items complete.
 */
export function SetupTourDriver() {
  const { isActive, currentStepId, updateStepById, advanceFromStepId } = useTour();
  const { steps, allDone } = useOnboarding();
  const celebrated = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isActive) return;
    celebrated.current.clear();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [isActive]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const doneSig = steps.map((st) => (st.done ? 1 : 0)).join("");
  useEffect(() => {
    if (!isActive || !currentStepId) return;
    const m = MISSIONS.find((x) => x.id === currentStepId);
    if (!m || celebrated.current.has(m.id)) return;
    if (!steps.find((st) => st.key === m.key)?.done) return;
    celebrated.current.add(m.id);
    const celebrate = (title?: string) => {
      const done = makeMissionStep(m, true);
      updateStepById(m.id, title ? { ...done, title } : done);
      success();
      if (timer.current) clearTimeout(timer.current);
      // advanceFromStepId is a no-op if the user already tapped Next.
      timer.current = setTimeout(() => advanceFromStepId(m.id), 1500);
    };
    if (m.key !== "notifications") {
      celebrate();
    } else {
      // "Done" for notifications also covers a refusal (iOS can't ask twice), so don't claim they're on.
      Notifications.getPermissionsAsync()
        .then((p) => celebrate(p.granted ? undefined : "No problem"))
        .catch(() => celebrate());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentStepId, doneSig]);

  useEffect(() => {
    if (isActive) updateStepById(FINALE_ID, makeFinaleStep(allDone));
  }, [isActive, allDone, updateStepById]);

  return null;
}

const s = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 13, lineHeight: 18, marginTop: 12 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  actionBtn: {
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 46,
  },
  actionTxt: { fontSize: 15, fontWeight: "700" },
  quietBtn: { marginTop: 10, minHeight: 36, alignItems: "center", justifyContent: "center" },
  quietTxt: { fontSize: 14, textAlign: "center" },
  finaleIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },
});
