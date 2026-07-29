// app/home.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  InputAccessoryView,
  ScrollView,
  Animated,
  BackHandler,
  useWindowDimensions,
  AccessibilityInfo,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeaconStructure from '../components/BeaconStructure';
import BeaconScene from '../components/BeaconScene';
import BeaconFire from '../components/BeaconFireSkia';
import BeaconLighthouseBeam from '../components/BeaconLighthouseBeam';
import BeaconSearchlightBeam from '../components/BeaconSearchlightBeam';
import BeaconStormBolt from '../components/BeaconStormBolt';
import BeaconSmokeSignal from '../components/BeaconSmokeSignal';
import BeaconFireworks from '../components/BeaconFireworks';
import BeaconSkyLanterns from '../components/BeaconSkyLanterns';
import BeaconEmberColumn from '../components/BeaconEmberColumn';
import BeaconPrintFire from '../components/BeaconPrintFire';
import BeaconBonfireFlame from '../components/BeaconBonfireFlame';
import StylePreview from '../components/StylePreview';
// Centerpiece fire is the GPU Skia shader. The original SVG flame it was A/B'd against is gone:
// the flag had been pinned on for every skin built since, so the SVG path was unreachable code
// that still carried three rules-of-hooks violations.
// Skia (GPU shader) smoke, drop-in for the old SVG BeaconSmoke. Revert by swapping this import
// back to '../components/BeaconSmoke' (kept in the repo as the no-native-dep fallback).
import BeaconSmoke from '../components/BeaconSmokeSkia';
import { getSkin, DEFAULT_SKIN_ID, BEACON_SKINS } from '../lib/beaconSkins';
import { getBeaconSkinId, setBeaconSkinId, onBeaconSkinChange } from '../lib/beaconSkinPref';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { auth, db } from '../firebase.config';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import ChatRoom from '../components/ChatRoom';
import FriendsBeaconsList, { FriendBeacon } from '../components/FriendsBeaconsList';
import BottomBar from '@/components/BottomBar';
import { SCREEN_PAD } from '@/components/ui/layout';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { syncPushTokenIfGranted, ensurePushPermissionsAndToken } from '../lib/push';
import * as Notifications from 'expo-notifications';
import { usePrefetchBeaconMessages } from '../lib/prefetchBeaconMessages';
import { buildTimeHHmm, parseTimeHHmm, formatTimeHHmmDisplay } from '../lib/beaconTime';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useOnline } from '../providers/NetworkProvider';
import { tap, press, selection, success } from '../utils/haptics';
import TutorialResumeBanner from '../components/tutorial/TutorialResumeBanner';
import {
  buildBeaconTour,
  buildSpeedTour,
  makeFirstBeaconStep,
  makeFullUsernameStep,
  makeSpeedUsernameStep,
  makeSpeedFriendStep,
  makeSpeedLightStep,
  type BeaconTourCtx,
} from '../components/tutorial/tourSteps';
import { useTour, useTourTarget, type TourStep } from '../providers/TourProvider';
import { useOnboarding } from '../providers/OnboardingProvider';
import { getSeen, setSeen } from '../lib/tutorialFlags';
import { ensureNotifyPermission } from '../lib/notifyPermission';
import { useFireSound } from '../lib/useFireSound';
import { getFireSoundEnabled, setFireSoundEnabled, onFireSoundChange } from '../lib/fireSoundPref';
import { needsVerification } from '../lib/emailVerification';

// --- date helpers ---
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function getMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number')
    return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return 0;
}

// Compute the calendar-day anchors together (today's start, the 7-day window end, and the day chips)
// so they always agree and can be refreshed atomically when the day rolls over. `dayKey` is a stable
// yyyymmdd string used to detect an actual day change (vs. any AppState 'active' on the same day).
function computeDayAnchor() {
  const base = startOfDay(new Date());
  const windowEnd = endOfDay(new Date(base));
  windowEnd.setDate(windowEnd.getDate() + 6);
  const next7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const label =
      i === 0
        ? 'Today'
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return { date: d, label, offset: i };
  });
  const dayKey = `${base.getFullYear()}${base.getMonth() + 1}${base.getDate()}`;
  return { todayStart: base, windowEnd, next7Days, dayKey };
}

const DEFAULT_BEACON_MESSAGE = 'Hang out at my place?';
// Pre-filled into the very first beacon during the onboarding tutorial so new users
// announce that they've joined. Only used for the guided first beacon, never the default.
const FIRST_BEACON_INTRO = 'Testing out my beacon';
const MSG_ACCESSORY_ID = 'beacon-msg-accessory';
const BEACON_MESSAGE_MAX = 1000;

// --- Friend groups ---
type FriendGroup = {
  id: string;
  name: string;
  memberUids: string[];
};

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ beaconId?: string; messageId?: string; tutorial?: string; tourTarget?: string; tourStepId?: string }>();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const insets = useSafeAreaInsets();

  // Your beacon state
  const [isLit, setIsLit] = useState<boolean | null>(null);
  const [myActiveBeacon, setMyActiveBeacon] = useState<FriendBeacon | null>(null);
  const [nextPlannedDate, setNextPlannedDate] = useState<Date | null>(null);
  const [plannedMessage, setPlannedMessage] = useState<string>(DEFAULT_BEACON_MESSAGE);
  const [plannedTimeHHmm, setPlannedTimeHHmm] = useState<string | null>(null);

  // Modal state (options + details)
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsRendered, setOptionsRendered] = useState(false);
  // OS "Reduce Motion": when on, the options sheet snaps instead of sliding (matches the Back-restore path).
  const [reduceMotion, setReduceMotion] = useState(false);
  const optionsAnim = useRef(new Animated.Value(0)).current;
  const [kbVisible, setKbVisible] = useState(false);
  const [dayOffset, setDayOffset] = useState<number>(0); // 0..6 selected chip
  const [timeHourInput, setTimeHourInput] = useState<string>("");   // 1..12 as typed
  const [timeMinuteInput, setTimeMinuteInput] = useState<string>(""); // 00..59 as typed
  const [timeMeridiem, setTimeMeridiem] = useState<"AM" | "PM">("PM"); // beacons are evening hangouts: default PM

  // Inline error: only the range-violation case, and only once a field has
  // 2 characters in it. Don't warn about "missing the other field", typing
  // hour first then minutes is the normal flow and shouldn't be flagged.
  const timeRangeError = useMemo<string | null>(() => {
    if (timeHourInput.length === 2) {
      const hn = parseInt(timeHourInput, 10);
      if (!Number.isFinite(hn) || hn < 1 || hn > 12) return "Hour must be 1–12.";
    }
    if (timeMinuteInput.length === 2) {
      const mn = parseInt(timeMinuteInput, 10);
      if (!Number.isFinite(mn) || mn < 0 || mn > 59) return "Minutes must be 0–59.";
    }
    return null;
  }, [timeHourInput, timeMinuteInput]);
  const [message, setMessage] = useState<string>(DEFAULT_BEACON_MESSAGE);
  const [selectedBeacon, setSelectedBeacon] = useState<FriendBeacon | null>(null);
  const [selectedBeaconMessageId, setSelectedBeaconMessageId] = useState<string | undefined>(undefined);
  // Coach-mark tour: target refs to spotlight + the tour controller.
  const { startTour, updateStepById, isActive, currentStepId, currentStepTarget, goToTarget, navDir, advance, advanceFromStepId, back, restart, endTour } = useTour();
  // Mirrored into a ref so non-reactive code (doc-sync callbacks) can read the live tour state.
  const tourActiveRef = useRef(isActive);
  tourActiveRef.current = isActive;
  // Mirror the tour nav direction into a ref so the sheet animation can read it without re-running on
  // every nav. On a BACK navigation the sheet RESTORES (snaps) instead of replaying its open slide.
  const navDirRef = useRef(navDir);
  navDirRef.current = navDir;
  // Base-setup progress (username + friend + notifications) drives the resume banner.
  const onboarding = useOnboarding();
  const logsRef = useTourTarget('beacon-logs');
  const optionsCtaRef = useTourTarget('beacon-options-cta');
  const dayRef = useTourTarget('sheet-day');
  const timeRef = useTourTarget('sheet-time');
  const groupsRef = useTourTarget('sheet-groups');
  const messageRef = useTourTarget('sheet-message');
  // Wraps day + time + friend groups + message so the tour can highlight them as ONE step.
  const sheetFieldsRef = useTourTarget('sheet-fields');
  const beaconStyleRef = useTourTarget('beacon-style');
  const chatTarget = useTourTarget('beacon-chat');
  // The home page View, the coordinate basis for the fire/smoke layers. Both <Svg> layers are
  // position:absolute top:0 left:0 inside styles.page, so we measure the logs RELATIVE TO this view
  // (logs window pos − page window pos). That collapses the whole nesting chain into one offset and
  // is immune to safe-area insets / padding above. REQUIRES styles.page to keep paddingTop:0 and
  // paddingHorizontal:0 with no border, or the flame lands off the logs.
  // Selected beacon SKIN (device-local pref; default campfire, DEFAULT_SKIN_ID), drives scene,
  // fire, smoke, and structure.
  const [skinId, setSkinId] = useState(DEFAULT_SKIN_ID);
  const skin = getSkin(skinId);
  // Live style preview in the options sheet: opens on any style tap, closes with its X or the sheet.
  const [stylePreviewOpen, setStylePreviewOpen] = useState(false);
  useEffect(() => {
    if (!optionsOpen) setStylePreviewOpen(false);
  }, [optionsOpen]);
  useEffect(() => {
    let mounted = true;
    getBeaconSkinId().then((id) => mounted && setSkinId(id));
    const off = onBeaconSkinChange((id) => setSkinId(id));
    return () => { mounted = false; off(); };
  }, []);

  const pageRef = useRef<View>(null);
  // The measure stores only the ORIGIN-INDEPENDENT box geometry (top + height); the flame seat is
  // derived at render time as top + h * skin.origin. That way a live skin switch (different origin)
  // moves the anchor in the SAME render as the new skin, instead of showing the new scene against
  // the old skin's seat for several frames until an async re-measure lands.
  const [beaconAnchor, setBeaconAnchor] = useState({ x: 0, top: 0, h: 180, measured: false });
  const measureBeaconAnchor = useCallback(() => {
    const logs = logsRef.current;
    const page = pageRef.current;
    if (!logs || !page) return;
    let tries = 0;
    // Defer a frame so both views' layout is committed before we read geometry; on a transient
    // zero-width read (seen on Android during the first layout pass) retry a few frames so the
    // anchor self-heals rather than leaving the fire/smoke un-rendered for the session.
    const attempt = () => {
      logs.measureInWindow((lx, ly, lw, lh) => {
        if (!lw) {
          if (tries++ < 8) requestAnimationFrame(attempt);
          return;
        }
        page.measureInWindow((px, py) => {
          setBeaconAnchor({ x: lx - px + lw / 2, top: ly - py, h: lh, measured: true });
        });
      });
    };
    requestAnimationFrame(attempt);
  }, [logsRef]);
  // Re-measure when the window changes (rotation, or the safe-area inset settling after first paint),
  // since the logs View's onLayout won't necessarily re-fire if only its window position shifts.
  // Skin changes need no re-measure: origin is applied at render time and the box doesn't move.
  const { width: winW, height: winH } = useWindowDimensions();
  useEffect(() => {
    measureBeaconAnchor();
  }, [winW, winH, measureBeaconAnchor]);
  const anchorY = beaconAnchor.top + beaconAnchor.h * skin.origin;

  // Fire SFX (device-local "Fire sounds" pref, default off). ignite + haptic fire from the lit-edge
  // effect below (works for ALL skins, incl. the flameless photo-beacons); the crackle loop tracks the
  // lit state. Needs a native build (expo-audio).
  const [fireSoundOn, setFireSoundOn] = useState(true); // default ON; pref read confirms below
  const [soundLoaded, setSoundLoaded] = useState(false); // gate so a muted user gets NO crackle blip on cold start
  useEffect(() => {
    let mounted = true;
    getFireSoundEnabled().then((v) => {
      if (!mounted) return;
      setFireSoundOn(v);
      setSoundLoaded(true);
    });
    const off = onFireSoundChange((v) => setFireSoundOn(v));
    return () => { mounted = false; off(); };
  }, []);
  const fireSound = useFireSound(fireSoundOn, skin);
  // Drive crackle loop + ignition (sound + haptic) from the lit state here, so it works for ALL skins
  // (incl. the lantern tower, which renders no flame layer). Ignite only on a real false→true light.
  // GATED ON SCREEN FOCUS: the Home tab stays mounted when you switch tabs, so without this the fire
  // sound would keep playing on Feed/Friends/etc. On blur the crackle stops; on return it resumes
  // (no re-ignite, focus changes don't flip `was`).
  const isFocused = useIsFocused();
  const prevLitForSoundRef = useRef(isLit);
  useEffect(() => {
    const was = prevLitForSoundRef.current;
    prevLitForSoundRef.current = isLit;
    if (!soundLoaded) return; // wait for the pref so a muted user never hears a startup blip
    fireSound.setLit(!!isLit && isFocused);
    if (isLit && was === false && isFocused) {
      fireSound.playIgnite();
      success();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLit, fireSoundOn, soundLoaded, isFocused]);
  // Whether the user has ≥1 friend, read when the tour is built so it can drop the "Add Brian"
  // step (that card only renders at zero friends). `friendsLoaded` gates auto-start so the tour is
  // NEVER built before the count is known (the old race kept add-brian in for users who have
  // friends, then auto-skipped its missing target).
  const hasFriendsRef = useRef(false);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    // Use the SAME source the Friends screen's "Add Brian" card gates on (accepted FriendEdges,
    // symmetric: both parties are in `uids`), so the step is dropped exactly when the card won't
    // render. The error branch still flips friendsLoaded so an offline cold start can't wedge the
    // tour from ever auto-starting (unknown count → treat as none, which just keeps add-brian).
    const qEdges = query(
      collection(db, 'FriendEdges'),
      where('uids', 'array-contains', uid),
      where('state', '==', 'accepted')
    );
    const unsub = onSnapshot(
      qEdges,
      (snap) => {
        hasFriendsRef.current = snap.size > 0;
        setFriendsLoaded(true);
      },
      (e) => {
        if (__DEV__) console.warn('friends-count listener error', e);
        hasFriendsRef.current = false;
        setFriendsLoaded(true);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  // First-time notification onboarding prompted after a user creates a beacon
  // while OS-level notification permission is not yet granted. Explains
  // beacon-specific notifications (RSVPs + chat) before opening the OS prompt.
  const [showBeaconNotifOnboarding, setShowBeaconNotifOnboarding] = useState(false);
  const [beaconNotifBusy, setBeaconNotifBusy] = useState(false);

  // Fire-and-forget: if OS notification permission is undetermined or denied,
  // show the beacon-specific onboarding modal. Called from both beacon-creation
  // paths (toggleBeacon's "Light" branch and saveBeaconOptions).
  const maybePromptForBeaconNotifications = async () => {
    // Never pop over the tour: the tour's own scripted light/save calls this, and its notifications
    // step already handles permission. The modal would otherwise cover the coach-mark.
    if (isActive) return;
    try {
      const perm = await Notifications.getPermissionsAsync();
      // 'granted' is true on iOS once allowed. On Android the boolean is the
      // canonical signal too. If granted, skip, user has already opted in.
      if (perm.granted) return;
      setShowBeaconNotifOnboarding(true);
    } catch {
      // If the permissions check itself fails, don't block the beacon flow.
    }
  };

  // Prefetch messages for the user's own active beacon so tapping
  // "Open my beacon details" renders chat instantly from cache.
  usePrefetchBeaconMessages([myActiveBeacon?.id]);

  // Deep link: open beacon chatroom from notification
  useEffect(() => {
    const bid = params.beaconId;
    if (!bid) return;
    const mid = params.messageId || undefined;
    // Clear the params so they don't re-trigger
    router.setParams({ beaconId: undefined as any, messageId: undefined as any });
    // Fetch beacon data and open modal
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'Beacons', bid));
        if (!snap.exists()) {
          if (__DEV__) console.warn('Beacon deep link: doc not found', bid);
          Alert.alert('Beacon unavailable', 'This beacon is no longer active.');
          return;
        }
        const d: any = snap.data();
        // An old notification can outlive the beacon: if it was put out or its day has passed,
        // say so instead of dropping the user into a dead chat room.
        const expMs = getMillis(d?.expiresAt);
        if (d?.active !== true || (expMs && expMs < Date.now())) {
          Alert.alert('Beacon ended', 'This beacon is gone, so its chat is closed.');
          return;
        }
        const stMs = getMillis(d?.startAt);
        setSelectedBeacon({
          id: bid,
          ownerUid: d?.ownerUid || '',
          displayName: d?.ownerName || '',
          startAt: stMs ? new Date(stMs) : new Date(),
          active: d?.active === true,
          scheduled: d?.scheduled === true,
          message: d?.message || '',
        });
        setSelectedBeaconMessageId(mid);
      } catch (err) {
        if (__DEV__) console.warn('Beacon deep link: fetch failed', bid, err);
        Alert.alert('Beacon unavailable', 'This beacon is no longer active.');
      }
    })();
  }, [params.beaconId, params.messageId]);

  // Friend groups state for scheduler
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  // True while the tour is on the final guided-first-beacon step. On that step the group selection is
  // FORCED to just the test group (so the "set to your test group" copy is true and the demo beacon
  // notifies no one), so the live beacon snapshot below must not overwrite it with a beacon's groups.
  const onFirstBeaconStepRef = useRef(false);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // ---------- SUBSCRIBE: your beacon(s) (next 7 days) ----------
  // Day anchors are STATE, not one-shot useMemo: Home stays mounted overnight, so after midnight the
  // beacon query window, the day chips, and the relight dates all go a day stale. We recompute them
  // when the calendar day actually changes: on every AppState 'active' (returning to the app), and via
  // a timer armed for the next local 00:00 (re-armed each time it fires). All dependent effects key off
  // these values and resubscribe when they change.
  const [dayAnchor, setDayAnchor] = useState(() => computeDayAnchor());
  const { todayStart, windowEnd, next7Days } = dayAnchor;
  const dayKeyRef = useRef(dayAnchor.dayKey);
  dayKeyRef.current = dayAnchor.dayKey;
  useEffect(() => {
    // Refresh anchors only when the local calendar day has actually rolled over (cheap no-op otherwise,
    // so an AppState 'active' on the same day never resubscribes every query).
    const refreshIfDayChanged = () => {
      const next = computeDayAnchor();
      if (next.dayKey !== dayKeyRef.current) setDayAnchor(next);
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const armMidnight = () => {
      if (timer) clearTimeout(timer);
      const now = new Date();
      const nextMidnight = startOfDay(new Date());
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      // +1s cushion so we're safely past 00:00 when it fires, capped so a large clock jump/DST can't
      // overflow setTimeout's 32-bit delay (falls back to a re-check within ~24h).
      const ms = Math.min(Math.max(nextMidnight.getTime() - now.getTime() + 1000, 1000), 24 * 3600 * 1000);
      timer = setTimeout(() => {
        refreshIfDayChanged();
        armMidnight(); // re-arm for the following midnight
      }, ms);
    };
    armMidnight();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshIfDayChanged();
        armMidnight(); // the timer may have been throttled while backgrounded; re-arm from now
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setIsLit(false);
      setMyActiveBeacon(null);
      setNextPlannedDate(null);
      setPlannedMessage(DEFAULT_BEACON_MESSAGE);
      return;
    }

    const qMine = query(
      collection(db, 'Beacons'),
      where('ownerUid', '==', user.uid),
      where('startAt', '>=', Timestamp.fromDate(todayStart)),
      where('startAt', '<=', Timestamp.fromDate(windowEnd))
    );

    const unsub = onSnapshot(
      qMine,
      (snap) => {
        let activeDoc: { id: string; data: any } | undefined;
        let plannedSoonest: { id: string; data: any; start: Date } | undefined;

        snap.forEach((d) => {
          const data: any = d.data();
          const stMs = getMillis(data?.startAt);
          if (!stMs) return;
          const st = new Date(stMs);

          if (data?.active) {
            if (
              !activeDoc ||
              getMillis(data?.updatedAt) > getMillis(activeDoc.data?.updatedAt)
            ) {
              activeDoc = { id: d.id, data };
            }
          } else if (data?.scheduled === true || data?.scheduled === 'true') {
            if (!plannedSoonest || st.getTime() < plannedSoonest.start.getTime()) {
              plannedSoonest = { id: d.id, data, start: st };
            }
          }
        });

        if (activeDoc) {
          const stMs = getMillis(activeDoc.data?.startAt);
          const msg =
            (typeof activeDoc.data?.message === 'string' && activeDoc.data.message.trim()) ||
            (typeof activeDoc.data?.details === 'string' && activeDoc.data.details.trim()) ||
            DEFAULT_BEACON_MESSAGE;

          const activeTime =
            typeof activeDoc.data?.timeHHmm === 'string' ? activeDoc.data.timeHHmm : null;
          // Keep the persisted time tracking the lit beacon so it survives an on/off toggle
          // (mirrors plannedMessage). Without this the time was wiped when the beacon turned off.
          setPlannedTimeHHmm(activeTime);
          setMyActiveBeacon({
            id: activeDoc.id,
            ownerUid: user.uid,
            displayName: 'You',
            startAt: new Date(stMs),
            active: true,
            scheduled:
              activeDoc.data?.scheduled === true || activeDoc.data?.scheduled === 'true',
            message: msg,
            timeHHmm: activeTime,
          });
          setIsLit(true);
          setPlannedMessage(msg);
          // Mirror the doc's groups EXACTLY, including the tutorial test group. Filtering test out
          // here made the sheet lie: a deliberately test-scoped beacon showed no group selected, and
          // the next save silently wrote groupIds [] (= all friends). Never overwrites the forced
          // test-only selection while a tour runs (tourActiveRef).
          const gids: string[] = Array.isArray(activeDoc.data?.groupIds)
            ? activeDoc.data.groupIds.filter((x: any) => typeof x === 'string')
            : [];
          if (!onFirstBeaconStepRef.current && !tourActiveRef.current) setSelectedGroupIds(gids);
        } else {
          setMyActiveBeacon(null);
          setIsLit(false);
        }

        if (plannedSoonest) {
          const stMs = getMillis(plannedSoonest.data?.startAt);
          setNextPlannedDate(new Date(stMs));
          const msg =
            (typeof plannedSoonest.data?.message === 'string' &&
              plannedSoonest.data.message.trim()) ||
            (typeof plannedSoonest.data?.details === 'string' &&
              plannedSoonest.data.details.trim()) ||
            DEFAULT_BEACON_MESSAGE;
          setPlannedMessage(msg);
          setPlannedTimeHHmm(
            typeof plannedSoonest.data?.timeHHmm === 'string' ? plannedSoonest.data.timeHHmm : null,
          );

          // Mirror the doc's groups exactly (see the active branch above for why test is NOT filtered).
          const gids: string[] = Array.isArray(plannedSoonest.data?.groupIds)
            ? plannedSoonest.data.groupIds.filter((x: any) => typeof x === 'string')
            : [];
          if (!onFirstBeaconStepRef.current && !tourActiveRef.current) setSelectedGroupIds(gids);
        } else {
          setNextPlannedDate(null);
          // Do NOT wipe the time here: when a beacon is lit (active but no separate scheduled doc)
          // or just extinguished, this branch runs, and clearing it was what erased the time across
          // an on/off toggle. The active branch above and the planned branch keep it current; it
          // stays sticky like plannedMessage otherwise.
        }
      },
      (e) => {
        if (__DEV__) console.warn('mine onSnapshot error:', e);
        setIsLit(false);
        setMyActiveBeacon(null);
        setNextPlannedDate(null);
        setPlannedMessage(DEFAULT_BEACON_MESSAGE);
      }
    );

    return () => unsub();
  }, [todayStart, windowEnd]);

  useEffect(() => {
    // Silent refresh: only saves if permission already granted.
    syncPushTokenIfGranted();
  }, []);

  useEffect(() => {
    const onFocus = () => {
      // If the user has since granted permission in Settings, this will update the token.
      syncPushTokenIfGranted();
    };
    // The 'change' event delivers the next state as a plain string, not an event object; the old
    // `({ type })` destructuring made this handler never fire.
    const subState = AppState.addEventListener('change', (state) => {
      if (state === 'active') onFocus();
    });
    return () => {
      subState.remove();
    };
  }, []);

  // keep details modal live
  useEffect(() => {
    if (!selectedBeacon) return;
    const unsub = onSnapshot(doc(db, 'Beacons', selectedBeacon.id), (snap) => {
      if (!snap.exists()) {
        setSelectedBeacon(null);
        return;
      }
      const data: any = snap.data();
      const stMs = getMillis(data?.startAt);
      const msg =
        (typeof data?.message === 'string' && data.message.trim()) ||
        (typeof data?.details === 'string' && data.details.trim()) ||
        DEFAULT_BEACON_MESSAGE;

      setSelectedBeacon((prev) =>
        prev && stMs
          ? {
              ...prev,
              startAt: new Date(stMs),
              active: !!data?.active,
              scheduled: data?.scheduled === true || data?.scheduled === 'true',
              message: msg,
            }
          : prev
      );
    });
    return () => unsub();
  }, [selectedBeacon?.id]);

  // Chips for the next 7 days (for Options Modal) come from dayAnchor.next7Days so they refresh at
  // midnight alongside the query window (see the day-anchor state above).

  // Load friend groups, **skip unnamed groups** (no "Untit empty Group" fallback)
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setGroups([]);
      return;
    }
    setLoadingGroups(true);

    const qGroups = query(collection(db, 'FriendGroups'), where('ownerUid', '==', user.uid));
    const unsub = onSnapshot(
      qGroups,
      (snap) => {
        const mapped = snap.docs.map((d) => {
          const data: any = d.data();
          const rawMembers: any[] = data?.memberUids || data?.members || data?.memberIds || [];
          const memberUids = Array.isArray(rawMembers)
            ? rawMembers
                .map((m) => (typeof m === 'string' ? m : typeof m?.uid === 'string' ? m.uid : null))
                .filter(Boolean) as string[]
            : [];

          const name = (data?.name || data?.title || '').toString().trim();
          if (!name) return null; // skip unnamed groups entirely

          return { id: d.id, name, memberUids } as FriendGroup;
        });

        const arr: FriendGroup[] = (mapped.filter(Boolean) as FriendGroup[]).sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        setGroups(arr);
        setLoadingGroups(false);
      },
      () => {
        setGroups([]);
        setLoadingGroups(false);
      }
    );
    return () => unsub();
  }, []);

  // open options with prefill
  const openOptions = () => {
    tap();
    const baseToday = startOfDay(new Date());
    let srcDate: Date | null = null;
    let srcMsg: string = DEFAULT_BEACON_MESSAGE;
    let srcTime: string | null = null;

    if (myActiveBeacon) {
      srcDate = startOfDay(myActiveBeacon.startAt);
      srcMsg = myActiveBeacon.message || DEFAULT_BEACON_MESSAGE;
      srcTime = myActiveBeacon.timeHHmm ?? null;
    } else if (nextPlannedDate) {
      srcDate = startOfDay(nextPlannedDate);
      srcMsg = plannedMessage || DEFAULT_BEACON_MESSAGE;
      srcTime = plannedTimeHHmm;
    } else {
      srcDate = baseToday;
    }

    let diffDays = Math.round((srcDate.getTime() - baseToday.getTime()) / (24 * 3600 * 1000));
    if (diffDays < 0) diffDays = 0;
    if (diffDays > 6) diffDays = 6;

    setDayOffset(diffDays);
    setMessage(srcMsg);

    const parsedTime = parseTimeHHmm(srcTime);
    if (parsedTime) {
      setTimeHourInput(parsedTime.hour);
      setTimeMinuteInput(parsedTime.minute);
      setTimeMeridiem(parsedTime.meridiem);
    } else {
      setTimeHourInput('');
      setTimeMinuteInput('');
      setTimeMeridiem('PM');
    }

    setOptionsOpen(true);
  };

  // A private "test" friend group (no members → lighting a beacon to it notifies nobody), so a new
  // user can try the whole flow without spamming friends. Uses a RESERVED id (double underscore, the
  // group editor slugifies names with single dashes, so it can never collide with a user group named
  // "test") and only CREATES when missing, so it never clobbers an existing doc's members. It's also
  // hidden from the Friends groups list (see app/friends.tsx) so users can't add members to it.
  const ensureTestGroup = useCallback(async (): Promise<string | null> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    const id = `${uid}__tutorial_test`;
    try {
      const ref = doc(db, 'FriendGroups', id);
      // The FriendGroups read rule (query-safe) denies a get on a NON-existent group, so treat a
      // failed/denied read as "does not exist" and create it. An existing group owned by me reads
      // fine (owner branch), so this only creates when genuinely missing; the group is always
      // memberless so a redundant write is harmless.
      let exists = false;
      try {
        exists = (await getDoc(ref)).exists();
      } catch {
        exists = false;
      }
      if (!exists) {
        await setDoc(ref, {
          ownerUid: uid, name: 'test', memberUids: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
    } catch (e) {
      if (__DEV__) console.warn('ensureTestGroup', e);
    }
    return id;
  }, []);

  // THE tutorial-safety net: whenever a tour is running on THIS home instance, the selection is
  // test-only. The tour-start preselection alone was not enough: the tour navigates across screens,
  // and a home remount wiped the in-memory selection to [] (= all friends), so a tutorial beacon
  // once notified a brand-new user's real friend. Runs on mount and on tour start.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!isActive || !uid) return;
    setSelectedGroupIds([`${uid}__tutorial_test`]);
    ensureTestGroup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // Belt to the braces above: the WRITE-time scope. Any beacon written while a tour runs is
  // test-scoped no matter what the local selection state says.
  const tourSafeGroupIds = (): string[] => {
    const uid = auth.currentUser?.uid;
    if (isActive && uid) return [`${uid}__tutorial_test`];
    return selectedGroupIds;
  };

  // Guided first beacon (final tour step): pre-fill the test message, default to today, and select the
  // "test" group (notifies no one). It does NOT open the options sheet: the step is completed by LIGHTING
  // the beacon (tapping the structure, which writes active:true), Saving the sheet only schedules an
  // inactive/planned beacon and does NOT ungate Done. Leaving the sheet closed keeps the lighthouse (and
  // its "light your beacon" hint) visible so the gating action isn't buried. Seeds ONCE per tour run.
  const firstBeaconSeededRef = useRef(false);
  const startFirstBeacon = () => {
    if (firstBeaconSeededRef.current) return;
    firstBeaconSeededRef.current = true;
    setMessage(FIRST_BEACON_INTRO);
    setPlannedMessage(FIRST_BEACON_INTRO);
    setDayOffset(0);
    setTimeHourInput('');
    setTimeMinuteInput('');
    setTimeMeridiem('PM');
    // Select the test group SYNCHRONOUSLY by its deterministic id so even an instant light/Save is
    // scoped to it (groupIds=[testId] → server notifies no one, even before the group doc loads, since
    // its members resolve to just the owner). ensureTestGroup() creates the doc in the background.
    const uid = auth.currentUser?.uid;
    setSelectedGroupIds(uid ? [`${uid}__tutorial_test`] : []);
    ensureTestGroup();
  };

  // Whether the user has no beacon yet (drives the first-beacon prompt + label).
  const hasNoBeaconYet = !isLit && !myActiveBeacon && !nextPlannedDate;

  // From the tutorial's notifications step: get OS permission, and on success opt the user into
  // beacon notifications from all friends (the master toggle), so future friends are covered.
  const enableBeaconNotifications = async () => {
    const granted = await ensureNotifyPermission(
      'Turn on notifications so you know the moment a friend lights a beacon.'
    );
    if (!granted) return; // ensureNotifyPermission emits the permission-change signal on grant
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await setDoc(
        doc(db, 'Profiles', uid),
        { notifyAllBeacons: true, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch {
      // Non-fatal: permission is granted; the master toggle can still be set in Friends/Settings.
    }
  };

  // Build the tour ctx from LIVE state. Used by startBeaconTour AND as the fallback for the live
  // step-update effect: a mid-tour home REMOUNT nulls tourCtxRef, and the gated steps
  // (username/friend/light) must still be able to unlock. Mirrors the set-first-beacon hardening:
  // never let a home-local ref silently kill a live update.
  const buildLiveTourCtx = (): BeaconTourCtx => {
    const uDone0 = !!onboarding.steps.find((st) => st.key === 'username')?.done;
    const fDone0 = !!onboarding.steps.find((st) => st.key === 'friend')?.done;
    const beaconLit0 = !!isLit || !!myActiveBeacon; // currently lit/active (NOT a stale planned one)
    const tourCtx: BeaconTourCtx = {
      openSheet: () => setOptionsOpen(true),
      closeSheet: () => setOptionsOpen(false),
      goFriends: () => router.navigate('/friends'),
      goHome: () => router.navigate('/home'),
      goSettings: () => router.navigate('/settings'),
      // The notifications step lives on /settings; jump back Home before opening the beacon sheet.
      openFirstBeacon: () => openFirstBeaconCb.current(),
      hasFriends: hasFriendsRef.current,
      tapNoun: skin.tap.noun, // step 1 copy adapts to the current skin ("Tap the lighthouse …")
      // Spotlight headroom over the structure box: the solid flame body tops out at roughly
      // 170*flameScale px above the seat, which sits 180*origin below the box top; +12 covers the
      // flickering tip. Flameless skins keep the original 70.
      holePadTop: skin.fire === 'flame' || skin.fire === 'print' || skin.fire === 'pyre' ? Math.max(70, Math.ceil(170 * skin.flameScale - 180 * skin.origin) + 12) : 70,
      beaconLit: beaconLit0,
      usernameDone: uDone0,
      friendDone: fDone0,
      online,
      onEnableNotifications: enableBeaconNotifications,
      // The green "Speed tour" button (step 1) swaps the running tour to the short path in place.
      onSpeedTour: () => restart(buildSpeedTour(tourCtx)),
      // Speed-tour step 1 Back: return to the full tour at its step 1 (the steps already built).
      onExitSpeedTour: () => restart(builtBeaconStepsRef.current ?? buildBeaconTour(tourCtx)),
    };
    return tourCtx;
  };

  // Start (or replay) the beacon coach-mark tour. `startAtTarget` lets the resume banner jump to
  // the earliest incomplete setup step.
  const pendingStartTargetRef = useRef<string | undefined>(undefined);
  const pendingStartStepIdRef = useRef<string | undefined>(undefined);
  // The built steps + whether the final step is the GATED guided-first-beacon variant, so the live
  // effect below can refresh that one step (checklist + Done gate) via updateStepById without rebuilding
  // the whole array (which could shift indices if the add-brian step's presence changed mid-tour).
  const builtBeaconStepsRef = useRef<TourStep[] | null>(null);
  // The ctx the running tour was built with; the live speed-step gates re-make steps from it.
  const tourCtxRef = useRef<BeaconTourCtx | null>(null);
  // Sticky: latches true once the user has a username + a friend + a LIT beacon, all during this run.
  // Once true the final step shows the celebratory wrap-up with Done enabled, and STAYS there even if
  // the beacon is later put out.
  const reachedRef = useRef(false);
  const lastGateSigRef = useRef('');
  // First-skip hint: distinguish a finish from a skip (onClose fires for both) so we can, on the very
  // first skip before the tour was ever completed, tell the user how to reopen it.
  const didFinishTourRef = useRef(false);
  const [showSkipHint, setShowSkipHint] = useState(false);
  // Once-only "who will see this beacon" confirm on the FIRST beacon lit after the first tour (finish or
  // skip). Loaded from storage on mount; armed when the tour ends; consumed on that first light.
  const firstTourDoneRef = useRef(false);
  const audienceSeenRef = useRef(false);
  useEffect(() => {
    let mounted = true;
    Promise.all([getSeen('first_tour_done'), getSeen('beacon_audience_seen')]).then(([t, a]) => {
      if (!mounted) return;
      firstTourDoneRef.current = t;
      audienceSeenRef.current = a;
    });
    return () => { mounted = false; };
  }, []);
  const openFirstBeaconCb = useRef(() => { router.navigate('/home'); startFirstBeacon(); });
  openFirstBeaconCb.current = () => { router.navigate('/home'); startFirstBeacon(); };
  // Celebratory final step's onEnter: just go home and close the sheet (don't seed a new beacon).
  const onEnterDoneCb = useRef(() => { router.navigate('/home'); setOptionsOpen(false); });
  onEnterDoneCb.current = () => { router.navigate('/home'); setOptionsOpen(false); };
  const startBeaconTour = (opts?: { startAtTarget?: string; startAtStepId?: string }) => {
    // Never build the tour before the friend count is known, otherwise the add-brian step can be
    // wrongly kept (the auto-start/resume/banner/help entry points all funnel through here). Defer
    // via the pendingAutoStart machinery, which re-fires this once isLit + friendsLoaded are ready
    // (remembering the requested jump target across the defer).
    if (!friendsLoaded) {
      pendingStartTargetRef.current = opts?.startAtTarget;
      pendingStartStepIdRef.current = opts?.startAtStepId;
      setPendingAutoStart(true);
      return;
    }
    const tourCtx = buildLiveTourCtx();
    const builtSteps = buildBeaconTour(tourCtx);
    builtBeaconStepsRef.current = builtSteps;
    tourCtxRef.current = tourCtx; // the live speed-step updates below rebuild steps from this
    reachedRef.current = tourCtx.usernameDone && tourCtx.friendDone && tourCtx.beaconLit; // start latched if already fully done
    lastGateSigRef.current = ''; // force the live effect to (re)apply for this run
    firstBeaconSeededRef.current = false; // re-seed the first-beacon sheet once for this run
    didFinishTourRef.current = false;
    // Preselect the TEST group for the WHOLE tour, so any beacon lit during it (step 1 demo or the
    // finale) is scoped to test and notifies no one. ensureTestGroup creates the empty, owner-only
    // group doc in the background; even before it loads the server resolves the audience to no one.
    const tourUid = auth.currentUser?.uid;
    if (tourUid) setSelectedGroupIds([`${tourUid}__tutorial_test`]);
    ensureTestGroup();
    startTour(builtSteps, {
      startAtTarget: opts?.startAtTarget,
      startAtStepId: opts?.startAtStepId,
      // Replay if the tour has ended at least once before (finish or skip): the dismiss button then
      // reads "Close" instead of "Skip tour". Captured now, before onClose flips the ref.
      isReplay: firstTourDoneRef.current,
      onFinish: () => {
        didFinishTourRef.current = true;
        success();
        setSeen('beacon');
      },
      onClose: () => {
        builtBeaconStepsRef.current = null;
        reachedRef.current = false;
        firstBeaconSeededRef.current = false;
        // NOTE: the group selection is deliberately NOT touched here. It mirrors the beacon doc
        // (test group included), and the light confirm (describeAudience) tells the user when a
        // beacon is test-scoped, so nothing is silently re-scoped behind their back.
        // Arm the one-time "who will see this" confirm for the first beacon lit AFTER this tour (the
        // tour ending, by finish OR skip, is what arms it, so even users who skip get warned once).
        setSeen('first_tour_done');
        firstTourDoneRef.current = true;
        // On the FIRST skip (tour never completed before), show a one-time hint about reopening it.
        const wasSkip = !didFinishTourRef.current;
        didFinishTourRef.current = false;
        if (wasSkip) {
          Promise.all([getSeen('beacon'), getSeen('skip_hint')]).then(([completed, hinted]) => {
            if (!completed && !hinted) {
              setShowSkipHint(true);
              setSeen('skip_hint');
            }
          });
        }
      },
    });
  };

  // Primitive done-flags so the live-gate effect depends on booleans, not the fresh onboarding.steps
  // array each render (which would re-run the effect body on unrelated OnboardingProvider re-renders).
  const obUsernameDone = !!onboarding.steps.find((st) => st.key === 'username')?.done;
  const obFriendDone = !!onboarding.steps.find((st) => st.key === 'friend')?.done;

  // Keep the gated final step live: as the user completes username/friend (earlier steps) and sets a
  // beacon (during this step), refresh that one step's checklist + Done gate in place. Drives off the
  // PROVIDER (isActive + updateStepById), NOT home-local refs: the tour navigates to /friends +
  // /settings, which REMOUNTS home and would reset the old home-local guard refs to their initial
  // values, so the old guard silently killed this effect for the rest of the tour (the "Light your
  // beacon" item never checked after visiting settings). updateStepById splices the provider's
  // own steps by id, so it works regardless of remounts. A signature guard keeps it a no-op unless the
  // gate inputs actually changed (updateStepById -> setSteps re-renders and would otherwise loop).
  // reachedRef/lastGateSigRef reset on a home remount, which is fine: the effect just recomputes them
  // from the live state on the next run and re-syncs the step.
  useEffect(() => {
    if (!isActive) return;
    const uDone = obUsernameDone;
    const fDone = obFriendDone;
    const beaconLit = !!isLit || !!myActiveBeacon;
    if (uDone && fDone && beaconLit) reachedRef.current = true; // sticky once fully complete
    const reached = reachedRef.current;
    const sig = `${uDone}|${fDone}|${beaconLit}|${reached}`;
    if (sig === lastGateSigRef.current) return;
    lastGateSigRef.current = sig;
    updateStepById(
      'set-first-beacon',
      makeFirstBeaconStep(
        { openFirstBeacon: () => openFirstBeaconCb.current(), onEnterDone: () => onEnterDoneCb.current() },
        { usernameDone: uDone, friendDone: fDone, beaconLit, reached }
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, obUsernameDone, obFriendDone, isLit, myActiveBeacon]);

  // While the tour sits on the final guided-first-beacon step, force the group selection to just the
  // test group (so the step's "set to your test group" copy is actually true and any beacon lit there
  // notifies no one), and drop it again when the user leaves that step. Transition-gated so earlier
  // steps keep the selection the tour started them with, and the snapshot guard above stops a beacon
  // load from overwriting the forced value while we're on the step.
  const prevOnFirstBeaconStepRef = useRef(false);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    const testId = uid ? `${uid}__tutorial_test` : null;
    const onStep = isActive && currentStepId === 'set-first-beacon';
    const was = prevOnFirstBeaconStepRef.current;
    prevOnFirstBeaconStepRef.current = onStep;
    onFirstBeaconStepRef.current = onStep;
    if (!testId) return;
    if (onStep && !was) {
      setSelectedGroupIds([testId]); // entered the step: test group only
    }
    // Leaving the step does NOT strip the test group anymore: the selection mirrors whatever the
    // beacon doc actually says, and the light confirm surfaces test scoping instead of hiding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentStepId]);

  // The final tour step is ALWAYS shown and completes only when the user taps Done. It's a single live
  // step: gated until username + friend + a lit beacon (reached), then the celebratory "you're all set"
  // variant with Done enabled (see makeFirstBeaconStep's `reached` branch). Tapping Done ends the tour
  // via onFinish (setSeen('beacon') + the success haptic).

  // If the user LIGHTS the beacon during tour step 1, opt into the chat mini-step (a branch) so we
  // explain the chat right there.
  // Edge-gated on a real false→true light: starting the tour with an already-lit beacon (e.g. the
  // help-button replay) must NOT jump straight to the branch, and stepping Back into step 1 must not
  // re-bounce. goToTarget pushes history (default), so Back from the chat mini-step returns to step 1.
  const prevLitForBranchRef = useRef(isLit);
  useEffect(() => {
    const wasLit = prevLitForBranchRef.current;
    prevLitForBranchRef.current = isLit;
    // STRICT false->true edge: on a home REMOUNT (any tour navigation back to home, e.g. Back out
    // of the speed tour) isLit starts as null while the beacon doc loads, and a loose `!wasLit`
    // read that null->true load as a fresh light, bouncing an already-lit beacon into this branch.
    if (isActive && currentStepId === 'light-beacon-demo' && isLit === true && wasLit === false && myActiveBeacon) {
      // Push history so Back from the chat mini-step returns to the fire/logs step (the edge-gate
      // above stops it from immediately re-branching when Back lands back on step 1).
      goToTarget('beacon-chat');
    }
  }, [isActive, currentStepId, isLit, myActiveBeacon, goToTarget]);

  // LIVE speed-tour steps: the username/friend gates ungray Next the moment the task is done, and
  // the single light step flips in place (tap-instruction with a grayed "Light your beacon" task ->
  // congratulations with Done + the beacon-plus-options highlight). updateStepById is a same-index
  // swap and a no-op when the id isn't in the running tour, so this is safe during the full tour.
  useEffect(() => {
    if (!isActive) return;
    // Fallback ctx rebuild: a mid-tour home remount nulls tourCtxRef, and without this the
    // username/friend/light gates could never unlock (Next stuck gray forever).
    const ctx = tourCtxRef.current ?? (tourCtxRef.current = buildLiveTourCtx());
    updateStepById('speed-username', makeSpeedUsernameStep(ctx, obUsernameDone));
    updateStepById('speed-friend', makeSpeedFriendStep(ctx, obFriendDone));
    updateStepById('speed-light', makeSpeedLightStep(ctx, isLit === true));
    updateStepById('full-username', makeFullUsernameStep(ctx, obUsernameDone));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, obUsernameDone, obFriendDone, isLit]);

  // Speed tour finale hand-off: the lit step-4 congrats says "Open Beacon options". Opening the
  // sheet COMPLETES the tour right there, so the sheet is fully usable instead of squeezed under
  // the coach-mark with its Save/Cancel outside the ring.
  useEffect(() => {
    if (isActive && currentStepId === 'speed-light' && isLit === true && optionsOpen) endTour(true);
  }, [isActive, currentStepId, isLit, optionsOpen, endTour]);

  // Keep the options sheet OPEN whenever the tour is on a sheet step, including when the user steps
  // BACK into one from a later screen. (The per-step onEnter's openSheet closure can be stale after a
  // Stack re-mount, so drive sheet-open from the CURRENT step on the live home instance.)
  useEffect(() => {
    const SHEET_TARGETS = ['beacon-style', 'sheet-fields'];
    if (isActive && currentStepTarget && SHEET_TARGETS.includes(currentStepTarget)) {
      setOptionsOpen(true);
    }
  }, [isActive, currentStepTarget]);

  // (The standalone one-step "beacon chat" explainer that used to live here was DELETED
  // 2026-07-24: its seen-flag was device-local, so every fresh install re-showed it to
  // established users, and it fired from a backgrounded Home while another screen (e.g. the
  // feed) was on top, ringing blank space. The chat mini-step inside the tour covers it.)

  // Decide ONCE whether to auto-pop the tour for a new user (the resume banner takes over after).
  // Skipped when arriving via a notification deep link so we don't cover the opened beacon, and
  // for an already-set-up user (username + friend + notifications) on a fresh install: their
  // device flags are wiped but they don't need onboarding thrown at them again.
  const [pendingAutoStart, setPendingAutoStart] = useState(false);
  const autoPopDecidedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (autoPopDecidedRef.current) return;
      if (params.beaconId) return;
      if (!onboarding.loaded) return; // wait until setup state is known; effect re-runs when it is
      autoPopDecidedRef.current = true;
      if (onboarding.allDone) {
        setSeen('beacon_intro'); // never auto-pop; the ? button still replays on demand
        return;
      }
      const [done, introShown] = await Promise.all([getSeen('beacon'), getSeen('beacon_intro')]);
      if (cancelled) return;
      if (!done && !introShown) {
        setPendingAutoStart(true);
        setSeen('beacon_intro');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding.loaded]);

  // Start the auto-shown tour only once Home's content (hence the spotlight targets) is mounted,
  // i.e. after isLit resolves, and the friend count is known. Also re-fires a deferred start
  // (banner/resume) once those are ready, preserving the requested jump target.
  useEffect(() => {
    if (pendingAutoStart && isLit !== null && friendsLoaded) {
      setPendingAutoStart(false);
      const t = pendingStartTargetRef.current;
      const sid = pendingStartStepIdRef.current;
      pendingStartTargetRef.current = undefined;
      pendingStartStepIdRef.current = undefined;
      startBeaconTour(sid ? { startAtStepId: sid } : t ? { startAtTarget: t } : undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoStart, isLit, friendsLoaded]);

  // Resume the tutorial when navigated here from the resume banner on another screen, optionally
  // jumping to the first incomplete step (?tourTarget=...) or straight to the final step by id
  // (?tourStepId=set-first-beacon, used by the Friends "add a friend" help card's Next).
  useEffect(() => {
    if (params.tutorial === '1') {
      const t = typeof params.tourTarget === 'string' ? params.tourTarget : undefined;
      const sid = typeof params.tourStepId === 'string' ? params.tourStepId : undefined;
      startBeaconTour(sid ? { startAtStepId: sid } : t ? { startAtTarget: t } : undefined);
      router.setParams({ tutorial: undefined as any, tourTarget: undefined as any, tourStepId: undefined as any });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tutorial]);

  // Track keyboard visibility so the options sheet can drop its home-indicator padding while
  // typing, keeps the Save/Cancel row tight to the keyboard's Done bar.
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKbVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Track OS Reduce Motion so the sheet can snap instead of slide.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  // Slide the options sheet in/out; keep it mounted through the exit animation. BACK navigation in the
  // tour (and OS Reduce Motion) RESTORE the prior state INSTANTLY: snap to the target with no slide, so
  // stepping Back into a sheet step shows the sheet already open instead of replaying its entrance.
  // Forward opens still animate.
  useEffect(() => {
    // Snap (no slide) when restoring via tour BACK, or whenever Reduce Motion is on. Gated on isActive
    // so a leftover 'back' direction after the tour ends never suppresses a normal sheet-open animation.
    const instant = (isActive && navDirRef.current === 'back') || reduceMotion;
    if (optionsOpen) {
      setOptionsRendered(true);
      if (instant) optionsAnim.setValue(1);
      else Animated.timing(optionsAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else if (instant) {
      optionsAnim.setValue(0);
      setOptionsRendered(false);
    } else {
      Animated.timing(optionsAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setOptionsRendered(false);
      });
    }
  }, [optionsOpen, optionsAnim, reduceMotion, isActive]);

  // Android hardware back closes the sheet instead of leaving the screen.
  useEffect(() => {
    if (!optionsOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOptionsOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [optionsOpen]);

  // toggle (off/on)
  // Describe WHO a beacon lit right now would reach, for the one-time post-tour confirmation.
  const describeAudience = (): { title: string; message: string } => {
    const me = auth.currentUser?.uid;
    const testId = me ? `${me}__tutorial_test` : null;
    const onlyTest = !!testId && selectedGroupIds.length === 1 && selectedGroupIds[0] === testId;
    if (onlyTest) {
      return {
        title: 'This is a test beacon',
        message:
          'Your beacon is set to your test group, so no friends will be notified. Open Beacon options and deselect the test group to send your beacon to all friends. Or add a friend group to send it to just them.',
      };
    }
    if (selectedGroupIds.length === 0) {
      return {
        title: 'Light beacon for all friends?',
        message: 'All of your friends will see this beacon and get a notification. Pick a friend group in Beacon options to share it with just some of them.',
      };
    }
    const names = groups.filter((g) => selectedGroupIds.includes(g.id)).map((g) => g.name).join(', ');
    return {
      title: `Light beacon for ${names}?`,
      message: `Only ${names} will see this beacon and get a notification.`,
    };
  };

  // Re-entrancy guard: without it, a queued double-confirm (two rapid Light taps) ran the write twice
  // and could create two active beacons. Set at the top, cleared in finally; the structure onPress and
  // the confirm handlers ignore re-entrant calls while it's set. A ref (read/set synchronously within a
  // single tap) plus mirrored state so the structure button can disable itself.
  const toggleBusyRef = useRef(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  // The actual write (light or extinguish), run after whichever confirmation the user sees.
  const performBeaconToggle = async () => {
          if (toggleBusyRef.current) return; // ignore re-entrant double-confirms
          toggleBusyRef.current = true;
          setToggleBusy(true);
          press();
          const user = auth.currentUser;
          if (!user) {
            Alert.alert('Error', 'User not authenticated');
            toggleBusyRef.current = false;
            setToggleBusy(false);
            return;
          }

          try {
            const beaconsRef = collection(db, 'Beacons');

            if (isLit && myActiveBeacon) {
              await updateDoc(doc(db, 'Beacons', myActiveBeacon.id), {
                active: false,
                scheduled: false,
                updatedAt: serverTimestamp(),
              });

              const d = startOfDay(myActiveBeacon.startAt);
              setNextPlannedDate(d);
              setPlannedMessage(myActiveBeacon.message || DEFAULT_BEACON_MESSAGE);

              const baseToday = startOfDay(new Date());
              let diffDays = Math.round((d.getTime() - baseToday.getTime()) / (24 * 3600 * 1000));
              if (diffDays < 0) diffDays = 0;
              if (diffDays > 6) diffDays = 6;
              setDayOffset(diffDays);

              setIsLit(false);
              setMyActiveBeacon(null);
            } else {
              // Tap-to-light must IGNORE any transient (possibly cancelled) sheet inputs: a user who
              // opened the sheet, changed the day/time, then hit Cancel/X/backdrop expects those edits
              // discarded. Use the planned beacon's date if one exists, else today; and the PERSISTED
              // planned time, never the raw sheet time fields. (Message already reads plannedMessage.)
              const base = startOfDay(new Date());
              const chosen = nextPlannedDate ? startOfDay(nextPlannedDate) : base;
              const sd = startOfDay(chosen);
              const ed = endOfDay(chosen);

              const ownerName = profile?.displayName || profile?.username || null;
              // Carry the clock time through the tap-to-light path (like the message + day), so it
              // persists across on/off and shows next to the date in the chat. Use only the PERSISTED
              // planned time, never the raw sheet inputs (which may be abandoned/cancelled edits).
              const timeHHmm = plannedTimeHHmm ?? null;

              // Reuse the SAME-DAY doc instead of addDoc'ing a fresh random-id beacon: the deterministic
              // `${uid}_${yyyymmdd}` id is what the sheet-save path writes, so relighting after an
              // extinguish lands on the SAME document. That keeps the day's chat history + "I'm in" RSVPs
              // intact across an off/on toggle and does not strand them under an orphaned doc.
              const yyyy = sd.getFullYear();
              const mm = String(sd.getMonth() + 1).padStart(2, '0');
              const dd = String(sd.getDate()).padStart(2, '0');
              const deterministicId = `${user.uid}_${yyyy}${mm}${dd}`;

              await setDoc(
                doc(db, 'Beacons', deterministicId),
                {
                  ownerUid: user.uid,
                  ownerName,
                  message: plannedMessage || DEFAULT_BEACON_MESSAGE,
                  details: plannedMessage || DEFAULT_BEACON_MESSAGE,
                  active: true,
                  scheduled: true,
                  createdAt: Timestamp.now(),
                  updatedAt: serverTimestamp(),
                  startAt: Timestamp.fromDate(sd),
                  expiresAt: Timestamp.fromDate(ed),
                  groupIds: tourSafeGroupIds(), // tour-time lights are ALWAYS test-scoped
                  // NOTE: allowedUids is intentionally NOT written. It used to embed the owner's
                  // friend uids in this world-readable doc (a friend-graph leak). The server now
                  // resolves the notification audience from groupIds + the private FriendGroups.
                  timeHHmm,
                },
                { merge: true }
              );

              // First-time creator might not have notification permission yet,
              // prompt them so they actually receive friend RSVPs and comments.
              maybePromptForBeaconNotifications();

              const qDay = query(
                beaconsRef,
                where('ownerUid', '==', user.uid),
                where('startAt', '>=', Timestamp.fromDate(sd)),
                where('startAt', '<=', Timestamp.fromDate(ed))
              );
              const snapDay = await getDocs(qDay);
              await Promise.all(
                snapDay.docs
                  .filter((b) => b.id !== deterministicId && b.data()?.active !== true)
                  .map((b) =>
                    updateDoc(b.ref, {
                      scheduled: false,
                      updatedAt: serverTimestamp(),
                    })
                  )
              );
            }
          } catch (err) {
            if (__DEV__) console.error('Error toggling beacon:', err);
            Alert.alert('Error', 'Failed to update beacon.');
          } finally {
            toggleBusyRef.current = false;
            setToggleBusy(false);
          }
  };

  const toggleBeacon = () => {
    if (toggleBusyRef.current) return; // an in-flight toggle: ignore rapid re-taps
    // The tour gets NO special-casing here: the final step is meant to be the real workflow, so the
    // same light/extinguish confirms show (native alerts render above the coach-mark just fine).
    if (isLit) {
      Alert.alert('Extinguish Beacon', 'Are you sure you want to extinguish your beacon?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Extinguish', style: 'destructive', onPress: performBeaconToggle },
      ]);
      return;
    }
    // First beacon lit AFTER the first tour: confirm who will see it, once. This is what warns a user
    // who skipped or rushed the tour before any real beacon reaches their friends.
    if (firstTourDoneRef.current && !audienceSeenRef.current) {
      const a = describeAudience();
      Alert.alert(a.title, a.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Light beacon',
          onPress: () => {
            audienceSeenRef.current = true;
            setSeen('beacon_audience_seen');
            performBeaconToggle();
          },
        },
      ]);
      return;
    }
    // Standard light confirm: reuse describeAudience() so it always shows WHO will see the beacon (not
    // just a static "Are you sure"), every time, not only on the one-time post-tour warning.
    const a = describeAudience();
    Alert.alert(a.title, a.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Light beacon', onPress: performBeaconToggle },
    ]);
  };

  // save options. Returns true if the save actually went through (so the tour can advance only then).
  const saveBeaconOptions = async (): Promise<boolean> => {
    press();
    const user = auth.currentUser;
    if (!user) return false;

    // Minutes are optional: an empty minute field means :00 (buildTimeHHmm fills it in).
    // Only minutes-without-an-hour is ambiguous enough to stop the save.
    const hTrim = timeHourInput.trim();
    const mTrim = timeMinuteInput.trim();
    if (!hTrim && mTrim) {
      Alert.alert('Time', 'Add an hour, or clear the time.');
      return false;
    }

    try {
      const base = startOfDay(new Date());
      const d = new Date(base);
      d.setDate(base.getDate() + dayOffset);
      const sd = startOfDay(d);
      const ed = endOfDay(sd);

      const beaconsRef = collection(db, 'Beacons');
      const ownerName = profile?.displayName || profile?.username || null;

      const timeHHmm = buildTimeHHmm(timeHourInput, timeMinuteInput, timeMeridiem);

      // allowedUids is intentionally NOT written (see the tap-to-light path): it embedded the owner's
      // friend uids in a world-readable doc. The server resolves the audience from groupIds now.
      if (isLit && myActiveBeacon) {
        await updateDoc(doc(db, 'Beacons', myActiveBeacon.id), {
          ownerName,
          message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          startAt: Timestamp.fromDate(sd),
          expiresAt: Timestamp.fromDate(ed),
          scheduled: true,
          updatedAt: serverTimestamp(),
          groupIds: tourSafeGroupIds(), // tour-time saves are ALWAYS test-scoped
          timeHHmm,
        });
      } else {
        const yyyy = sd.getFullYear();
        const mm = String(sd.getMonth() + 1).padStart(2, '0');
        const dd = String(sd.getDate()).padStart(2, '0');
        const deterministicId = `${user.uid}_${yyyy}${mm}${dd}`;

        await setDoc(
          doc(db, 'Beacons', deterministicId),
          {
            ownerUid: user.uid,
            ownerName,
            message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
            active: false,
            scheduled: true,
            startAt: Timestamp.fromDate(sd),
            expiresAt: Timestamp.fromDate(ed),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            groupIds: tourSafeGroupIds(), // tour-time saves are ALWAYS test-scoped
            timeHHmm,
          },
          { merge: true }
        );

        const qWin = query(
          beaconsRef,
          where('ownerUid', '==', user.uid),
          where('startAt', '>=', Timestamp.fromDate(todayStart)),
          where('startAt', '<=', Timestamp.fromDate(windowEnd))
        );
        const snap = await getDocs(qWin);
        const ops: Promise<any>[] = [];
        snap.forEach((d) => {
          const data: any = d.data();
          const stMs = getMillis(data?.startAt);
          if (!stMs) return;
          const st = new Date(stMs);
          const isKeep = sameDay(st, sd);
          const isScheduled = data?.scheduled === true || data?.scheduled === 'true';
          const isActive = !!data?.active;
          if (!isKeep && isScheduled && !isActive) {
            ops.push(updateDoc(d.ref, { scheduled: false, updatedAt: serverTimestamp() }));
          }
        });
        if (ops.length) await Promise.all(ops);

        // Scheduled-but-not-yet-active beacon: still a beacon they own, prompt
        // for notifications if they haven't enabled them yet.
        maybePromptForBeaconNotifications();
      }

      setOptionsOpen(false);
      return true;
    } catch (e: any) {
      if (__DEV__) console.error(e);
      Alert.alert('Error', e?.message || 'Failed to save options.');
      return false;
    }
  };

  // During tour step 4 (the sheet-fields step) the sheet's OWN Save/Cancel drive the tour: Save saves and
  // advances to step 5 (only if the save succeeded), Cancel steps back to step 3. Outside the tour they
  // behave normally (Save saves + closes, Cancel just closes).
  const onTourSheetFields = isActive && currentStepTarget === 'sheet-fields';
  const handleSheetSave = async () => {
    const ok = await saveBeaconOptions();
    if (ok && onTourSheetFields) advance();
  };
  const handleSheetCancel = () => {
    tap();
    if (onTourSheetFields) back();
    else setOptionsOpen(false);
  };

  // Loading baseline
  if (isLit === null) {
    return (
      <View style={[styles.controls, { backgroundColor: colors.bg }]}>
        <Text style={[styles.status, { color: colors.subtle }]}>Checking beacon status…</Text>
      </View>
    );
  }

  const scheduledDate = myActiveBeacon?.startAt ?? nextPlannedDate ?? startOfDay(new Date());
  const scheduledLabel = sameDay(scheduledDate, new Date())
    ? 'today'
    : scheduledDate.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();

  // Caption under an UNLIT beacon. If a beacon is scheduled (saved while unlit) nothing actually lights
  // it yet, so instead of the misleading "Tap to light" we surface the plan honestly: the day, the
  // optional time, and that tapping still lights it. Otherwise the plain tap-to-light prompt.
  const unlitCaption = (() => {
    if (!nextPlannedDate) return `Tap the ${skin.tap.noun} to light your Beacon`;
    const dayLabel = sameDay(nextPlannedDate, new Date())
      ? 'today'
      : nextPlannedDate.toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
    const timeLabel = formatTimeHHmmDisplay(plannedTimeHHmm);
    const when = timeLabel ? `${dayLabel} at ${timeLabel}` : dayLabel;
    return `Planned for ${when}. Tap the ${skin.tap.noun} to light it`;
  })();

  return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
        <View ref={pageRef} collapsable={false} style={styles.page}>
          {/* SCENE, backmost layer: each skin's bespoke procedural backdrop (components/scenes/*),
              anchor-aware so scene geometry lines up with the structure. pointerEvents none. */}
          <BeaconScene skin={skin} active={!!isLit} focused={isFocused} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} />
          {/* SMOKE, drifts up BEHIND the friend tiles (shown through the gaps; the tile list stays
              in front and untouched). Rises from the measured structure anchor. Registry-driven:
              skin.smokeKind picks the ambient smoke, the smoke-signal puff column, the fireworks
              show, the sky-lantern field, the bonfire's spiral ember column, or nothing. */}
          {skin.smokeKind === 'signal' ? (
            <BeaconSmokeSignal skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.smokeKind === 'fireworks' ? (
            <BeaconFireworks skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.smokeKind === 'lanterns' ? (
            <BeaconSkyLanterns skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.smokeKind === 'embers' ? (
            <BeaconEmberColumn skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.smokeKind === 'ambient' ? (
            <BeaconSmoke skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : null}
          {/* The bonfire's flame BODY lives here, behind the tiles AND behind the structure below,
              so the pyre's front logs occlude the flame base and the wood burns INSIDE the fire
              (the structure adds its own front licks on top). */}
          {skin.fire === 'pyre' && (
            <BeaconBonfireFlame skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          )}
          {(() => {
            const resumeVisible = onboarding.loaded && !onboarding.allDone && !isActive && !pendingAutoStart;
            const banner = (
              <TutorialResumeBanner
                visible={resumeVisible}
                doneCount={onboarding.doneCount}
                total={onboarding.total}
                nextLabel={onboarding.firstIncomplete?.label}
                onPress={() => {
                  const inc = onboarding.firstIncomplete;
                  // "Add a friend" is not a locked coach-mark anymore: send the user to Friends, where
                  // a non-blocking help card shows for anyone with no friend yet. Other steps still use
                  // the coach-mark jump.
                  if (inc?.key === 'friend') {
                    router.navigate('/friends');
                  } else {
                    startBeaconTour(inc?.target ? { startAtTarget: inc.target } : undefined);
                  }
                }}
              />
            );
            // The email-verify banner (VerifyEmailGate, floats at the very top for pending email/
            // password signups) shares this top area. When it's showing, nudge the resume banner down
            // so the two don't overlap. Only wrap when both are actually visible, so an empty wrapper
            // never adds a stray flex gap otherwise.
            return resumeVisible && needsVerification(user)
              ? <View style={styles.resumeBannerVerifyOffset}>{banner}</View>
              : banner;
          })()}
          <View style={styles.beaconsWrap}>
            <FriendsBeaconsList onSelect={setSelectedBeacon} showExampleWhenEmpty />
          </View>

          {/* marginBottom inline: BottomBar is 64 + max(insets.bottom, 8) tall on-device (99 on
              notched phones), so the static 72 under-cleared it and the options CTA sat flush
              against the tab bar. The +34 band is the paddingBottom+CTA-margin that used to live
              INSIDE this container, moved below it so the absolutely-positioned test-beacon note
              can appear there without shifting the beacon/CTA a single pixel.
              onLayout: re-anchor the fire whenever THIS container's frame shifts (a layout change
              here moves the logs without firing the logs wrapper's own onLayout, which once left
              every skin's flame painted too low after a fast-refresh). */}
          <View
            style={[styles.controls, { marginBottom: 64 + Math.max(insets.bottom, 8) + 34 }]}
            onLayout={measureBeaconAnchor}
          >
            <View style={styles.myBeaconColumn}>
              <View ref={logsRef} collapsable={false} style={{ position: 'relative' }} onLayout={measureBeaconAnchor}>
                <TouchableOpacity onPress={toggleBeacon} disabled={toggleBusy} activeOpacity={0.7} style={styles.beaconContainer}>
                  <BeaconStructure skin={skin} size={180} lit={!!isLit} focused={isFocused} />
                </TouchableOpacity>

                {!isActive && (
                  <Pressable onPress={() => startBeaconTour()} hitSlop={12} style={styles.helpBtn}>
                    <Ionicons name="help-circle" size={28} color={colors.primary} />
                  </Pressable>
                )}

                {/* Small discreet fire-sound mute (sound is ON by default for the centerpiece). */}
                <Pressable
                  onPress={() => { tap(); setFireSoundEnabled(!fireSoundOn); }}
                  hitSlop={12}
                  style={styles.muteBtn}
                  accessibilityRole="button"
                  accessibilityLabel={fireSoundOn ? 'Mute fire sounds' : 'Unmute fire sounds'}
                >
                  <Ionicons name={fireSoundOn ? 'volume-high' : 'volume-mute'} size={22} color={colors.subtle} />
                </Pressable>
              </View>

              {/* Fixed-height slot so the logs sit at the SAME height whether the action below is the
                  (taller) chat button [lit] or the caption [unlit], both center within it. */}
              <View style={styles.beaconActionSlot}>
                {isLit && myActiveBeacon ? (
                  <TouchableOpacity
                    ref={chatTarget}
                    onPress={() => { tap(); setSelectedBeacon(myActiveBeacon); }}
                    activeOpacity={0.8}
                    style={[styles.myChatBtn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={[styles.myChatBtnTxt, { color: '#fff' }]}>Open beacon chat</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={[styles.logHint, { color: skin.tap.tint }]}>{unlitCaption}</Text>
                )}
              </View>
            </View>

            <Pressable
              ref={optionsCtaRef}
              collapsable={false}
              onPress={openOptions}
              hitSlop={8}
              style={({ pressed }) => [styles.optionsCta, { backgroundColor: colors.card, borderColor: colors.border }, pressed && styles.optionsCtaPressed]}
              android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
            >
              <View style={[styles.optionsCtaIconWrap, { backgroundColor: colors.primary }]}>
                <Ionicons name="calendar" size={20} color="#fff" />
              </View>
              <View style={styles.optionsCtaTextWrap}>
                <Text style={[styles.optionsCtaTitle, { color: colors.text }]}>Beacon options</Text>
                <Text style={[styles.optionsCtaSubtitle, { color: colors.subtle }]}>Pick a day • choose friends • add a note</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={colors.primary} />
            </Pressable>
          </View>

          {/* Test-scope warning, in the band BETWEEN Beacon options and the nav bar. Absolutely
              positioned so showing/hiding it never moves the beacon column above. ONLY when test is
              the sole selection: with a real group alongside, that group's members DO get the
              beacon (audience = union of selected groups; test just adds nobody). */}
          {!!user?.uid && selectedGroupIds.length === 1 && selectedGroupIds[0] === `${user.uid}__tutorial_test` && (
            <Text
              style={[styles.testScopeNote, { bottom: 64 + Math.max(insets.bottom, 8) + 2 }]}
              pointerEvents="none"
            >
              Test beacon: friends can&apos;t see it and won&apos;t be notified. Turn off the test group to send to all friends.
            </Text>
          )}

          {/* FIRE, last child, on TOP of the structure (pointerEvents none, taps reach the structure
              + chat button below). Registry-driven: skin.fire picks the Skia flame, a sweeping beam
              (routed by structure: lighthouse vs the premiere searchlight), the storm's short-lived
              lightning strike, or nothing (skins whose structure owns its light: lanterns, rune
              stone, sky-lantern stand). */}
          {skin.fire === 'beam' ? (
            skin.structure === 'searchlight' ? (
              <BeaconSearchlightBeam skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
            ) : (
              <BeaconLighthouseBeam skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
            )
          ) : skin.fire === 'bolt' ? (
            <BeaconStormBolt skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.fire === 'print' ? (
            <BeaconPrintFire skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.fire === 'flame' ? (
            <BeaconFire skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : null}
        </View>

        {/* Options sheet, an in-tree overlay (not a RN <Modal>) so the coach-mark tour can point
            at the day/time/group/message controls. The tab bar is hidden while it's open (see
            BottomBar below) so it doesn't paint over the sheet. */}
        {optionsRendered && (
          <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
            {/* Tap outside the sheet to dismiss it (sits behind the dim + the card). */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => { tap(); setOptionsOpen(false); }}
              accessibilityRole="button"
              accessibilityLabel="Close beacon options"
            />
            <Animated.View
              style={[StyleSheet.absoluteFill, { top: -insets.top, backgroundColor: colors.backdrop, opacity: optionsAnim }]}
              pointerEvents="none"
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'position' : undefined}
              keyboardVerticalOffset={0}
              style={{ width: '100%' }}
            >
              <Animated.View
                style={[
                  styles.modalCard,
                  { backgroundColor: colors.card, paddingBottom: 16 + (kbVisible ? 0 : insets.bottom) },
                  { transform: [{ translateY: optionsAnim.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] },
                ]}
              >
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Schedule / Edit Beacon</Text>
                  <Pressable onPress={() => { tap(); setOptionsOpen(false); }} hitSlop={8} style={styles.closeBtn}>
                    <Ionicons name="close" size={24} color={colors.text} />
                  </Pressable>
                </View>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingBottom: 12 }}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Beacon style (skin), switches the home beacon live. FIXED-WIDTH 3-across grid:
                      the chips used to size to their text, so the selected chip's bold label
                      changed its width and the whole wrap reflowed on every tap. Now every chip is
                      the same size and nothing ever moves. Selecting a style also opens a live
                      preview box that overlays the fields below until dismissed. */}
                  <View ref={beaconStyleRef} collapsable={false} style={stylePreviewOpen ? styles.styleZTop : undefined}>
                    <Text style={[styles.modalLabel, { color: colors.text }]}>Beacon style</Text>
                    <View style={styles.daysWrap}>
                      {BEACON_SKINS.map((bs) => (
                        <Pressable
                          key={bs.id}
                          onPress={() => { selection(); setBeaconSkinId(bs.id); setStylePreviewOpen(true); }}
                          style={[styles.dayChip, styles.skinChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, bs.id === skinId && [styles.dayChipActive, { backgroundColor: colors.primary, borderColor: colors.primary }]]}
                        >
                          <Text numberOfLines={1} style={[styles.dayChipText, { color: colors.text }, bs.id === skinId && styles.dayChipTextActive]}>{bs.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {stylePreviewOpen && (
                      // No key: remounting on every style tap reset the measured box width, which
                      // flashed the structure at the left edge for a frame. The component restarts
                      // its own lit cycle when skin.id changes.
                      <View style={styles.stylePreviewWrap}>
                        <StylePreview skin={skin} onClose={() => setStylePreviewOpen(false)} />
                      </View>
                    )}
                  </View>

                  {/* Day, time, friend groups, and message: wrapped so the tour highlights them together. */}
                  <View ref={sheetFieldsRef} collapsable={false}>
                  {/* Day */}
                  <Text style={[styles.modalLabel, { marginTop: 12, color: colors.text }]}>Day</Text>
                  <View ref={dayRef} collapsable={false} style={styles.daysWrap}>
                    {next7Days.map((d) => (
                      <Pressable
                        key={d.offset}
                        onPress={() => { selection(); setDayOffset(d.offset); }}
                        style={[styles.dayChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, d.offset === dayOffset && [styles.dayChipActive, { backgroundColor: colors.primary, borderColor: colors.primary }]]}
                      >
                        <Text style={[styles.dayChipText, { color: colors.text }, d.offset === dayOffset && styles.dayChipTextActive]}>
                          {d.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Time (optional) */}
                  <Text style={[styles.modalLabel, { marginTop: 12, color: colors.text }]}>Time (optional)</Text>
                  <View ref={timeRef} collapsable={false} style={styles.timeRow}>
                    <TextInput
                      style={[styles.timeInput, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.text }]}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="--"
                      placeholderTextColor={colors.subtle}
                      value={timeHourInput}
                      onChangeText={(s) => setTimeHourInput(s.replace(/\D/g, '').slice(0, 2))}
                      returnKeyType="next"
                      accessibilityLabel="Hour"
                      inputAccessoryViewID={Platform.OS === 'ios' ? MSG_ACCESSORY_ID : undefined}
                    />
                    <Text style={[styles.timeColon, { color: colors.text }]}>:</Text>
                    <TextInput
                      style={[styles.timeInput, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.text }]}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="00"
                      placeholderTextColor={colors.subtle}
                      value={timeMinuteInput}
                      onChangeText={(s) => setTimeMinuteInput(s.replace(/\D/g, '').slice(0, 2))}
                      returnKeyType="done"
                      accessibilityLabel="Minute"
                      inputAccessoryViewID={Platform.OS === 'ios' ? MSG_ACCESSORY_ID : undefined}
                    />
                    <Pressable
                      onPress={() => { selection(); setTimeMeridiem((m) => (m === 'AM' ? 'PM' : 'AM')); }}
                      style={[styles.meridiemBtn, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle meridiem, currently ${timeMeridiem}`}
                    >
                      <Text style={[styles.meridiemTxt, { color: colors.text }]}>{timeMeridiem}</Text>
                    </Pressable>
                    {(timeHourInput || timeMinuteInput) ? (
                      <Pressable
                        onPress={() => { tap(); setTimeHourInput(''); setTimeMinuteInput(''); }}
                        hitSlop={8}
                        style={styles.timeClearBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Clear time"
                      >
                        <Text style={[styles.timeClearTxt, { color: colors.primary }]}>Clear</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {timeRangeError ? (
                    <Text style={[styles.timeError, { color: colors.error }]}>{timeRangeError}</Text>
                  ) : null}

                  {/* Friend Groups */}
                  <View ref={groupsRef} collapsable={false}>
                  <Text style={[styles.modalLabel, { marginTop: 12, color: colors.text }]}>
                    Friend Groups (if none selected, all friends can see)
                  </Text>
                  {loadingGroups ? (
                    <View style={{ paddingVertical: 6 }}>
                      <ActivityIndicator />
                    </View>
                  ) : groups.length ? (
                    <View style={styles.daysWrap}>
                      {groups.map((g) => {
                        const selected = selectedGroupIds.includes(g.id);
                        return (
                          <Pressable
                            key={g.id}
                            onPress={() => {
                              selection();
                              setSelectedGroupIds((prev) =>
                                selected ? prev.filter((x) => x !== g.id) : [...prev, g.id]
                              );
                            }}
                            style={[styles.dayChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, selected && [styles.dayChipActive, { backgroundColor: colors.primary, borderColor: colors.primary }]]}
                          >
                            <Text style={[styles.dayChipText, { color: colors.text }, selected && styles.dayChipTextActive]}>{g.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={{ color: colors.subtle, marginBottom: 6 }}>
                      {online ? "No groups yet. Create some in Friends." : "Can't load groups. No internet connection."}
                    </Text>
                  )}
                  </View>

                  {/* Message */}
                  <View ref={messageRef} collapsable={false}>
                  <Text style={[styles.modalLabel, { marginTop: 12, color: colors.text }]}>Message</Text>
                  <TextInput
                    style={[styles.msgInput, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.text }]}
                    placeholder={DEFAULT_BEACON_MESSAGE}
                    placeholderTextColor={colors.subtle}
                    value={message}
                    onChangeText={setMessage}
                    maxLength={BEACON_MESSAGE_MAX}
                    multiline
                    inputAccessoryViewID={Platform.OS === 'ios' ? MSG_ACCESSORY_ID : undefined}
                    returnKeyType="default"
                    blurOnSubmit={false}
                  />
                  </View>

                  {/* Save/Cancel are INSIDE the sheet-fields wrapper so the tour highlights them with the
                      rest of step 4. During the tour Save advances to step 5, Cancel returns to step 3. */}
                  <View style={styles.modalBtnRow}>
                    <TouchableOpacity style={[styles.btn, styles.btnGhost, { backgroundColor: colors.inputBg, borderColor: colors.border }]} onPress={handleSheetCancel}>
                      <Text style={[styles.btnGhostText, { color: colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        styles.btnPrimary,
                        { backgroundColor: colors.primary, borderColor: colors.primary },
                        !!timeRangeError && { opacity: 0.5 },
                      ]}
                      onPress={handleSheetSave}
                      disabled={!!timeRangeError}
                    >
                      <Text style={styles.btnPrimaryText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                  </View>
                </ScrollView>
              </Animated.View>
            </KeyboardAvoidingView>
            {Platform.OS === 'ios' && (
              <InputAccessoryView nativeID={MSG_ACCESSORY_ID}>
                <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8 }}>
                    <View style={{ flex: 1 }} />
                    <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
                      <Text style={{ fontWeight: '700', color: colors.text }}>Done</Text>
                    </Pressable>
                  </View>
                </View>
              </InputAccessoryView>
            )}
          </View>
        )}

        {/* Beacon details modal. KeyboardAvoidingView around the backdrop so when
            the chat composer is focused, the detailCard shrinks from the bottom
            (header stays pinned at top, list shrinks, composer sits above
            the keyboard). Without this the input was being covered. */}
        <Modal
          visible={!!selectedBeacon}
          animationType="fade"
          transparent
          onRequestClose={() => { setSelectedBeacon(null); setSelectedBeaconMessageId(undefined); }}
        >
          <KeyboardAvoidingView
            style={[styles.modalBackdropCenter, { backgroundColor: colors.backdrop, paddingTop: insets.top + 8 }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => { tap(); setSelectedBeacon(null); setSelectedBeaconMessageId(undefined); }} />
            {/* Bottom gap lives on the CARD, not the KAV: KeyboardAvoidingView (behavior padding)
                overwrites the container's paddingBottom with the keyboard height (0 when closed),
                which would otherwise drop the card into the home-indicator / curved corner. With the
                keyboard OPEN the KAV padding already clears it, so the card margin drops to a hairline
                and the composer sits flush above the keyboard's Done bar (no dead band). */}
            <View
              style={[
                styles.detailCard,
                // Keyboard open: zero out the card's own bottom chrome so the composer sits flush
                // against the keyboard's Done bar; no see-through band showing the fire behind.
                { backgroundColor: colors.card, marginBottom: kbVisible ? 0 : insets.bottom + 8, paddingBottom: kbVisible ? 0 : 8 },
              ]}
              pointerEvents="box-none"
            >
              <View style={styles.modalHeader}>
                <Pressable onPress={() => { tap(); setSelectedBeacon(null); setSelectedBeaconMessageId(undefined); }} hitSlop={8} style={styles.closeBtn}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </Pressable>
              </View>

              {selectedBeacon && (
                <View style={{ flex: 1, marginTop: 4 }}>
                  <ChatRoom beaconId={selectedBeacon.id} targetMessageId={selectedBeaconMessageId} style={{ flex: 1 }} />
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>

      {!optionsRendered && <BottomBar />}

      {/* First-skip hint: how to reopen the walkthrough (shown once, only if never completed). */}
      <Modal
        visible={showSkipHint}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSkipHint(false)}
      >
        <View style={styles.skipHintBackdrop}>
          <View style={[styles.skipHintCard, { backgroundColor: colors.card }]}>
            <Ionicons name="help-circle" size={56} color={colors.primary} />
            <Text style={[styles.skipHintTitle, { color: colors.text }]}>Come back any time</Text>
            <Text style={[styles.skipHintBody, { color: colors.subtle }]}>
              No worries. You can reopen this walkthrough whenever you like by tapping the help button
              (the <Ionicons name="help-circle" size={15} color={colors.subtle} /> icon) on the home screen.
            </Text>
            <Pressable
              onPress={() => { tap(); setShowSkipHint(false); }}
              style={[styles.skipHintBtn, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
            >
              <Text style={styles.skipHintBtnTxt}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* First-time beacon notification onboarding */}
      <Modal
        visible={showBeaconNotifOnboarding}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBeaconNotifOnboarding(false)}
      >
        <View style={styles.helpOverlay}>
          <View style={[styles.helpCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.helpTitle, { color: colors.text }]}>Get pinged about your beacon</Text>

            <Text style={[styles.helpBody, { color: colors.text }]}>
              Now that you&apos;ve lit a beacon, we can let you know when friends RSVP or comment so you don&apos;t have to keep checking the chat.
            </Text>

            <Text style={[styles.helpBody, { color: colors.subtle }]}>
              You can change this anytime in Settings.
            </Text>

            <Pressable
              onPress={async () => {
                if (beaconNotifBusy) return;
                try {
                  setBeaconNotifBusy(true);
                  const { granted } = await ensurePushPermissionsAndToken();
                  setShowBeaconNotifOnboarding(false);
                  if (granted) {
                    onboarding.refresh(); // keep the setup banner in sync
                    // Opt into friend-beacon pushes so they actually start arriving (the NOTIFY FLAG
                    // the server's recipientWantsNotify checks). Non-fatal if the write fails: OS
                    // permission is already granted and the master toggle can be set in Settings.
                    const uid = auth.currentUser?.uid;
                    if (uid) {
                      try {
                        await setDoc(
                          doc(db, 'Profiles', uid),
                          { notifyAllBeacons: true, updatedAt: serverTimestamp() },
                          { merge: true }
                        );
                      } catch {
                        // swallow: permission is granted regardless
                      }
                    }
                  }
                  if (!granted) {
                    Alert.alert(
                      "Permission declined",
                      "No worries, you can enable notifications later from Settings.",
                    );
                  }
                } catch (e: any) {
                  if (__DEV__) console.warn('beacon notif onboarding failed', e);
                  setShowBeaconNotifOnboarding(false);
                } finally {
                  setBeaconNotifBusy(false);
                }
              }}
              style={[styles.helpClose, { backgroundColor: colors.primary, opacity: beaconNotifBusy ? 0.7 : 1 }]}
              disabled={beaconNotifBusy}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                {beaconNotifBusy ? 'Working…' : 'Allow notifications'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShowBeaconNotifOnboarding(false)}
              style={{ marginTop: 12, alignSelf: 'center' }}
              disabled={beaconNotifBusy}
            >
              <Text style={{ color: colors.subtle, fontSize: 14 }}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // First-skip hint modal
  skipHintBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  skipHintCard: { width: '100%', maxWidth: 360, borderRadius: 20, padding: 24, alignItems: 'center' },
  skipHintTitle: { fontSize: 20, fontWeight: '800', marginTop: 10, marginBottom: 8, textAlign: 'center' },
  skipHintBody: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  skipHintBtn: { alignSelf: 'stretch', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  skipHintBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  // Page structure
  page: {
    flex: 1,
    gap: 8,
    // MUST stay 0 (and paddingHorizontal 0, no border): the fire/smoke <Svg> layers are absolute
    // top:0/left:0 children of this view and the logs anchor is measured relative to it, so any top
    // or left padding here would offset the flame off the logs. The old 4px top pad moved to
    // beaconsWrap so visible content doesn't shift.
    paddingTop: 0,
    paddingHorizontal: 0,
  },
  beaconsWrap: {
    flex: 1,
    paddingTop: 4, // was styles.page.paddingTop; kept here so tiles don't shift up
    paddingHorizontal: 0,
  },
  // Clears the floating email-verify banner (VerifyEmailGate) above the resume banner so they
  // don't overlap for pending email/password signups. Sized to clear its one/two-line height.
  resumeBannerVerifyOffset: { paddingTop: 56 },

  controls: {
    // Transparent (not colors.bg) so the smoke layer behind shows through the controls region and
    // connects to the fire. colors.bg already paints behind via SafeAreaView, so this is no color
    // change in light OR dark, but it MUST be transparent here, not '#fff'.
    backgroundColor: 'transparent',
    alignItems: 'center',
    paddingHorizontal: SCREEN_PAD,
    paddingTop: 12,
    // No paddingBottom: that space moved into the inline marginBottom band below the container
    // (where the test-beacon note lives), keeping the CTA's absolute position identical.
    paddingBottom: 0,
    // marginBottom is applied inline (insets-aware) to clear the BottomBar; see the render.
  },
  // Sound + help sit at the BOTTOM corners (by the logs), clear of the tall flame above.
  helpBtn: {
    position: 'absolute',
    bottom: 8,
    right: -34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteBtn: {
    position: 'absolute',
    bottom: 8,
    left: -34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  helpCard: {
    width: '100%',
    borderRadius: 20,
    padding: 28,
  },
  helpTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 20,
    textAlign: 'center',
  },
  helpBody: {
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 16,
  },
  helpClose: {
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  myBeaconColumn: {
    alignItems: 'center',
    marginBottom: 0,
  },
  beaconContainer: {
    alignItems: 'center',
  },
  beaconIcon: {
    paddingVertical: 8,
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  beaconGif: {
    width: 180,
    height: 180,
  },
  logHint: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    // Sits over the skin's (dark) photo backdrop; the shadow guarantees legibility on any of them.
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  // Fixed slot below the logs; the button or caption centers in it so the logs don't shift between
  // lit and unlit. Height = the chat button's footprint so the unlit logs rise to the lit height.
  beaconActionSlot: {
    // Pull up into the logs box's ~14px empty bottom (below the log bases) and grow to match, so the
    // centered button sits at the true midpoint between the VISIBLE logs and the options card. Net
    // height (marginTop + minHeight = 72) is unchanged, so the logs and options don't move.
    marginTop: -14,
    minHeight: 86,
    justifyContent: 'center',
    alignItems: 'center',
  },
  myChatBtn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  myChatBtnTxt: { fontSize: 17, fontWeight: '800', textAlign: 'center', letterSpacing: 0.2 },

  status: { fontSize: 16, color: '#555', marginTop: 10, textAlign: 'center', minHeight: 22 },
  // Split the old marginBottom:12 evenly across top + bottom so the active-state
  // text is vertically centered between the "Open beacon chat" button above and
  // the Beacon options card below, without changing total layout height.
  statusActive: { fontSize: 18, fontWeight: '600', color: 'green', marginTop: 6, marginBottom: 6 },

  // --- Options modal styles ---
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalLabel: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 6 },

  daysWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  dayChipActive: { backgroundColor: '#2F6FED', borderColor: '#2F6FED' },
  // Style-picker chips: FIXED width (3 per row) so selection (bold text) never reflows the grid.
  skinChip: { width: '31.5%', alignItems: 'center', paddingHorizontal: 4 },
  // The preview overlays the sheet fields below the grid until dismissed.
  styleZTop: { zIndex: 40, elevation: 40 },
  stylePreviewWrap: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, zIndex: 40, elevation: 40 },
  dayChipText: { color: '#0B1426', fontSize: 14 },
  dayChipTextActive: { color: '#fff', fontWeight: '700' },

  msgInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  msgHint: { color: '#667085', fontSize: 12, marginTop: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    minWidth: 56,
  },
  timeColon: { fontSize: 22, fontWeight: '700' },
  meridiemBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 56,
    alignItems: 'center',
  },
  meridiemTxt: { fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  timeClearBtn: { paddingHorizontal: 8, paddingVertical: 6, marginLeft: 'auto' },
  timeClearTxt: { fontSize: 13, fontWeight: '600' },
  timeError: { fontSize: 12, marginTop: 4, fontWeight: '600' },

  modalBtnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  btnPrimary: { backgroundColor: '#2F6FED', borderColor: '#2F6FED' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnGhost: { backgroundColor: '#fff' },
  btnGhostText: { color: '#0B1426', fontWeight: '600' },

  // Details modal
  modalBackdropCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
    paddingHorizontal: SCREEN_PAD,
    // paddingTop comes inline (insets.top + 8): the chat should use the whole screen height,
    // the old fixed 130 top band was pure wasted space.
    paddingBottom: 0, // bottom gap is the card's marginBottom (insets-aware); see the modal above
  },
  detailCard: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 8,
    borderRadius: 14,
  },
  // Options CTA styles
  optionsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    backgroundColor: '#EEF3FF',
    borderColor: '#D8E3FF',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 22,
    paddingHorizontal: 14,
    marginTop: 0,
    // Trailing margin moved into the controls' inline marginBottom band (the test-note strip),
    // keeping this card's absolute position unchanged.
    marginBottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  // Amber caution line in the band between the options CTA and the BottomBar. Absolute (bottom
  // set inline, insets-aware) so its presence never reflows the beacon column.
  testScopeNote: {
    position: 'absolute',
    left: 0,
    right: 0,
    fontSize: 11.5,
    fontWeight: '600',
    color: '#F59E0B',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  optionsCtaPressed: { transform: [{ scale: 0.99 }], opacity: 0.95 },
  optionsCtaIconWrap: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  optionsCtaTextWrap: { flex: 1, alignItems: 'center' },
  optionsCtaTitle: { fontSize: 19, fontWeight: '800', color: '#0B1426', textAlign: 'center' },
  optionsCtaSubtitle: { marginTop: 2, color: '#48608C', textAlign: 'center' },
});