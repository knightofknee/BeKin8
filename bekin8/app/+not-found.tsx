// app/+not-found.tsx
// Any unmatched path (stale universal link, mistyped deep link) lands here instead of on a
// dead blank screen. Bounce to the entry route; the Gate then sends signed-in users to /home.
import { Redirect } from "expo-router";

export default function NotFound() {
  return <Redirect href="/" />;
}
