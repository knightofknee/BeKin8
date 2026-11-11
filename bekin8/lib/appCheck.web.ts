// lib/appCheck.web.ts
// Web build of App Check: reCAPTCHA Enterprise (invisible, score-based; nothing for the user to
// click). The native attestation bridge in appCheck.ts can't run in a browser, so without this every
// web request counted as unverified and enforcing App Check would have locked web users out.
//
// The site key is public by design (it ships in every page that uses it). It is restricted to
// waldgrave.com and www.waldgrave.com in reCAPTCHA Enterprise and registered for the BeKin web app
// (1:203808800578:web:a44b8d3c...) in Firebase App Check, project waldgrave-profiles.
//
// Other hosts (localhost, a dev server) are skipped: the key would be rejected there, and the SDK
// would log token errors on every request. In monitor mode those requests just count as unverified.
import type { FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";

const RECAPTCHA_ENTERPRISE_SITE_KEY = "6LcjahouAAAAAMkzR2GuhufXLwNtzaW8GXZDPlxG";

let started: AppCheck | null | undefined;

export function startAppCheck(app: FirebaseApp): AppCheck | null {
  if (started !== undefined) return started;
  started = null;
  try {
    const host = typeof location !== "undefined" ? location.hostname : "";
    if (host !== "waldgrave.com" && host !== "www.waldgrave.com") return null;
    started = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Never let App Check stop the app from loading.
    started = null;
  }
  return started;
}
