// components/tutorial/content.tsx
// Step content for the in-app tutorials. Kept separate from the screens so the screens
// stay lean and the copy lives in one place. Each builder returns TutorialStep[].
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../../providers/ThemeProvider";
import type { TutorialStep } from "./TutorialModal";
import ExampleBeaconCard from "./ExampleBeaconCard";

// ---------- Beacon tutorial ----------

export type BeaconStepCtx = {
  /** Close the tour and navigate to the Friends tab. */
  onGoToFriends: () => void;
  /** When true, the final step offers to set the user's first beacon. */
  isFirstBeacon: boolean;
  /** Request OS notification permission and opt into friend-beacon alerts. */
  onEnableNotifications: () => void;
};

function Body({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[s.text, { color: colors.text }]}>{children}</Text>;
}

function FriendBeaconsBody() {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.text, { color: colors.text }]}>
        When your friends light their beacons, they show up at the top of this screen — like
        this:
      </Text>
      <View style={{ height: 14 }} />
      <ExampleBeaconCard caption={null} />
    </View>
  );
}

function NotifBody({ onEnable }: { onEnable: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.text, { color: colors.text }]}>
        BeKin only notifies you about things that matter — never spam:
      </Text>
      <View style={{ height: 10 }} />
      <Text style={[s.bullet, { color: colors.text }]}>🔥  A friend lights a beacon</Text>
      <Text style={[s.bullet, { color: colors.text }]}>🙋  Someone RSVPs or chats on yours</Text>
      <Text style={[s.bullet, { color: colors.text }]}>👋  A friend request or a friend’s new post</Text>
      <View style={{ height: 12 }} />
      <Text style={[s.text, { color: colors.text }]}>
        Turn them on so you never miss a beacon. You stay in full control of exactly which alerts
        you get — adjust them any time in Settings.
      </Text>
      <Pressable onPress={onEnable} style={[s.enableBtn, { backgroundColor: colors.primary }]}>
        <Text style={s.enableTxt}>Turn on notifications</Text>
      </Pressable>
    </View>
  );
}

function FriendsBody({ onGoToFriends }: { onGoToFriends: () => void }) {
  const { colors } = useTheme();
  return (
    <View>
      <Text style={[s.text, { color: colors.text }]}>
        Beacons are all about friends. On the Friends tab you can add friends and sort them into
        groups (like “Roommates” or “Soccer crew”), then light a beacon for just that group.
        Leave groups unselected and all your friends can see it.
      </Text>
      <Pressable onPress={onGoToFriends} style={[s.linkBtn, { borderColor: colors.primary }]}>
        <Text style={[s.linkTxt, { color: colors.primary }]}>Open the Friends tab →</Text>
      </Pressable>
    </View>
  );
}

export function beaconSteps(ctx: BeaconStepCtx): TutorialStep[] {
  return [
    {
      title: "Welcome to BeKin 🔥",
      body: (
        <Body>
          A Beacon is a simple signal to your friends that you’re free to hang out. Light yours
          and friends get a heads-up — and you’ll see theirs light up here too.
        </Body>
      ),
    },
    {
      title: "Light your beacon",
      body: (
        <Body>
          Tap the stack of logs on this screen to light your beacon. Tap it again any time to put
          it out.
        </Body>
      ),
    },
    {
      title: "Set the details",
      body: (
        <Body>
          Tap “Beacon options” to pick a day, an optional time, which friend groups can see it,
          and a short message — all before you light it.
        </Body>
      ),
    },
    {
      title: "Friends can join & chat",
      body: (
        <Body>
          When your beacon is lit, friends tap “I’m in” to RSVP and can chat with you right inside
          the beacon. Tap your lit beacon to open it.
        </Body>
      ),
    },
    {
      title: "Your friends’ beacons",
      body: <FriendBeaconsBody />,
    },
    {
      title: "Friends & groups",
      body: <FriendsBody onGoToFriends={ctx.onGoToFriends} />,
    },
    {
      title: "Stay in the loop",
      body: <NotifBody onEnable={ctx.onEnableNotifications} />,
    },
    {
      title: "Light your first beacon!",
      body: (
        <Body>
          Let’s set your first one. We’ve pre-filled a quick intro message so your friends know
          you’ve joined — you can edit anything before you light it.
        </Body>
      ),
      cta: ctx.isFirstBeacon ? "Set my first beacon 🔥" : "Done",
    },
  ];
}

// ---------- Post-tab tutorial ----------
// Plain-string bodies (no JSX text nodes), so apostrophes need no escaping.

export function postSteps(): TutorialStep[] {
  return [
    {
      title: "Share with your friends",
      body: "The Post tab is your friends-only feed. Share a thought, a link, or a question — only your friends see it.",
    },
    {
      title: "Title & content",
      body: "Give your post a Title and write your Content. Both are required before you can post.",
    },
    {
      title: "Add a link (optional)",
      body: "Drop in a Link and your friends will see a tidy preview alongside your post.",
    },
    {
      title: "Keep it punchy",
      body: "Posts are capped at 1000 words. The counter under the box turns amber, then red, as you get close.",
    },
    {
      title: "Your posting pace",
      body: "You can make 1 post every other day. Take days off and you bank up to 3 bonus posts (the number beside the Post button) to spend whenever you like.",
    },
    {
      title: "Hit Post",
      body: "Tap Post to publish. Your post drops straight into the friends feed — done!",
    },
  ];
}

const s = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 22 },
  bullet: { fontSize: 15, lineHeight: 24 },
  linkBtn: {
    marginTop: 14,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  linkTxt: { fontSize: 14, fontWeight: "700" },
  enableBtn: {
    marginTop: 16,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  enableTxt: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
