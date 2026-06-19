// components/tutorial/tourSteps.tsx
// Step content for the coach-mark tours. Targets reference keys registered via useTourTarget()
// across Home, the options sheet, Friends, the Post screen, and Settings. Steps marked
// `interactive` let the user touch/edit the highlighted element without ending the tour.
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../../providers/ThemeProvider";
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
  /** True once the user has ≥1 friend — drops the "Add Brian" step (its card only shows at 0). */
  hasFriends: boolean;
  /** True if the user already has a beacon (lit / active / planned) — switches the final step to
   * the "you're all set" wrap-up instead of the "set your first beacon" prompt. */
  hasBeacon: boolean;
  /** Whether the device is online — the "Add Brian" card is replaced by an offline notice when not. */
  online: boolean;
  onEnableNotifications: () => void;
};

function NotifTourBody({ onEnable }: { onEnable: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        By default, BeKin only sends notifications when a friend lights a beacon. You can turn that
        off for any friend. The switches here give you full control of any other notifications, all
        turned off to start.
      </Text>
      {/* Tonal/secondary (tinted fill + primary text), so the tour's solid primary CTA is just
          "Next" — two full-width solid buttons read as competing. */}
      <Pressable
        onPress={onEnable}
        style={[s.enableBtn, { backgroundColor: colors.primary + '22', borderColor: colors.primary, borderWidth: 1 }]}
      >
        <Text style={[s.enableTxt, { color: colors.primary }]}>Turn on notifications</Text>
      </Pressable>
    </View>
  );
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
      body: "A beacon tells friends you're free to hang out. Tap the logs to light it — tap again to put it out. (No one can see it until you set a username and add a friend.)",
      interactive: true,
      placement: "top", // keep the callout above the logs so it never covers the "tap the logs" caption below
      holePadTop: 70, // reach UP over the logs + lower flame; the tip overlaps above the box (ok per user)
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
      body: "Nice — it's lit! Friends who can see your beacon can RSVP and chat with you right here. Open it to take a look, or tap Next.",
      nextTarget: "beacon-options-cta",
      onEnter: home,
    },
    {
      target: "beacon-options-cta",
      title: "Set the details",
      body: "Before lighting it you can choose the day, time, who sees it, and a message. Tap Beacon options to take a look.",
      advanceOnTargetTap: true,
      onEnter: home,
    },
    {
      target: "beacon-style",
      title: "Make it yours",
      body: "Pick your beacon's look — a campfire, a roaring bonfire, a signal across the mountains, and more. It's just a visual style; friends see your beacon the same either way.",
      interactive: true,
      onEnter: homeSheet,
    },
    { target: "sheet-day", title: "Pick a day", body: "Choose any day in the week ahead — give one a tap.", interactive: true, onEnter: homeSheet },
    {
      target: "sheet-time",
      title: "Add a time",
      body: "Optionally set a time — or leave it blank for an all-day beacon.",
      interactive: true,
      onEnter: homeSheet,
    },
    {
      target: "sheet-groups",
      title: "Choose who sees it",
      body: "Pick a friend group, or leave it unset so all your friends can see it.",
      interactive: true,
      onEnter: homeSheet,
    },
    { target: "sheet-message", title: "Say something", body: "Add a short note so friends know what's up.", interactive: true, onEnter: homeSheet },
    {
      target: "friends-username",
      title: "Pick your username",
      body: "A username is required — it makes you unique and gives a way to add friends. You can't add anyone without one. Choose one and tap Save. (Don't stress, you can set a display name later)",
      interactive: true,
      onEnter: friends,
    },
    {
      target: "friends-invite",
      title: "Your name & invite link",
      body: "Friends see your display name if you set one — tap it up top to change it anytime. And share your invite link here: anyone who joins through it (or already has BeKin) becomes your friend instantly.",
      interactive: true,
      onEnter: friends,
    },
    // Always present while the user has no friend (so the banner's "Add a friend" jump always
    // resolves). Online → spotlights the Add-Brian card; offline → the card isn't rendered, so the
    // step shows a centered notice instead.
    ctx.hasFriends
      ? null
      : {
          target: "add-brian",
          title: "Add your first friend",
          body: ctx.online
            ? "Tap Add to connect with Brian, BeKin's creator — his posts fill your feed so you can see it live. (You can add anyone by username above.)"
            : "You're offline right now — reconnect to add Brian, BeKin's creator, or anyone by username above. This is the last setup step.",
          interactive: true,
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
      target: "settings-notifications",
      title: "You're in control",
      body: <NotifTourBody onEnable={ctx.onEnableNotifications} />,
      interactive: true,
      // Long body: keep the box's TOP put and grow DOWN (over the tab bar if needed) instead of
      // pushing up over the highlighted switches.
      growDown: true,
      onEnter: ctx.goSettings,
    },
    // Final step is ALWAYS shown (never auto-skipped). Two versions depending on what's already
    // done: a celebratory wrap-up if the user already has a beacon, otherwise the guided first beacon.
    ctx.hasBeacon
      ? {
          id: "set-first-beacon",
          title: "You're all set! 🎉",
          body: "That's everything — your beacon's already going and your setup's complete, so friends can see when you're free to hang out. Tap Done to finish.",
          interactive: true,
          cta: "Done",
          onEnter: () => { ctx.goHome(); ctx.closeSheet(); },
        }
      : {
          id: "set-first-beacon",
          title: "Set your first beacon 🔥",
          body: "Last step! We've pre-filled a quick hello for today. Tweak the day, time, or who can see it, then Save to set your beacon — that wraps up the tour. (Tap Done to finish anytime.)",
          interactive: true,
          cta: "Done",
          onEnter: ctx.openFirstBeacon,
        },
  ];

  return steps.filter(Boolean) as TourStep[];
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
      body: "You can make 1 post every other day — the counter shows your word limit (1000 words).",
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
      body: "Decide whether friends can comment on your posts. Try the switch — the tour will stay put.",
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
});
