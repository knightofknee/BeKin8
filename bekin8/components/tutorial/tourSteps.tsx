// components/tutorial/tourSteps.tsx
// Step content for the coach-mark tours. Targets reference keys registered via useTourTarget()
// across Home, the options sheet, Friends, the Post screen, and Settings. Steps marked
// `interactive` let the user touch/edit the highlighted element without ending the tour.
import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../providers/ThemeProvider";
import { useOnboarding } from "../../providers/OnboardingProvider";
import { getBeaconSkinId, onBeaconSkinChange } from "../../lib/beaconSkinPref";
import { getSkin } from "../../lib/beaconSkins";
import type { TourStep } from "./SpotlightTour";

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
        BeKin only notifies you when a friend lights a beacon. These switches turn on any extra
        notifications you want, and they all start off. You can mute any single friend from the friends tab.
      </Text>
      {/* Solid GREEN "live" action (distinct from the solid-blue Next CTA) so it reads as active and
          inviting, not a ghosted/disabled control. */}
      <Pressable
        onPress={onEnable}
        style={[s.enableBtn, { backgroundColor: colors.success, flexDirection: "row", justifyContent: "center", gap: 8 }]}
      >
        <Ionicons name="notifications" size={18} color="#fff" />
        <Text style={[s.enableTxt, { color: "#fff" }]}>Turn on beacon notifications</Text>
      </Pressable>
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
        here to try things out without notifying anyone.
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

// Body for the FULL tour's first step. Keeps the live "tap the {noun}" instruction, then presents the
// quick-setup choice up front as a clear affordance (rather than the easy-to-miss stacked nav button):
// a green "Try the quick setup" button that switches to the 2-minute speed tour via ctx.onSpeedTour.
function LightBeaconBody({ initialNoun, onSpeedTour }: { initialNoun: string; onSpeedTour: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <TapNounBody
        initialNoun={initialNoun}
        template={(noun) => `A beacon tells friends you're free to hang out. Tap the ${noun} to light it, tap again to put it out. Nothing is shared yet: that starts once you add a username and a friend.`}
      />
      <Text style={[s.body, { color: colors.subtle, marginTop: 10 }]}>
        In a hurry? The quick setup covers just the essentials: a username, a friend, and lighting a beacon.
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
          : "If you are looking for a first friend to test with, add me! Tap Add on Brian's card, and you will see them appear in your friends list."}
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
      body: "That's everything, your setup is complete. Friends can see your beacon whenever it's lit, so they know when you're free to hang out. Tap Done to finish.",
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
      title: "Light your beacon",
      // Body presents the quick-setup choice up front (a clear "Try the quick setup" affordance) instead
      // of only the easy-to-miss stacked nav button; the speed-tour wiring (ctx.onSpeedTour) is unchanged.
      body: <LightBeaconBody initialNoun={ctx.tapNoun} onSpeedTour={ctx.onSpeedTour} />,
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
      // The style chips sit at the TOP of the sheet, so sit the callout JUST BELOW them (as high as
      // readable without covering the chips), leaving the "Day" header + first row peeking through for
      // orientation. belowGap is tunable on device.
      placement: "below",
      belowGap: 72,
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
    {
      target: "friends-username",
      title: "Pick your username",
      body: "A username is required to uniquely identify you. It can be used to add friends. You can also set a display name in the next step.",
      interactive: true,
      // Sit the callout just below the "send a friend request" field (shared anchor) so it's high and
      // at the SAME height as the next step, with that field still barely visible above the box.
      placement: "below",
      belowTarget: "friends-add",
      belowGap: 6,
      onEnter: friends,
    },
    {
      // Spotlights the WHOLE profile block (username + display name + invite) so everything the copy
      // mentions is highlighted + tappable, not just the invite. Setting a username here is fine; if one
      // already exists that area is just read-only, which is benign.
      target: "friends-profile",
      title: "Your name & invite link",
      body: "Friends see your display name if you set one; tap it up top to change it anytime. And share your invite link here: anyone who joins through it (or already has BeKin) becomes your friend.",
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
      // friends.tsx scrolls this block into view when this step is active. The last sentence only shows
      // at 0 friends, since the Add-Brian card only renders then. Always present, so the onboarding
      // banner's "Add a friend" jump (target friends-requests) always resolves.
      target: "friends-requests",
      title: "Requests and friends",
      body: ctx.hasFriends
        ? "If you are added by username, you will see the friend request here. Below is a list of your friends."
        : "If you are added by username, you will see the friend request here. Below is a list of your friends. If you are looking for a first friend to test with, add me!",
      interactive: true,
      placement: "low",
      onEnter: friends,
    },
    {
      target: "settings-notifications",
      title: "You're in control",
      body: <NotifTourBody onEnable={ctx.onEnableNotifications} />,
      interactive: true,
      // Force the LOW slot from the first frame so the callout never starts TOP then DIPS to LOW once the
      // (first-time, slow to mount) settings target measures. Long body grows DOWN over the tab bar, not
      // up over the switches.
      placement: "low",
      growDown: true,
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

// The SPEED TOUR: the minimum to get going. username, then a friend, then light a beacon, then a short
// "you're all set" that points at Beacon options. Reached from step 1 of the full tour via its green
// "Speed tour" button (ctx.onSpeedTour calls restart() with these steps).
export function buildSpeedTour(ctx: BeaconTourCtx): TourStep[] {
  const home = () => { ctx.goHome(); ctx.closeSheet(); };
  const friends = () => { ctx.closeSheet(); ctx.goFriends(); };
  return [
    {
      // Step 1. Back returns to the FULL tour's step 1 (ctx.onExitSpeedTour) rather than ending the tour.
      id: "speed-username",
      target: "friends-username",
      title: "Add a username",
      body: "Pick a username and tap Save. It is how friends find and add you.",
      interactive: true,
      placement: "below",
      belowTarget: "friends-add",
      belowGap: 6,
      backAction: ctx.onExitSpeedTour,
      onEnter: friends,
    },
    {
      // Step 2a: how to add a friend (invite link + add by username). topFrac holds the callout at the
      // SAME higher spot as 2b (below the highlighted block, not pinned to the bottom).
      id: "speed-invite",
      target: "friends-add-card",
      title: "Add a friend",
      body: "Share your invite link, or send a friend request by their username here.",
      interactive: true,
      stepLabel: "2a",
      topFrac: 0.52,
      onEnter: friends,
    },
    {
      // Step 2b (a non-counted continuation of step 2): the friends list + the Add-Brian option. The body
      // is LIVE (SpeedFriendBody) and flips to a congrats the moment a friend is added. Same topFrac as 2a.
      id: "speed-friend",
      target: "friends-requests",
      title: "Your friends",
      body: <SpeedFriendBody />,
      interactive: true,
      stepLabel: "2b",
      topFrac: 0.52,
      branch: true,
      onEnter: friends,
    },
    {
      id: "speed-light",
      target: "beacon-logs",
      title: "Light your beacon",
      body: (
        <TapNounBody
          initialNoun={ctx.tapNoun}
          template={(noun) => `Tap the ${noun} to light your beacon. That tells your friends you are free to hang out.`}
        />
      ),
      interactive: true,
      placement: "top",
      stepLabel: "3a",
      holePadTop: ctx.holePadTop,
      holePadBottom: -16,
      onEnter: home,
    },
    {
      // Phase 2 of "light a beacon": not counted, so the light step and this both read as step 3.
      id: "speed-done",
      target: "beacon-options-cta",
      title: "You're all set!",
      body: "Nice work. Open Beacon options to set the day, time, and more.",
      interactive: true,
      branch: true,
      stepLabel: "3b",
      cta: "Done",
      onEnter: home,
    },
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
      body: "You can make 1 post every other day. The counter shows your word limit (1000 words).",
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
      body: "Decide whether friends can comment on your posts. Try the switch; the tour will stay put.",
      interactive: true,
      onEnter: ctx.goSettings,
    },
    {
      target: "settings-comment-notify",
      title: "Comment notifications",
      body: "And choose whether to be notified about comments. Flip it however you like.",
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
  enableTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
  todoList: { marginTop: 14, gap: 8 },
  todoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  todoTxt: { fontSize: 15, fontWeight: "600" },
  todoDone: { textDecorationLine: "line-through" },
});
