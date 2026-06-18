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
  /** Whether the device is online — the "Add Brian" card is replaced by an offline notice when not. */
  online: boolean;
  onEnableNotifications: () => void;
};

function NotifTourBody({ onEnable }: { onEnable: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.body, { color: colors.text }]}>
        By default BeKin only pings you when a friend lights a beacon. The switches below give you
        full control — everything else is off unless you turn it on.
      </Text>
      <Pressable onPress={onEnable} style={[s.enableBtn, { backgroundColor: colors.primary }]}>
        <Text style={s.enableTxt}>Turn on notifications</Text>
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
      target: "beacon-logs",
      title: "Light your beacon",
      body: "A beacon tells friends you're free to hang out. Tap the logs to light it — tap again to put it out. (No one can see it until you've added friends — we'll do that next.)",
      interactive: true,
      onEnter: home,
    },
    {
      target: "beacon-options-cta",
      title: "Set the details",
      body: "Before lighting it you can choose the day, time, who sees it, and a message. Tap Beacon options to take a look.",
      advanceOnTargetTap: true,
      onEnter: home,
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
      target: "friends-profile",
      title: "Pick your username",
      body: "A username is required to use BeKin — it's how friends find and add you, and you can't add anyone without one. If you set a display name, friends see that instead of your username. Tap your display name to edit it — and to see the rest of your profile.",
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
      onEnter: ctx.goSettings,
    },
    {
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
