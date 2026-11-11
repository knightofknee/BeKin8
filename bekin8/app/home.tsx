// app/home.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMillis } from '../lib/millis';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  ScrollView,
  Animated,
  BackHandler,
  useWindowDimensions,
  AccessibilityInfo,
  AppState,
  Switch,
} from 'react-native';
import { WEB_WHITE_KNOB } from '@/components/ui/webSwitch';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
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
import StokeModal from '../components/StokeModal';
import type { ScenePerson } from '../components/scenes/BeaconsScene';
import { enableDefaultNotifyFlags, goingNames, useBeaconGoing } from '../lib/rsvp';
import { useUnreadCount } from '../lib/chatRead';
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
  collection,
  deleteField,
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
import FriendPickerSheet from '../components/FriendPickerSheet';
import { friendLabel, useFriends } from '../lib/useFriends';
import BottomBar from '@/components/BottomBar';
import { SCREEN_PAD } from '@/components/ui/layout';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { syncPushTokenIfGranted, ensurePushPermissionsAndToken } from '../lib/push';
import * as Notifications from 'expo-notifications';
import { usePrefetchBeaconMessages } from '../lib/prefetchBeaconMessages';
import { beaconExpiry, beaconStillLive, buildTimeHHmm, parseTimeHHmm, formatTimeHHmmDisplay } from '../lib/beaconTime';
import {
  MAX_TIME_OPTIONS,
  newOptionId,
  openPollBeaconFields,
  optionLabel,
  parseTimePoll,
  sameOption,
  sortOptions,
  type TimeOption,
  type TimePoll,
} from '../lib/timePoll';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useOnline } from '../providers/NetworkProvider';
import { tap, press, selection, success, warning } from '../utils/haptics';
import TutorialResumeBanner from '../components/tutorial/TutorialResumeBanner';
import WackyWednesday from '../components/WackyWednesday';
import { useSetupTour, makeWelcomeBeaconStep, WELCOME_BEACON_ID, type WelcomeBeaconCtx } from '../components/tutorial/setupTour';
import { useTour, useTourTarget } from '../providers/TourProvider';
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
const FRIEND_NOTIF_ASK_KEY = '@bekin_friend_notif_ask_at';
// Warm text for the ember chat pill.
const EMBER_TEXT = '#FDE7B0';
const BEACON_MESSAGE_MAX = 1000;

// --- Friend groups ---
type FriendGroup = {
  id: string;
  name: string;
  memberUids: string[];
};

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ beaconId?: string; messageId?: string }>();
  const { profile, user } = useAuth();
  const { colors } = useTheme();
  const online = useOnline();
  const insets = useSafeAreaInsets();

  // Your beacon state
  const [isLit, setIsLit] = useState<boolean | null>(null);
  const [myActiveBeacon, setMyActiveBeacon] = useState<FriendBeacon | null>(null);
  // Group scheduling (lib/timePoll): the poll on my current beacon, and the sheet's draft of it.
  const [myTimePoll, setMyTimePoll] = useState<TimePoll | null>(null);
  const [pollOn, setPollOn] = useState(false);
  const [pollOptions, setPollOptions] = useState<TimeOption[]>([]);
  const [myStokeReady, setMyStokeReady] = useState(false);
  // Ids of my beacons the server has already announced (lastNotifiedAt): relighting one sends no
  // second "lit a beacon" push, so its light confirm must not promise one.
  const [announcedIds, setAnnouncedIds] = useState<Set<string>>(() => new Set());
  const [stokeOpen, setStokeOpen] = useState(false);
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
  const [kbHeight, setKbHeight] = useState(0);
  const optionsScrollRef = useRef<ScrollView | null>(null);
  // Bring the focused field into view once the keyboard has shrunk the sheet's ScrollView
  // (the 250ms lets the kbVisible re-render land first). Plain ScrollView doesn't auto-scroll
  // to a focused TextInput, so without this you'd type into an input scrolled off-screen.
  const scrollSheetFieldIntoView = (fieldRef: React.RefObject<View | null>) => {
    setTimeout(() => {
      const scroll = optionsScrollRef.current as any;
      const field = fieldRef.current as any;
      if (!scroll || !field) return;
      const inner = scroll.getInnerViewRef?.();
      if (!inner) { scroll.scrollToEnd({ animated: true }); return; }
      field.measureLayout(
        inner,
        (_x: number, y: number) => scroll.scrollTo({ y: Math.max(0, y - 12), animated: true }),
        () => scroll.scrollToEnd({ animated: true })
      );
    }, 250);
  };
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
  const { updateStepById, isActive, currentStepId } = useTour();
  const { startSetup, startWelcome } = useSetupTour();
  // Welcome step 1's local practice light (see the Onboarding section below).
  const [practiceLit, setPracticeLit] = useState(false);
  const onWelcomeBeacon = isActive && currentStepId === WELCOME_BEACON_ID;
  const fireLit = !!isLit || practiceLit; // drives every fire/scene layer + the fire sound
  // Mirrored into a ref so non-reactive code (doc-sync callbacks) can read the live tour state.
  const tourActiveRef = useRef(isActive);
  tourActiveRef.current = isActive;
  // Base-setup progress (username + friend + notifications) drives the resume banner.
  const onboarding = useOnboarding();
  const logsRef = useTourTarget('beacon-logs');
  const optionsCtaRef = useTourTarget('beacon-options-cta');
  // Sheet field refs, for scrolling a focused field into view above the keyboard.
  const timeRef = useRef<View | null>(null);
  const messageRef = useRef<View | null>(null);
  // The home page View, the coordinate basis for the fire/smoke layers. Both <Svg> layers are
  // position:absolute top:0 left:0 inside styles.page, so we measure the logs RELATIVE TO this view
  // (logs window pos − page window pos). That collapses the whole nesting chain into one offset and
  // is immune to safe-area insets / padding above. REQUIRES styles.page to keep paddingTop:0 and
  // paddingHorizontal:0 with no border, or the flame lands off the logs.
  // Selected beacon SKIN (device-local pref; default The Beacons, DEFAULT_SKIN_ID), drives scene,
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
  const prevLitForSoundRef = useRef<boolean | null>(isLit);
  useEffect(() => {
    const was = prevLitForSoundRef.current;
    prevLitForSoundRef.current = isLit === null ? null : fireLit;
    if (!soundLoaded) return; // wait for the pref so a muted user never hears a startup blip
    fireSound.setLit(fireLit && isFocused);
    if (fireLit && was === false && isFocused) {
      fireSound.playIgnite();
      success();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fireLit, isLit, fireSoundOn, soundLoaded, isFocused]);
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
      // Already denied for good (iOS after one "Don't Allow"): the modal's button can't show the
      // OS prompt anymore, so it would just nag on every light. Settings still covers re-enabling.
      if (!perm.canAskAgain) return;
      setShowBeaconNotifOnboarding(true);
    } catch {
      // If the permissions check itself fails, don't block the beacon flow.
    }
  };

  // Prefetch messages for the user's own active beacon so tapping
  // "Open my beacon details" renders chat instantly from cache.
  usePrefetchBeaconMessages([myActiveBeacon?.id]);
  // Live "who's going" for my lit beacon (the going line under the chat button).
  const myGoing = useBeaconGoing(isLit ? myActiveBeacon?.id : null, auth.currentUser?.uid);
  // Friends' messages in my beacon's chat I haven't opened yet (the badge on the Chat pill).
  const myUnread = useUnreadCount(isLit ? myActiveBeacon?.id : null);

  // The real people the scene shows (The Beacons' chain): the friends going (RSVP'd or rallying)
  // to my lit beacon; nobody while it's out. Memoized on content so
  // a same-people snapshot doesn't re-render the scene.
  const peopleKey = isLit ? myGoing.going.map((g) => `${g.uid}:${g.name}:${g.rally ? 1 : 0}`).join('|') : '';
  const scenePeople = useMemo<ScenePerson[]>(
    () => (isLit ? myGoing.going.map((g) => ({ id: g.uid, name: g.name, rally: g.rally })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peopleKey]
  );

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
  const [loadingGroups, setLoadingGroups] = useState(false);
  // Friends invited one by one (the "+" chip after the groups). Stored on the beacon as friendUids;
  // the server unions them with the groups' members for the push, the friends list honors them for
  // visibility. Loaded only while the sheet is up or a pick exists (names for the chips/confirm).
  const [selectedFriendUids, setSelectedFriendUids] = useState<string[]>([]);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const { friends: myFriends, loading: loadingFriends } = useFriends(
    user?.uid ?? null,
    optionsRendered || selectedFriendUids.length > 0
  );
  const friendNameOf = (uid: string) => {
    const f = myFriends.find((x) => x.uid === uid);
    return f ? friendLabel(f) : 'Friend';
  };

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

    // From YESTERDAY: a beacon lit last night lives until 4am (beaconExpiry), so after midnight its
    // owner must still see it lit (and be able to put it out). Yesterday's docs are filtered below.
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const qMine = query(
      collection(db, 'Beacons'),
      where('ownerUid', '==', user.uid),
      where('startAt', '>=', Timestamp.fromDate(yesterdayStart)),
      where('startAt', '<=', Timestamp.fromDate(windowEnd))
    );

    const unsub = onSnapshot(
      qMine,
      (snap) => {
        let activeDoc: { id: string; data: any } | undefined;
        let plannedSoonest: { id: string; data: any; start: Date } | undefined;
        const announced = new Set<string>();
        snap.forEach((d) => { if ((d.data() as any)?.lastNotifiedAt) announced.add(d.id); });
        setAnnouncedIds(announced);

        snap.forEach((d) => {
          const data: any = d.data();
          // My RALLY beacons are not my plan: the structure is my own beacon only. Rallies live on
          // the original's tile (lib/rsvp) and stack freely alongside it.
          if (data?.rallyOf) return;
          const stMs = getMillis(data?.startAt);
          if (!stMs) return;
          const st = new Date(stMs);
          // Yesterday's beacon only counts while it's still lit and inside its grace window.
          if (stMs < todayStart.getTime() && !(data?.active && beaconStillLive(stMs, getMillis(data?.expiresAt)))) return;

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

        setMyTimePoll(parseTimePoll((activeDoc ?? plannedSoonest)?.data?.timePoll));

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
          // Server-set once the beacon has been relit (it only announces a beacon once): arms the
          // hidden stoke. Cleared server-side when used.
          setMyStokeReady(activeDoc.data?.stokeReady === true);
          // Mirror the doc's groups EXACTLY, including the tutorial test group. Filtering test out
          // here made the sheet lie: a deliberately test-scoped beacon showed no group selected, and
          // the next save silently wrote groupIds [] (= all friends).
          const gids: string[] = Array.isArray(activeDoc.data?.groupIds)
            ? activeDoc.data.groupIds.filter((x: any) => typeof x === 'string')
            : [];
          setSelectedGroupIds(gids);
          setSelectedFriendUids(
            Array.isArray(activeDoc.data?.friendUids)
              ? activeDoc.data.friendUids.filter((x: any) => typeof x === 'string')
              : []
          );
        } else {
          setMyActiveBeacon(null);
          setIsLit(false);
          setMyStokeReady(false);
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
          setSelectedGroupIds(gids);
          setSelectedFriendUids(
            Array.isArray(plannedSoonest.data?.friendUids)
              ? plannedSoonest.data.friendUids.filter((x: any) => typeof x === 'string')
              : []
          );
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
    // An open time poll reopens as the editable option list; anything else starts with it off.
    const openPoll = myTimePoll?.status === 'open' ? myTimePoll : null;
    setPollOn(!!openPoll);
    setPollOptions(openPoll ? openPoll.options : []);

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

  // Every account always has the "test" group as a Beacon options choice, not just accounts that ran
  // a tour (it used to be created only by the tutorial). Cheap: one owner read per home mount, and
  // a create only when it's genuinely missing.
  useEffect(() => {
    if (user?.uid) ensureTestGroup();
  }, [user?.uid, ensureTestGroup]);

  // Safety net: any beacon written while a tour runs is test-scoped no matter what the selection
  // says. (The welcome tour's practice light writes nothing, so this should never matter.)
  const tourSafeGroupIds = (): string[] => {
    const uid = auth.currentUser?.uid;
    if (isActive && uid) return [`${uid}__tutorial_test`];
    return selectedGroupIds;
  };
  // Same safety net for the individually picked friends: a tour-time write invites nobody.
  const tourSafeFriendUids = (): string[] => (isActive ? [] : selectedFriendUids);

  // ---- Onboarding (components/tutorial/setupTour.tsx) ----
  // Welcome step 1 invites a PRACTICE light: tapping the beacon on that step lights it locally only
  // (fire, sound, haptic; no beacon doc is written, nobody is notified) and it goes out when the step
  // ends. fireLit drives every fire/scene layer below.
  const welcomeCtxRef = useRef<WelcomeBeaconCtx | null>(null);
  useEffect(() => {
    if (!onWelcomeBeacon) setPracticeLit(false);
  }, [onWelcomeBeacon]);
  useEffect(() => {
    if (onWelcomeBeacon && welcomeCtxRef.current) {
      updateStepById(WELCOME_BEACON_ID, makeWelcomeBeaconStep(welcomeCtxRef.current, practiceLit));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceLit]);

  // The one-time "who will see this" confirm (first beacon lit after the tour) arms when it closes.
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

  const beginWelcome = (isReplay: boolean) => {
    // Spotlight headroom over the structure box: the solid flame body tops out at roughly
    // 170*flameScale px above the seat, which sits 180*origin below the box top. Flameless skins
    // keep 70.
    const holePadTop =
      skin.fire === 'flame' || skin.fire === 'print' || skin.fire === 'pyre'
        ? Math.max(70, Math.ceil(170 * skin.flameScale - 180 * skin.origin) + 40) // +40: tip + glow stay inside the ring
        : 70;
    const ctx: WelcomeBeaconCtx = { tapNoun: skin.tap.noun, holePadTop, alreadyLit: !!isLit };
    welcomeCtxRef.current = ctx;
    setOptionsOpen(false);
    startWelcome({ ...ctx, isReplay, onClose: () => { firstTourDoneRef.current = true; } });
  };

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
  // i.e. after isLit resolves.
  useEffect(() => {
    if (pendingAutoStart && isLit !== null) {
      setPendingAutoStart(false);
      beginWelcome(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoStart, isLit]);

  // Anyone with a friend should have notifications on: otherwise a friend's beacon never reaches
  // them (receivers who skip the tour and never light a beacon were never asked). Once they have a
  // friend and the OS can still prompt, ask, at most every 3 days. Skipped while a tour runs (it has
  // its own notifications step) and when permission is already settled either way.
  const hasFriend = onboarding.steps.find((st) => st.key === 'friend')?.done ?? false;
  const notifSettled = onboarding.steps.find((st) => st.key === 'notifications')?.done ?? true;
  useEffect(() => {
    if (!onboarding.loaded || !hasFriend || notifSettled || isActive || pendingAutoStart) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        // Never on a first visit: the auto-shown tour has its own notifications step, and its
        // start is decided asynchronously, so only ask once the tour has been offered.
        if (tourActiveRef.current || !(await getSeen('beacon_intro'))) return;
        const perm = await Notifications.getPermissionsAsync();
        if (cancelled || perm.granted || !perm.canAskAgain) return;
        const last = Number((await AsyncStorage.getItem(FRIEND_NOTIF_ASK_KEY)) || 0);
        if (cancelled || Date.now() - last < 3 * 24 * 3_600_000) return;
        await AsyncStorage.setItem(FRIEND_NOTIF_ASK_KEY, String(Date.now()));
        const granted = await ensureNotifyPermission(
          'Your friends are here. Turn on notifications so you know when one of them lights a beacon.'
        );
        if (granted) await enableDefaultNotifyFlags();
      } catch {
        // best effort; Settings still has the toggle
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [onboarding.loaded, hasFriend, notifSettled, isActive, pendingAutoStart]);

  // Track keyboard visibility so the options sheet can drop its home-indicator padding while
  // typing, keeps the Save/Cancel row tight to the keyboard's Done bar.
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => { setKbVisible(true); setKbHeight(e.endCoordinates?.height ?? 0); });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => { setKbVisible(false); setKbHeight(0); });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Track OS Reduce Motion so the sheet can snap instead of slide.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);

  // Slide the options sheet in/out; keep it mounted through the exit animation. Reduce Motion snaps.
  useEffect(() => {
    const instant = reduceMotion;
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
    const onlyTest =
      !!testId && selectedGroupIds.length === 1 && selectedGroupIds[0] === testId && selectedFriendUids.length === 0;
    if (onlyTest) {
      return {
        title: 'This is a test beacon',
        message:
          'Your beacon is set to your test group, so no friends will be notified. Open Beacon options and deselect the test group to send your beacon to all friends. Or add a friend group to send it to just them.',
      };
    }
    // Same doc the light path writes (deterministic per day): already announced = a relight.
    const day = nextPlannedDate ? startOfDay(nextPlannedDate) : startOfDay(new Date());
    const dayId = `${me}_${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
    if (me && announcedIds.has(dayId)) {
      return {
        title: 'Relight your beacon?',
        message: "Your friends were notified when you first lit it, so they won't get another notification.",
      };
    }
    if (selectedGroupIds.length === 0 && selectedFriendUids.length === 0) {
      return {
        title: 'Light beacon for all friends?',
        message: 'All of your friends will see this beacon and get a notification. Pick a friend group in Beacon options to share it with just some of them.',
      };
    }
    const names = [
      ...groups.filter((g) => selectedGroupIds.includes(g.id)).map((g) => g.name),
      ...selectedFriendUids.map(friendNameOf),
    ].join(', ');
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
              const ed = beaconExpiry(chosen); // 4am the next morning, not midnight

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
                  friendUids: tourSafeFriendUids(),
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
    // Welcome step 1: a local practice light (see practiceLit). No confirm, no write.
    if (onWelcomeBeacon && !isLit) {
      setPracticeLit((v) => !v);
      return;
    }
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

  // The hidden stoke (components/StokeModal): a long hold on the lit fire, only once the beacon has
  // been relit and not yet stoked. Otherwise a long hold does nothing at all, by design.
  const openStoke = () => {
    if (!isLit || !myActiveBeacon || !myStokeReady || isActive) return;
    press();
    setStokeOpen(true);
  };

  // Time poll composer: the Day chips + Time fields above pick a slot, this adds it as an option.
  const composedOption = (): Omit<TimeOption, 'id'> | null => {
    const d = startOfDay(new Date());
    d.setDate(d.getDate() + dayOffset);
    if (!timeHourInput.trim() && timeMinuteInput.trim()) return null; // minutes without an hour
    return { dayMs: startOfDay(d).getTime(), timeHHmm: buildTimeHHmm(timeHourInput, timeMinuteInput, timeMeridiem) };
  };
  const addPollOption = () => {
    const o = composedOption();
    if (!o) { Alert.alert('Time', 'Add an hour, or clear the time.'); return; }
    if (pollOptions.some((x) => sameOption(x, o))) { warning(); return; }
    if (pollOptions.length >= MAX_TIME_OPTIONS) { warning(); return; }
    selection();
    setPollOptions((cur) => sortOptions([...cur, { id: newOptionId(), ...o }]));
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

    if (pollOn && pollOptions.length < 2) {
      Alert.alert('Add another time', 'Give friends at least 2 options to vote on, or turn off voting.');
      return false;
    }

    try {
      const base = startOfDay(new Date());
      const d = new Date(base);
      d.setDate(base.getDate() + dayOffset);
      // Editing LAST NIGHT'S beacon after midnight (still live in its 4am grace): the day chips
      // start at the new day, so "Today" would silently move it to tonight and give it another
      // full day. Keep its own day unless a later day was actually picked.
      const lastNight =
        isLit && myActiveBeacon && myActiveBeacon.startAt.getTime() < base.getTime() && dayOffset === 0;
      const sd = lastNight ? startOfDay(myActiveBeacon.startAt) : startOfDay(d);
      const ed = beaconExpiry(sd); // 4am the next morning, not midnight

      const beaconsRef = collection(db, 'Beacons');
      const ownerName = profile?.displayName || profile?.username || null;

      const timeHHmm = buildTimeHHmm(timeHourInput, timeMinuteInput, timeMeridiem);
      // A time poll replaces the day/time with its options (see openPollBeaconFields), and saving one
      // LIGHTS the beacon: friends can only vote on a beacon they can see. Turning voting off on an
      // open poll removes it; a decided poll is left alone as the record of what was picked.
      const pollFields = pollOn ? openPollBeaconFields(pollOptions) : null;
      const dropOpenPoll = !pollOn && myTimePoll?.status === 'open' ? { timePoll: deleteField() } : {};

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
          friendUids: tourSafeFriendUids(),
          timeHHmm,
          ...dropOpenPoll,
          ...(pollFields ?? {}),
        });
      } else {
        // A poll's doc is keyed to its FIRST option day (its startAt).
        if (pollFields) sd.setTime(pollFields.startAt.toMillis());
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
            active: !!pollFields,
            scheduled: true,
            startAt: Timestamp.fromDate(sd),
            expiresAt: Timestamp.fromDate(ed),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            groupIds: tourSafeGroupIds(), // tour-time saves are ALWAYS test-scoped
          friendUids: tourSafeFriendUids(),
            timeHHmm,
            ...dropOpenPoll,
            ...(pollFields ?? {}),
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

  const handleSheetSave = async () => {
    await saveBeaconOptions();
  };
  const handleSheetCancel = () => {
    tap();
    setOptionsOpen(false);
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
          <BeaconScene skin={skin} active={fireLit} focused={isFocused} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} people={scenePeople} />
          {/* SMOKE, drifts up BEHIND the friend tiles (shown through the gaps; the tile list stays
              in front and untouched). Rises from the measured structure anchor. Registry-driven:
              skin.smokeKind picks the ambient smoke, the smoke-signal puff column, the fireworks
              show, the sky-lantern field, the bonfire's spiral ember column, or nothing. */}
          {skin.smokeKind === 'signal' ? (
            <BeaconSmokeSignal skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.smokeKind === 'fireworks' ? (
            <BeaconFireworks skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} people={scenePeople} />
          ) : skin.smokeKind === 'lanterns' ? (
            <BeaconSkyLanterns skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.smokeKind === 'embers' ? (
            <BeaconEmberColumn skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.smokeKind === 'ambient' ? (
            <BeaconSmoke skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : null}
          {/* The bonfire's flame BODY lives here, behind the tiles AND behind the structure below,
              so the pyre's front logs occlude the flame base and the wood burns INSIDE the fire
              (the structure adds its own front licks on top). */}
          {skin.fire === 'pyre' && (
            <BeaconBonfireFlame skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          )}
          {(() => {
            const resumeVisible = onboarding.loaded && !onboarding.allDone && !isActive && !pendingAutoStart;
            const banner = (
              <TutorialResumeBanner
                visible={resumeVisible}
                doneCount={onboarding.doneCount}
                total={onboarding.total}
                nextLabel={onboarding.firstIncomplete?.label}
                onPress={() => startSetup({ onClose: () => { firstTourDoneRef.current = true; } })}
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
              notched phones). The +8 is the only gap kept above it: enough that the options card's
              shadow doesn't run into the bar. (The test-beacon warning that used to need a 34px
              band here now lives in the card's subtitle.)
              onLayout: re-anchor the fire whenever THIS container's frame shifts (a layout change
              here moves the logs without firing the logs wrapper's own onLayout, which once left
              every skin's flame painted too low after a fast-refresh). */}
          <View
            style={[styles.controls, { marginBottom: 64 + Math.max(insets.bottom, 8) + 8 }]}
            onLayout={measureBeaconAnchor}
          >
            <View style={styles.myBeaconColumn}>
              <View ref={logsRef} collapsable={false} style={{ position: 'relative' }} onLayout={measureBeaconAnchor}>
                {/* onLongPress is ALWAYS set so a long hold never falls through to a toggle; it only
                    does something when the hidden stoke is armed (see openStoke). */}
                <TouchableOpacity onPress={toggleBeacon} onLongPress={openStoke} delayLongPress={600} disabled={toggleBusy} activeOpacity={0.7} style={styles.beaconContainer}>
                  <BeaconStructure skin={skin} size={180} lit={fireLit} focused={isFocused} />
                </TouchableOpacity>

                {!isActive && (
                  <Pressable onPress={() => beginWelcome(true)} hitSlop={12} style={styles.helpBtn} accessibilityRole="button" accessibilityLabel="How BeKin works">
                    <Ionicons name="help-circle" size={28} color={colors.primary} />
                  </Pressable>
                )}

                {/* Wacky Wednesday: Wednesdays only, stacked just above the help button. Hidden
                    while a tour runs, like the help button, so coach marks stay uncluttered. */}
                {!isActive && <WackyWednesday today={todayStart} style={styles.wackyBtn} />}

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

              {/* Fixed-height slot so the logs sit at the SAME height whether it holds the chat pill
                  [lit] or the caption [unlit], both centered in it. */}
              <View style={styles.beaconActionSlot}>
                {isLit && myActiveBeacon ? (
                  // Compact ember-glass pill. Who's going rides inside it, except on skins whose
                  // scene already shows the people by name (skin.showsPeople, e.g. The Beacons).
                  <TouchableOpacity
                    onPress={() => { tap(); setSelectedBeacon(myActiveBeacon); }}
                    activeOpacity={0.8}
                    style={styles.chatPill}
                    accessibilityRole="button"
                    accessibilityLabel={myUnread > 0 ? `Open beacon chat, ${myUnread} unread` : 'Open beacon chat'}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={19} color={EMBER_TEXT} />
                    <Text style={styles.chatPillTxt} numberOfLines={1}>
                      Chat
                      {!skin.showsPeople && myGoing.going.length > 0 ? (
                        <Text style={styles.chatPillGoing}>{`  ·  ${goingNames(myGoing.going)} going`}</Text>
                      ) : null}
                    </Text>
                    {myUnread > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeTxt}>{myUnread > 9 ? '9+' : myUnread}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ) : null}
                {(isLit && myActiveBeacon) || practiceLit ? null : (
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
                {/* ONLY test selected: that group's members get nothing (audience = union of selected
                    groups; test adds nobody), so warn here instead of the usual hint. */}
                {!!user?.uid && selectedGroupIds.length === 1 && selectedGroupIds[0] === `${user.uid}__tutorial_test` && selectedFriendUids.length === 0 ? (
                  <Text style={[styles.optionsCtaSubtitle, { color: '#F59E0B', fontWeight: '600' }]} numberOfLines={1}>
                    Test beacon: friends won&apos;t see it
                  </Text>
                ) : (
                  <Text style={[styles.optionsCtaSubtitle, { color: colors.subtle }]} numberOfLines={1}>Pick a day • choose friends • add a note</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={22} color={colors.primary} />
            </Pressable>
          </View>

          {/* FIRE, last child, on TOP of the structure (pointerEvents none, taps reach the structure
              + chat button below). Registry-driven: skin.fire picks the Skia flame, a sweeping beam
              (routed by structure: lighthouse vs the premiere searchlight), the storm's short-lived
              lightning strike, or nothing (skins whose structure owns its light: lanterns, rune
              stone, sky-lantern stand). */}
          {skin.fire === 'beam' ? (
            skin.structure === 'searchlight' ? (
              <BeaconSearchlightBeam skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
            ) : (
              <BeaconLighthouseBeam skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
            )
          ) : skin.fire === 'bolt' ? (
            <BeaconStormBolt skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.fire === 'print' ? (
            <BeaconPrintFire skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
          ) : skin.fire === 'flame' ? (
            <BeaconFire skin={skin} active={fireLit} anchorX={beaconAnchor.x} anchorY={anchorY} measured={beaconAnchor.measured} focused={isFocused} />
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

                {/* maxHeight is load-bearing: the KAV (behavior "position") slides the whole card up
                    without resizing it, so without a cap the ScrollView still thinks its content fits
                    and rubber-bands instead of scrolling, leaving the style grid unreachable above the
                    screen while typing. Cap = window minus keyboard, top inset, and the card chrome. */}
                <ScrollView
                  ref={optionsScrollRef}
                  style={{ maxHeight: winH - insets.top - (kbVisible ? kbHeight : insets.bottom) - 140 }}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ paddingBottom: 12 }}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Beacon style (skin), switches the home beacon live. FIXED-WIDTH 3-across grid:
                      the chips used to size to their text, so the selected chip's bold label
                      changed its width and the whole wrap reflowed on every tap. Now every chip is
                      the same size and nothing ever moves. Selecting a style also opens a live
                      preview box that overlays the fields below until dismissed. */}
                  <View style={stylePreviewOpen ? styles.styleZTop : undefined}>
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
                        <StylePreview skin={skin} anchor={beaconAnchor} onClose={() => setStylePreviewOpen(false)} />
                      </View>
                    )}
                  </View>

                  {/* Day, time, friend groups, and message: wrapped so the tour highlights them together. */}
                  <View>
                  {/* Day */}
                  <Text style={[styles.modalLabel, { marginTop: 12, color: colors.text }]}>Day</Text>
                  <View style={styles.daysWrap}>
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
                  <Text style={[styles.modalLabel, { marginTop: 12, color: colors.text }]}>Time</Text>
                  <View ref={timeRef} collapsable={false} style={styles.timeRow}>
                    <TextInput
                      style={[styles.timeInput, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.text }]}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="--"
                      placeholderTextColor={colors.subtle}
                      value={timeHourInput}
                      onChangeText={(s) => setTimeHourInput(s.replace(/\D/g, '').slice(0, 2))}
                      onFocus={() => scrollSheetFieldIntoView(timeRef)}
                      returnKeyType="next"
                      accessibilityLabel="Hour"                    />
                    <Text style={[styles.timeColon, { color: colors.text }]}>:</Text>
                    <TextInput
                      style={[styles.timeInput, { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.text }]}
                      keyboardType="number-pad"
                      maxLength={2}
                      placeholder="00"
                      placeholderTextColor={colors.subtle}
                      value={timeMinuteInput}
                      onChangeText={(s) => setTimeMinuteInput(s.replace(/\D/g, '').slice(0, 2))}
                      onFocus={() => scrollSheetFieldIntoView(timeRef)}
                      returnKeyType="done"
                      accessibilityLabel="Minute"                    />
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

                  {/* Group scheduling: offer several day/time options and let friends vote in the chat.
                      With it on, the Day chips + Time fields above compose the option to add. */}
                  <View style={[styles.pollCard, { backgroundColor: colors.inputBg, borderColor: pollOn ? colors.primary : colors.border }]}>
                    <View style={styles.pollHeadRow}>
                      <Ionicons name="sparkles" size={18} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.pollTitle, { color: colors.text }]}>Let friends vote on the time</Text>
                        <Text style={[styles.pollSub, { color: colors.subtle }]}>
                          {pollOn
                            ? 'Pick a day and time above, then add it. Friends vote in the chat and you lock one in.'
                            : "Not sure when? Offer a few options."}
                        </Text>
                      </View>
                      <Switch
                        value={pollOn}
                        onValueChange={(v) => { selection(); setPollOn(v); }}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor="#fff"
                        {...WEB_WHITE_KNOB}
                        accessibilityLabel="Let friends vote on the time"
                      />
                    </View>
                    {pollOn ? (
                      <>
                        {pollOptions.length > 0 && (
                          <View style={styles.pollChips}>
                            {pollOptions.map((o) => (
                              <View key={o.id} style={[styles.pollChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.pollChipTxt, { color: colors.text }]}>{optionLabel(o)}</Text>
                                <Pressable
                                  onPress={() => { tap(); setPollOptions((cur) => cur.filter((x) => x.id !== o.id)); }}
                                  hitSlop={8}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Remove ${optionLabel(o)}`}
                                >
                                  <Ionicons name="close-circle" size={18} color={colors.subtle} />
                                </Pressable>
                              </View>
                            ))}
                          </View>
                        )}
                        {pollOptions.length < MAX_TIME_OPTIONS ? (
                          <Pressable
                            onPress={addPollOption}
                            style={({ pressed }) => [styles.pollAddBtn, { borderColor: colors.primary }, pressed && { opacity: 0.8 }]}
                            accessibilityRole="button"
                          >
                            <Ionicons name="add-circle" size={18} color={colors.primary} />
                            <Text style={[styles.pollAddTxt, { color: colors.primary }]} numberOfLines={1}>
                              {(() => {
                                const o = composedOption();
                                if (!o) return 'Add this time';
                                // Already in the list: say so instead of offering a button that just buzzes.
                                if (pollOptions.some((x) => sameOption(x, o))) return 'Added. Pick another day or time';
                                return `Add ${optionLabel({ id: '', ...o })}`;
                              })()}
                            </Text>
                          </Pressable>
                        ) : null}
                        <Text style={[styles.pollHint, { color: colors.subtle }]}>
                          {pollOptions.length < 2
                            ? `Add at least ${2 - pollOptions.length} more. Saving lights your beacon so friends can vote.`
                            : 'Saving lights your beacon so friends can vote.'}
                        </Text>
                      </>
                    ) : myTimePoll?.status === 'decided' ? (
                      <Text style={[styles.pollHint, { color: colors.subtle }]}>
                        {(() => {
                          const o = myTimePoll.options.find((x) => x.id === myTimePoll.decidedId);
                          return o ? `Last vote locked in ${optionLabel(o)}.` : '';
                        })()}
                      </Text>
                    ) : null}
                  </View>

                  {/* Friend Groups */}
                  <View>
                  <Text style={[styles.modalLabel, { marginTop: 12, color: colors.text }]}>
                    Friend groups or friends (if none selected, all friends can see)
                  </Text>
                  {loadingGroups ? (
                    <View style={{ paddingVertical: 6 }}>
                      <ActivityIndicator />
                    </View>
                  ) : (
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
                      {/* Friends picked one by one: a selected chip each (tap removes), then the "+"
                          that opens the picker. Same chip style as the groups. */}
                      {selectedFriendUids.map((uid) => (
                        <Pressable
                          key={`f:${uid}`}
                          onPress={() => {
                            selection();
                            setSelectedFriendUids((prev) => prev.filter((x) => x !== uid));
                          }}
                          style={[styles.dayChip, styles.dayChipActive, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                          accessibilityRole="button"
                          accessibilityLabel={`${friendNameOf(uid)}, tap to remove`}
                        >
                          <Text style={[styles.dayChipText, styles.dayChipTextActive]}>{friendNameOf(uid)}</Text>
                        </Pressable>
                      ))}
                      <Pressable
                        onPress={() => { tap(); setFriendPickerOpen(true); }}
                        style={[styles.dayChip, styles.plusChip, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
                        accessibilityRole="button"
                        accessibilityLabel="Add friends"
                      >
                        <Ionicons name="add" size={18} color={colors.text} />
                      </Pressable>
                    </View>
                  )}
                  {!loadingGroups && groups.length === 0 && selectedFriendUids.length === 0 && (
                    <Text style={{ color: colors.subtle, marginTop: 6, marginBottom: 6 }}>
                      {online ? 'No groups yet. Create some in Friends, or tap + to pick friends.' : "Can't load groups. No internet connection."}
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
                    onFocus={() => scrollSheetFieldIntoView(messageRef)}
                    maxLength={BEACON_MESSAGE_MAX}
                    multiline
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
                {/* Keyboard-dismiss button, floating in the card's bottom-right corner (absolute, so
                    it adds no height). This used to be an iOS InputAccessoryView, which renders its
                    content blank on the new architecture (the bar reserved space above the keyboard
                    but the Done button never drew). The card's bottom edge sits flush on the
                    keyboard (KAV "position"), so the button lands just above the keyboard's top
                    right, and it works on Android too. */}
                {kbVisible && (
                  <Pressable
                    onPress={() => { tap(); Keyboard.dismiss(); }}
                    hitSlop={12}
                    style={{ position: 'absolute', right: 16, bottom: 14 }}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss keyboard"
                  >
                    <MaterialCommunityIcons name="keyboard-close-outline" size={26} color={colors.subtle} />
                  </Pressable>
                )}
              </Animated.View>
            </KeyboardAvoidingView>
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
                  <ChatRoom
                    beaconId={selectedBeacon.id}
                    targetMessageId={selectedBeaconMessageId}
                    style={{ flex: 1 }}
                    onViewProfile={(username) => {
                      setSelectedBeacon(null);
                      setSelectedBeaconMessageId(undefined);
                      router.push(`/profile/${username}`);
                    }}
                  />
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <FriendPickerSheet
          visible={friendPickerOpen}
          onClose={() => setFriendPickerOpen(false)}
          friends={myFriends}
          loading={loadingFriends}
          selected={selectedFriendUids}
          onChange={setSelectedFriendUids}
        />
      </SafeAreaView>

      {!optionsRendered && <BottomBar />}

      {/* First-time beacon notification onboarding */}
      <StokeModal
        visible={stokeOpen}
        beaconId={myActiveBeacon?.id ?? null}
        currentMessage={myActiveBeacon?.message || DEFAULT_BEACON_MESSAGE}
        onClose={() => setStokeOpen(false)}
      />
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
                    // Opt into friend-beacon pushes (the NOTIFY FLAG the server's recipientWantsNotify
                    // checks) and chat pings for beacons they're in. Non-fatal, see the helper.
                    await enableDefaultNotifyFlags();
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
    // Tiles are priority info: the FIRE layer is the last child of this screen (so it paints over
    // the structure), which also let a tall flame paint over the lower tiles. Lift the list above it.
    zIndex: 5,
    elevation: 5,
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
  // Same column as helpBtn, one button-height (28) + 10 gap higher.
  wackyBtn: {
    position: 'absolute',
    bottom: 46,
    right: -34,
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
  // Fixed slot below the logs; the pill or caption centers in it so the logs don't shift between
  // lit and unlit.
  beaconActionSlot: {
    // Pull up into the logs box's empty bottom. minHeight = the 46pt chat pill + 11pt of air on each
    // side, so it clears the base (The Beacons' plinth runs nearly to the box edge) and the
    // Beacon options card by ~12pt: three tap targets stacked here must never be mis-hit.
    marginTop: -10,
    minHeight: 68,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Chat pill: dark glass with an ember edge so it reads as firelight in the scene, not app chrome
  // (blue stays the one primary, Beacon options; orange is Rally's).
  chatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    minWidth: 240, // wide, easy target: the space under the pyre is open
    maxWidth: '92%',
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(253,186,116,0.55)',
  },
  chatPillTxt: { color: EMBER_TEXT, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  chatPillGoing: { fontWeight: '500' },
  // Unread count: a solid ember dot, so "something to see" reads at a glance against the glass.
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#FB923C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeTxt: { color: '#1C0A00', fontSize: 12, fontWeight: '800' },

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
  // The "+" (add friends) chip: same height as a text chip, squared off so it reads as a button.
  plusChip: { paddingHorizontal: 9, paddingVertical: 5, alignItems: 'center', justifyContent: 'center' },
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
  pollCard: { marginTop: 14, borderWidth: 1, borderRadius: 14, padding: 12 },
  pollHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pollTitle: { fontSize: 15, fontWeight: '800' },
  pollSub: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  pollChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pollChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 7, paddingLeft: 12, paddingRight: 8 },
  pollChipTxt: { fontSize: 13.5, fontWeight: '700' },
  pollAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  pollAddTxt: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  pollHint: { fontSize: 12, marginTop: 8 },
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
    // Minimal: 10 keeps the card ~64px tall (34px icon + two text lines), well over the 44pt tap
    // minimum, and lets the pyre sit lower on the screen.
    paddingVertical: 10,
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
  optionsCtaPressed: { transform: [{ scale: 0.99 }], opacity: 0.95 },
  optionsCtaIconWrap: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  optionsCtaTextWrap: { flex: 1, alignItems: 'center' },
  optionsCtaTitle: { fontSize: 19, fontWeight: '800', color: '#0B1426', textAlign: 'center' },
  optionsCtaSubtitle: { marginTop: 2, color: '#48608C', textAlign: 'center' },
});