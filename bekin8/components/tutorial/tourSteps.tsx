// components/tutorial/tourSteps.tsx
// Step content for the coach-mark tours. Targets reference keys registered via useTourTarget()
// across Home, the options sheet, Friends, the Post screen, and Settings. Steps marked
// `interactive` let the user touch/edit the highlighted element without ending the tour.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../providers/ThemeProvider";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { getBeaconSkinId, onBeaconSkinChange } from "../../lib/beaconSkinPref";
import { getSkin } from "../../lib/beaconSkins";
import { onNotifyPermissionChange } from "../../lib/notifyPermission";
import type { TourStep } from "./SpotlightTour";

// Live OS notification-permission state for the tour's enable buttons: checked on mount and
// re-checked whenever the app-wide permission pub/sub fires (ensureNotifyPermission emits on grant).
function useBeaconNotifsGranted(): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    const check = () =>
      Notifications.getPermissionsAsync()
        .then((p) => { if (mounted) setGranted(!!p.granted); })
        .catch(() => {});
    check();
    const off = onNotifyPermissionChange(check);
    return () => { mounted = false; off(); };
  }, []);
  return granted;
}

// The enable button, permission-aware: already granted (or just granted) flips it to a congrats
// state instead of offering a button that would do nothing.
function NotifEnableAction({ onEnable }: { onEnable: () => void }) {
  const { colors } = useTheme();
  const granted = useBeaconNotifsGranted();
  if (granted) {
    return (
      <View style={[s.enableBtn, s.enableDone, { borderColor: colors.success }]}>
        <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        <Text style={[s.enableTxt, { color: colors.success }]}>Beacon notifications are on 🎉</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onEnable}
      style={[s.enableBtn, { backgroundColor: colors.success, flexDirection: "row", justifyContent: "center", gap: 8 }]}
      accessibilityRole="button"
      accessibilityLabel="Turn on beacon notifications"
    >
      <Ionicons name="notifications" size={18} color="#fff" />
      <Text style={[s.enableTxt, { color: "#fff" }]}>Turn on beacon notifications</Text>
    </Pressable>
  );
}

// ---------- Beacon tour (Home + sheet + Friends) ----------

export type BeaconTourCtx = {
  openSheet: () => void;
  closeSheet: () => void;
  goFriends: () => void;
  goHome: () => void;
  goSettings: () => void;
  /** Open the options sheet pre-filled for a guided first beacon (today + intro message). */
  openFirstBeacon: () => void;
  /** True once the user has ≥1 friend, drops the "Add Brian" step (its card only shows at 0). */
  hasFriends: boolean;
  /** The current skin's tappable noun ("logs" / "lighthouse" / "lanterns" / …) for step 1's copy.
   * Used only as the initial value: TapNounBody tracks live skin switches during the tour. */
  tapNoun: string;
  /** Spotlight headroom above the 180px structure box, sized to the current skin's flame height
   * (the fixed 70 clipped Old Guard / Bonfire flames with a hard dim edge). Built-time like the
   * rest of the step geometry; a mid-tour skin switch keeps it until the tour is rebuilt. */
  holePadTop: number;
  /** Live setup state for the final-step checklist + gated Done (host refreshes via updateStepById). */
  usernameDone: boolean;
  friendDone: boolean;
  /** True if the user's beacon is currently LIT / active (NOT merely a stale planned one) at build
   * time. With username + friend this makes the final step start on the celebratory wrap-up. */
  beaconLit: boolean;
  /** Whether the device is online, the "Add Brian" card is replaced by an offline notice when not. */
  online: boolean;
  onEnableNotifications: () => void;
  /** Switch the full tour into the short "speed tour" (username, friend, light a beacon). */
  onSpeedTour: () => void;
  /** From speed-tour step 1, return to the full tour's step 1 (the Back button). */
  onExitSpeedTour: () => void;
};

function NotifTourBody({ onEnable }: { onEnable: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        BeKin only notifies you when a friend lights a beacon. Everything else starts off; these
        switches add more if you want it.
      </Text>
      <NotifEnableAction onEnable={onEnable} />
    </View>
  );
}

// One row of the final-step to-do list. Done → a filled check, greyed + struck through.
function TodoItem({ done, label }: { done: boolean; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={s.todoRow}>
      <Ionicons
        name={done ? "checkmark-circle" : "ellipse-outline"}
        size={20}
        color={done ? colors.primary : colors.subtle}
      />
      <Text style={[s.todoTxt, { color: done ? colors.subtle : colors.text }, done && s.todoDone]}>{label}</Text>
    </View>
  );
}

// Body for the guided first-beacon step: explains the "test" group, the Tweak line, and a live
// to-do list (add username / add a friend) that strikes through as each is completed.
function FirstBeaconBody({ usernameDone, friendDone, beaconLit }: { usernameDone: boolean; friendDone: boolean; beaconLit: boolean }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        This is set to your <Text style={{ fontWeight: "800" }}>test</Text> group, so you can light beacons
        here to try things out without notifying anyone. Give it a try.
      </Text>
      <Text style={[s.body, { color: colors.text, marginTop: 8 }]}>
        Tweak the day, time, or who can see it in Beacon options. Finish these three to wrap up:
      </Text>
      <View style={s.todoList}>
        <TodoItem done={usernameDone} label="Add a username" />
        <TodoItem done={friendDone} label="Add a friend" />
        <TodoItem done={beaconLit} label="Light your beacon" />
      </View>
    </View>
  );
}

// Completion body: the wrap-up copy with the full checklist shown checked off, so finishing
// reads as an accomplishment rather than the list silently vanishing.
function FirstBeaconDoneBody() {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        That&apos;s everything, your setup is complete. Friends can see your beacon whenever it&apos;s lit,
        so they know when you&apos;re free to hang out. Tap Done to finish.
      </Text>
      <View style={s.todoList}>
        <TodoItem done label="Add a username" />
        <TodoItem done label="Add a friend" />
        <TodoItem done label="Light your beacon" />
      </View>
    </View>
  );
}

// Full tour's username step: same required-to-advance gate as the speed tour (home re-renders it
// live via updateStepById as the username lands).
export function makeFullUsernameStep(ctx: BeaconTourCtx, usernameDone: boolean): TourStep {
  const friends = () => { ctx.closeSheet(); ctx.goFriends(); };
  return {
    id: "full-username",
    target: "friends-username",
    title: "Pick your username",
    body: "A username is required to uniquely identify you. It can be used to add friends. You can also set a display name in the next step.",
    interactive: true,
    // Sit the callout just below the "send a friend request" field (shared anchor) so it's high and
    // at the SAME height as the next step, with that field still barely visible above the box.
    placement: "below",
    belowTarget: "friends-add",
    belowGap: 6,
    ctaDisabled: !usernameDone,
    ctaDisabledNote: "Save a username to continue.",
    onEnter: friends,
  };
}

// Live "tap the {noun}" body. The interactive 'beacon-style' step invites mid-tour skin switches
// and Back can land on the light step again afterward, so the noun must track the CURRENT skin,
// not the one captured when the steps were built.
function TapNounBody({ initialNoun, template }: { initialNoun: string; template: (noun: string) => string }) {
  const { colors } = useTheme();
  const [noun, setNoun] = useState(initialNoun);
  useEffect(() => {
    let mounted = true;
    getBeaconSkinId().then((id) => mounted && setNoun(getSkin(id).tap.noun)); // re-sync if it changed since build
    const off = onBeaconSkinChange((id) => setNoun(getSkin(id).tap.noun));
    return () => { mounted = false; off(); };
  }, []);
  return <Text style={[s.body, { color: colors.text }]}>{template(noun)}</Text>;
}

// Body for the FULL tour's first step: SHORT, so the callout never buries the beacon it spotlights.
// Lighting is practiced for real on the final step, so this is just the intro + the quick-setup choice.
function LightBeaconBody({ onSpeedTour }: { onSpeedTour: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        A lit beacon tells friends you&apos;re free to hang out. You&apos;ll light yours at the end of the tour.
      </Text>
      <Pressable
        onPress={onSpeedTour}
        style={[s.enableBtn, { backgroundColor: colors.success, flexDirection: "row", justifyContent: "center", gap: 8 }]}
        accessibilityRole="button"
        accessibilityLabel="Try the quick setup, the 2 minute path"
      >
        <Ionicons name="flash" size={18} color="#fff" />
        <Text style={[s.enableTxt, { color: "#fff" }]}>Try the quick setup</Text>
      </Pressable>
    </View>
  );
}

// Speed tour's notifications step: one strongly-recommended green button. Next is gated by
// onBeforeNext (see buildSpeedTour), which warns before letting the user skip past this.
function SpeedNotifBody({ onEnable }: { onEnable: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        Notifications are how you know the moment a friend lights a beacon. That is the only
        notification we are turning on in this step.
      </Text>
      <NotifEnableAction onEnable={onEnable} />
    </View>
  );
}

// Next-gate for the notifications step: pass through silently when permission is already granted,
// otherwise warn (missing friends' beacons is the whole point of the app) with Go back / Okay.
async function confirmSkipNotifications(): Promise<boolean> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.granted) return true;
  } catch {
    // fall through to the warning; never block the tour on a failed permission read
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      "Skip notifications?",
      "Without them you won't know when a friend lights a beacon. You can turn them on later in Settings.",
      [
        { text: "Go back", style: "cancel", onPress: () => resolve(false) },
        { text: "Okay", onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

// Live body for the speed tour's "add a friend" step (2b). Reads the friend count live via
// useOnboarding, so the instant the user adds a friend the text flips from "add me" to a congrats. The
// actual friends list (on the Friends screen) swaps the Add-Brian card for the new friend row on its own.
function SpeedFriendBody() {
  const { colors } = useTheme();
  const { steps } = useOnboarding();
  const hasFriend = !!steps.find((st) => st.key === "friend")?.done;
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        {hasFriend
          ? "Congrats on adding your first friend! They show up in your friends list right here."
          : "Add me if you need a friend to get started! Tap Add on Brian's card and you'll see me appear in your friends list right here."}
      </Text>
    </View>
  );
}

// The guided first-beacon final step. Built here so the host (home) can rebuild it live via
// updateStepById as username/friend/beacon state change. `reached` is a STICKY flag (set once the user
// has a username, a friend, AND has lit a beacon): once true it switches to the celebratory wrap-up
// with Done enabled, and stays there even if the beacon is later put out. Until then it's the gated
// guided-first-beacon (checklist + disabled Done), which seeds the test group + sheet on enter.
export function makeFirstBeaconStep(
  ctx: { openFirstBeacon: () => void; onEnterDone: () => void },
  live: { usernameDone: boolean; friendDone: boolean; beaconLit: boolean; reached: boolean }
): TourStep {
  if (live.reached) {
    return {
      id: "set-first-beacon",
      title: "You're all set! 🎉",
      body: <FirstBeaconDoneBody />,
      interactive: true,
      cta: "Done",
      onEnter: ctx.onEnterDone,
    };
  }
  return {
    id: "set-first-beacon",
    title: "Set your first beacon 🔥",
    body: <FirstBeaconBody usernameDone={live.usernameDone} friendDone={live.friendDone} beaconLit={live.beaconLit} />,
    interactive: true,
    cta: "Done",
    ctaDisabled: true, // gated until reached (username + friend + a lit beacon)
    onEnter: ctx.openFirstBeacon,
  };
}

export function buildBeaconTour(ctx: BeaconTourCtx): TourStep[] {
  // Each onEnter navigates to its own screen so Back/Forward always land on the page being
  // described (not just toggle the sheet).
  const home = () => { ctx.goHome(); ctx.closeSheet(); };
  const homeSheet = () => { ctx.goHome(); ctx.openSheet(); };
  const friends = () => { ctx.closeSheet(); ctx.goFriends(); };

  const steps: (TourStep | null)[] = [
    {
      id: "light-beacon-demo",
      target: "beacon-logs",
      title: "Your beacon",
      // SHORT intro (the callout must not bury the beacon) + the quick-setup choice. The real
      // light-your-beacon practice happens on the final step, so this one doesn't instruct a tap;
      // it stays interactive, and a curious tap gets the normal light confirm + the chat branch.
      body: <LightBeaconBody onSpeedTour={ctx.onSpeedTour} />,
      interactive: true,
      placement: "top", // keep the callout above the logs so it never covers the "tap the logs" caption below
      holePadTop: ctx.holePadTop, // reach UP over the structure + the current skin's full flame height
      holePadBottom: -16, // lower edge contains the full structure (incl. brazier legs) but clears the chat button
      nextTarget: "beacon-options-cta", // Next skips the chat branch below (only a real light opts into it)
      onEnter: home,
    },
    {
      // Opt-in mini-step: home jumps here (goToTarget) only when the user actually LIGHTS the beacon
      // during step 1 (a real false→true edge). Branch = not counted in "Step X of N". Home pushes
      // history on the jump, so Back returns to the fire/logs step (the edge-gate stops it from
      // re-branching). interactive = the chat button is tappable so the user can open the conversation.
      target: "beacon-chat",
      branch: true,
      interactive: true,
      title: "Your beacon chat",
      body: "Nice, it's lit! Friends who can see your beacon can RSVP and chat with you right here. Open it to take a look, or tap Next.",
      holePad: 12, // the chat button is the same blue as the ring; give a clear gap so they don't merge
      nextTarget: "beacon-options-cta",
      onEnter: home,
    },
    {
      target: "beacon-options-cta",
      title: "Set the details",
      body: "You can select the day, time, who sees it, and a message. Tap Beacon options to take a look.",
      advanceOnTargetTap: true,
      onEnter: home,
    },
    {
      target: "beacon-style",
      title: "Make it yours",
      body: "Pick your beacon's look and sound.",
      interactive: true,
      // TOP slot, the same spot as step 2's callout, so opening the sheet doesn't bounce the box:
      // the sheet (and its style chips) starts below the top zone, so nothing is covered.
      placement: "top",
      onEnter: homeSheet,
    },
    {
      // Day + time + friend groups + message, highlighted together (home wraps them in `sheet-fields`).
      // During the tour the TEST group is preselected, so any beacon lit here notifies no one.
      target: "sheet-fields",
      title: "Day, time, and more",
      body: "Set the day, time, and a message for your beacon. You can choose which friend groups to include here as well. For now, the test group is selected so you can test your beacon without notifying anyone.",
      interactive: true,
      placement: "top",
      onEnter: homeSheet,
    },
    makeFullUsernameStep(ctx, ctx.usernameDone),
    {
      // Spotlights the WHOLE profile block (username + display name + invite) so everything the copy
      // mentions is highlighted + tappable, not just the invite. Setting a username here is fine; if one
      // already exists that area is just read-only, which is benign.
      target: "friends-profile",
      title: "Your name & invite link",
      // For a brand-new user (no friends yet) this is THE place to say how to get a first friend:
      // the invite link, or adding Brian from the list just below.
      body: ctx.hasFriends
        ? "Friends see your display name if you set one; tap it up top to change it anytime. Share your invite link here: anyone who joins through it (or already has BeKin) becomes your friend."
        : "Friends see your display name if you set one; tap it up top to change it anytime. Share your invite link here: anyone who joins through it (or already has BeKin) becomes your friend. Want a first friend right away? Add me from the list below!",
      interactive: true,
      placement: "below",
      belowTarget: "friends-add",
      belowGap: 6,
      onEnter: friends,
    },
    {
      target: "friends-groups",
      title: "Friend groups",
      body: 'Group friends into sets like "Roommates" or "Soccer crew" so you can light a beacon for just them. Tap + to make one now, or Next to keep going.',
      interactive: true,
      onEnter: friends,
    },
    {
      // Requests + the friends list (and, for a brand-new user with no friends, the "Add Brian" card).
      // friends.tsx scrolls this block BELOW the top-slot callout (same treatment as speed 2b), and
      // the hole unions with the end-of-list marker so EVERY friend row is inside the ring. Always
      // present, so the onboarding banner's "Add a friend" jump (target friends-requests) resolves.
      id: "full-friends",
      target: "friends-requests",
      title: "Requests and friends",
      body: ctx.hasFriends
        ? "If you are added by username, you will see the friend request here. Below is a list of your friends."
        : "If you are added by username, you will see the friend request here. Below is a list of your friends. If you are looking for a first friend to test with, add me!",
      interactive: true,
      placement: "top",
      holeUnionTarget: "friends-list-end",
      onEnter: friends,
    },
    {
      target: "settings-notifications",
      title: "You're in control",
      body: <NotifTourBody onEnable={ctx.onEnableNotifications} />,
      interactive: true,
      // Force the LOW slot from the first frame so the callout never starts TOP then DIPS to LOW once
      // the (first-time, slow to mount) settings target measures. The body is short now, so no
      // growDown: the callout hugs the bottom and the switches stay visible (and scrollable) above it.
      placement: "low",
      onEnter: ctx.goSettings,
    },
    {
      // Light or dark: asked as its own question, pointing at the actual button so the user knows
      // where it lives. Interactive: tapping flips the theme live under the spotlight.
      target: "settings-darkmode",
      title: "Light or dark?",
      body: "Your call. This button flips the whole app, and you can come back and change it anytime.",
      interactive: true,
      onEnter: ctx.goSettings,
    },
    // Final step is ALWAYS shown (never auto-skipped). It's a single LIVE step: gated guided-first-
    // beacon until the user has username + friend + a lit beacon, then the celebratory wrap-up. The
    // host rebuilds it via updateStepById; `reached` here is the initial (build-time) value.
    makeFirstBeaconStep(
      { openFirstBeacon: ctx.openFirstBeacon, onEnterDone: home },
      {
        usernameDone: ctx.usernameDone,
        friendDone: ctx.friendDone,
        beaconLit: ctx.beaconLit,
        reached: ctx.usernameDone && ctx.friendDone && ctx.beaconLit,
      }
    ),
  ];

  return steps.filter(Boolean) as TourStep[];
}

// ---- Speed tour LIVE steps. Each is a maker so home can re-render it in place (updateStepById)
// as the underlying state changes: username saved, first friend added, beacon lit. ----

// Step 1: gated on actually SAVING a username (Next grayed until then).
export function makeSpeedUsernameStep(ctx: BeaconTourCtx, usernameDone: boolean): TourStep {
  const friends = () => { ctx.closeSheet(); ctx.goFriends(); };
  return {
    // Back returns to the FULL tour's step 1 (ctx.onExitSpeedTour) rather than ending the tour.
    id: "speed-username",
    target: "friends-username",
    title: "Add a username",
    body: "Pick a username and tap Save. It is how friends find and add you.",
    interactive: true,
    placement: "below",
    belowTarget: "friends-add",
    belowGap: 6,
    backAction: ctx.onExitSpeedTour,
    ctaDisabled: !usernameDone,
    ctaDisabledNote: "Save a username to continue.",
    onEnter: friends,
  };
}

// Step 2b: LIVE body (congrats only once a friend actually exists; otherwise pitches the Add-Brian
// card, which renders INSIDE the highlighted block at 0 friends). Next gated on having a friend.
// The hole reaches below the wrapper so the first friend row is highlighted too.
export function makeSpeedFriendStep(ctx: BeaconTourCtx, friendDone: boolean): TourStep {
  const friends = () => { ctx.closeSheet(); ctx.goFriends(); };
  return {
    id: "speed-friend",
    target: "friends-requests",
    title: "Your friends",
    body: <SpeedFriendBody />,
    interactive: true,
    stepLabel: "2b",
    placement: "top",
    holeUnionTarget: "friends-list-end", // ring the WHOLE friends list, however many rows
    branch: true,
    ctaDisabled: !friendDone,
    ctaDisabledNote: "1 friend is needed to continue.",
    onEnter: friends,
  };
}

// Step 4, ONE live step: unlit shows the tap instruction with the CTA as a grayed incomplete task;
// lighting flips it in place to the congratulations with Done enabled and the highlight grown to
// wrap the beacon AND Beacon options together.
export function makeSpeedLightStep(ctx: BeaconTourCtx, lit: boolean): TourStep {
  const home = () => { ctx.goHome(); ctx.closeSheet(); };
  if (lit) {
    return {
      id: "speed-light",
      target: "beacon-options-cta",
      title: "Beacon lit! 🎉",
      body: "Congrats, that's the whole flow. It went to your test group, so no friends were notified. Open Beacon options to set the day, time, and who sees it.",
      interactive: true,
      placement: "top",
      holePadTop: ctx.holePadTop + 235, // structure + chat slot; slightly short of the flame tip so
      // the ring keeps clear air between itself and the instruction box above
      cta: "Done",
      onEnter: home,
    };
  }
  return {
    id: "speed-light",
    target: "beacon-logs",
    title: "Light your beacon",
    body: (
      <TapNounBody
        initialNoun={ctx.tapNoun}
        template={(noun) =>
          `Tap the ${noun} to light your beacon. It is set to your test group, so no friends are notified while you try it.`}
      />
    ),
    interactive: true,
    placement: "top",
    holePadTop: ctx.holePadTop,
    holePadBottom: -16,
    cta: "Light your beacon",
    ctaDisabled: true, // not a button: the incomplete task, shown where Next goes
    onEnter: home,
  };
}

// The SPEED TOUR: the minimum to get going. username, then a friend, then notifications, then light
// a beacon (which congratulates in place). Reached from step 1 of the full tour via its green
// "Try the quick setup" button (ctx.onSpeedTour calls restart() with these steps).
export function buildSpeedTour(ctx: BeaconTourCtx): TourStep[] {
  const friends = () => { ctx.closeSheet(); ctx.goFriends(); };
  return [
    makeSpeedUsernameStep(ctx, ctx.usernameDone),
    {
      // Step 2a: how to add a friend (invite link + add by username). LOW slot with the block
      // scrolled to the top of the screen.
      id: "speed-invite",
      target: "friends-add-card",
      title: "Add a friend",
      body: "Share your invite link, or send a friend request by their username here.",
      interactive: true,
      stepLabel: "2a",
      placement: "low",
      onEnter: friends,
    },
    makeSpeedFriendStep(ctx, ctx.friendDone),
    {
      // Optional but STRONGLY recommended: without notifications the whole app goes quiet. Next is
      // gated: with permission still off it warns (Go back / Okay) before moving on.
      id: "speed-notifications",
      title: "Don't miss your friends",
      body: <SpeedNotifBody onEnable={ctx.onEnableNotifications} />,
      interactive: true,
      stepLabel: "3",
      onBeforeNext: confirmSkipNotifications,
      onEnter: friends,
    },
    makeSpeedLightStep(ctx, ctx.beaconLit),
  ];
}

// ---------- Post tour (Post screen + Settings) ----------

export type PostTourCtx = {
  goSettings: () => void;
  goPost: () => void;
};

export function buildPostTour(ctx: PostTourCtx): TourStep[] {
  return [
    {
      target: "post-limit",
      title: "Your posting pace",
      // Describes exactly what's highlighted (the pace note); the 1000-word cap is mentioned
      // without claiming the counter is inside the ring (it lives further down the form).
      body: "You can make 1 post every other day, up to 1000 words each.",
      onEnter: ctx.goPost,
    },
    {
      target: "post-bonus",
      title: "Bonus posts",
      body: "Take days off and you bank up to 3 bonus posts. Spend one to post even when you're rate-limited.",
      onEnter: ctx.goPost,
    },
    {
      target: "settings-comments",
      title: "Comments are your call",
      body: "Decide whether friends can comment on your posts.",
      interactive: true,
      onEnter: ctx.goSettings,
    },
    {
      target: "settings-comment-notify",
      title: "Comment notifications",
      body: "Choose whether to be notified about comments.",
      interactive: true,
      onEnter: ctx.goSettings,
    },
    {
      title: "You're set! ✍️",
      body: "That's the feed in a nutshell. Head back and share your first post whenever you're ready.",
      cta: "Done",
      onEnter: ctx.goPost,
    },
  ];
}

const s = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22 },
  enableBtn: { marginTop: 14, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  // Granted state: outlined green row with a check, clearly done rather than tappable.
  enableDone: { borderWidth: 1.5, backgroundColor: "transparent", flexDirection: "row", justifyContent: "center", gap: 8 },
  enableTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  todoList: { marginTop: 14, gap: 8 },
  todoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  todoTxt: { fontSize: 15, fontWeight: "600" },
  todoDone: { textDecorationLine: "line-through" },
});
