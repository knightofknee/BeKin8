// app/signup.tsx
// Signing up and signing in are ONE page now (app/index.tsx): a new email creates the account, a
// known one signs in. This route only remains so old links to /signup still land somewhere.
import { Redirect } from "expo-router";

export default function SignUp() {
  return <Redirect href="/" />;
}
