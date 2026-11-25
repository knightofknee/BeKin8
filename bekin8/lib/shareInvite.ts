// lib/shareInvite.ts
// Share MY friend link through the system share sheet. The LINK and nothing else: the sender adds
// their own words, and the invite page's preview card (it names the inviter) supplies the context.
import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { buildInviteUrl, prefetchMyInviteCode } from "./inviteLink";
import { track } from "./analytics";

export type ShareInviteResult = "shared" | "copied" | "cancelled" | "no-code";

export async function shareMyFriendLink(uid: string, knownCode?: string | null, source: string = "friends"): Promise<ShareInviteResult> {
  const code = knownCode || (await prefetchMyInviteCode(uid));
  if (!code) return "no-code";
  const url = buildInviteUrl(code);
  track("invite_share", { source });
  try {
    if (Platform.OS === "web") {
      // Browsers: the system share sheet when there is one (phones), else copy the link.
      const nav: any = typeof navigator !== "undefined" ? navigator : null;
      if (nav?.share) {
        await nav.share({ url });
        return "shared";
      }
      await Clipboard.setStringAsync(url);
      return "copied";
    }
    const res =
      Platform.OS === "ios"
        ? await Share.share({ url }, { subject: "Add me on BeKin" })
        : // Android ignores `url`, so the link is the message.
          await Share.share({ message: url }, { dialogTitle: "Share your friend link" });
    return res.action === Share.dismissedAction ? "cancelled" : "shared";
  } catch {
    return "cancelled"; // user cancelled or share failed
  }
}
