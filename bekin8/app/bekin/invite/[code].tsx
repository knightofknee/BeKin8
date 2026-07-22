// app/bekin/invite/[code].tsx
// Landing route for the universal invite link (https://www.waldgrave.com/bekin/invite/CODE).
// Without this file the link opened an UNMATCHED route and the app just sat on a blank screen.
// The root layout's URL listener normally stashes the code too; doing it here as well covers
// cold starts, then the user is bounced to the normal entry flow, where the Gate sends
// signed-in users to /home and the pending code is redeemed into a friendship.
import { useEffect } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { coerceInviteCode, stashPendingInvite } from "../../../lib/inviteLink";

export default function InviteLanding() {
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  useEffect(() => {
    const raw = Array.isArray(code) ? code[0] : code;
    const c = coerceInviteCode(raw ?? null);
    if (c) stashPendingInvite(c);
  }, [code]);
  return <Redirect href="/" />;
}
