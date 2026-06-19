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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeaconStructure from '../components/BeaconStructure';
import BeaconScene from '../components/BeaconScene';
import BeaconFire from '../components/BeaconFire';
// Skia (GPU shader) smoke — drop-in for the old SVG BeaconSmoke. Revert by swapping this import
// back to '../components/BeaconSmoke' (kept in the repo as the no-native-dep fallback).
import BeaconSmoke from '../components/BeaconSmokeSkia';
import { getSkin, DEFAULT_SKIN_ID, BEACON_SKINS } from '../lib/beaconSkins';
import { getBeaconSkinId, setBeaconSkinId, onBeaconSkinChange } from '../lib/beaconSkinPref';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { auth, db } from '../firebase.config';
import {
  addDoc,
  arrayUnion,
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
import { buildTimeHHmm, parseTimeHHmm } from '../lib/beaconTime';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { useOnline } from '../providers/NetworkProvider';
import { tap, press, selection, success } from '../utils/haptics';
import TutorialResumeBanner from '../components/tutorial/TutorialResumeBanner';
import { buildBeaconTour } from '../components/tutorial/tourSteps';
import { useTour, useTourTarget } from '../providers/TourProvider';
import { useOnboarding } from '../providers/OnboardingProvider';
import { getSeen, setSeen } from '../lib/tutorialFlags';
import { ensureNotifyPermission } from '../lib/notifyPermission';
import { useFireSound } from '../lib/useFireSound';
import { getFireSoundEnabled, setFireSoundEnabled, onFireSoundChange } from '../lib/fireSoundPref';

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

const DEFAULT_BEACON_MESSAGE = 'Hang out at my place?';
// Pre-filled into the very first beacon during the onboarding tutorial so new users
// announce that they've joined. Only used for the guided first beacon, never the default.
const FIRST_BEACON_INTRO = 'I just joined BeKin — hi! 👋';
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
  const params = useLocalSearchParams<{ beaconId?: string; messageId?: string; tutorial?: string; tourTarget?: string }>();
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
  const optionsAnim = useRef(new Animated.Value(0)).current;
  const [kbVisible, setKbVisible] = useState(false);
  const [dayOffset, setDayOffset] = useState<number>(0); // 0..6 selected chip
  const [timeHourInput, setTimeHourInput] = useState<string>("");   // 1..12 as typed
  const [timeMinuteInput, setTimeMinuteInput] = useState<string>(""); // 00..59 as typed
  const [timeMeridiem, setTimeMeridiem] = useState<"AM" | "PM">("AM");

  // Inline error: only the range-violation case, and only once a field has
  // 2 characters in it. Don't warn about "missing the other field" — typing
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
  const { startTour, isActive, currentStepId, currentStepTarget, goToTarget } = useTour();
  // Base-setup progress (username + friend + notifications) drives the resume banner.
  const onboarding = useOnboarding();
  const logsRef = useTourTarget('beacon-logs');
  const optionsCtaRef = useTourTarget('beacon-options-cta');
  const dayRef = useTourTarget('sheet-day');
  const timeRef = useTourTarget('sheet-time');
  const groupsRef = useTourTarget('sheet-groups');
  const messageRef = useTourTarget('sheet-message');
  const beaconStyleRef = useTourTarget('beacon-style');
  const chatTarget = useTourTarget('beacon-chat');
  // The home page View — the coordinate basis for the fire/smoke layers. Both <Svg> layers are
  // position:absolute top:0 left:0 inside styles.page, so we measure the logs RELATIVE TO this view
  // (logs window pos − page window pos). That collapses the whole nesting chain into one offset and
  // is immune to safe-area insets / padding above. REQUIRES styles.page to keep paddingTop:0 and
  // paddingHorizontal:0 with no border, or the flame lands off the logs.
  // Selected beacon SKIN (device-local pref; default Old Guard) — drives fire, smoke, and structure.
  const [skinId, setSkinId] = useState(DEFAULT_SKIN_ID);
  const skin = getSkin(skinId);
  useEffect(() => {
    let mounted = true;
    getBeaconSkinId().then((id) => mounted && setSkinId(id));
    const off = onBeaconSkinChange((id) => setSkinId(id));
    return () => { mounted = false; off(); };
  }, []);

  const pageRef = useRef<View>(null);
  // The flame base position within the structure box comes from the skin (0 = top, 1 = bottom); read
  // via a ref so the measure callback stays stable. Re-measured when the skin changes.
  const originRef = useRef(skin.origin);
  originRef.current = skin.origin;
  const [beaconAnchor, setBeaconAnchor] = useState({ x: 0, y: 0, measured: false });
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
          setBeaconAnchor({ x: lx - px + lw / 2, y: ly - py + lh * originRef.current, measured: true });
        });
      });
    };
    requestAnimationFrame(attempt);
  }, [logsRef]);
  // Re-measure when the window changes (rotation, or the safe-area inset settling after first paint),
  // since the logs View's onLayout won't necessarily re-fire if only its window position shifts.
  const { width: winW, height: winH } = useWindowDimensions();
  useEffect(() => {
    measureBeaconAnchor();
  }, [winW, winH, measureBeaconAnchor, skinId]);

  // Fire SFX (device-local "Fire sounds" pref, default off). ignite plays on the lighting edge via
  // BeaconFire.onIgnited; the crackle loop tracks the lit state. Needs a native build (expo-audio).
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
  const prevLitForSoundRef = useRef(isLit);
  useEffect(() => {
    const was = prevLitForSoundRef.current;
    prevLitForSoundRef.current = isLit;
    if (!soundLoaded) return; // wait for the pref so a muted user never hears a startup blip
    fireSound.setLit(!!isLit);
    if (isLit && was === false) {
      fireSound.playIgnite();
      success();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLit, fireSoundOn, soundLoaded]);
  // Whether the user has ≥1 friend — read when the tour is built so it can drop the "Add Brian"
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
    try {
      const perm = await Notifications.getPermissionsAsync();
      // 'granted' is true on iOS once allowed. On Android the boolean is the
      // canonical signal too. If granted, skip — user has already opted in.
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
          return;
        }
        const d: any = snap.data();
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
      }
    })();
  }, [params.beaconId, params.messageId]);

  // Friend groups state for scheduler
  const [groups, setGroups] = useState<FriendGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // ---------- SUBSCRIBE: your beacon(s) (next 7 days) ----------
  const todayStart = useMemo(() => startOfDay(new Date()), []);
  const windowEnd = useMemo(() => {
    const end = endOfDay(new Date(todayStart));
    end.setDate(end.getDate() + 6);
    return end;
  }, [todayStart]);

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
          const gids: string[] = Array.isArray(activeDoc.data?.groupIds)
            ? activeDoc.data.groupIds.filter((x: any) => typeof x === 'string')
            : [];
          setSelectedGroupIds(gids);
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

          const gids: string[] = Array.isArray(plannedSoonest.data?.groupIds)
            ? plannedSoonest.data.groupIds.filter((x: any) => typeof x === 'string')
            : [];
          setSelectedGroupIds(gids);
        } else {
          setNextPlannedDate(null);
          setPlannedTimeHHmm(null);
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
    const appStateHandler = ({ type }: any) => {
      if (type === 'active') onFocus();
    };
    const AppState = require('react-native').AppState;
    const subState = AppState.addEventListener('change', appStateHandler);
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

  // Chips for the next 7 days (for Options Modal)
  const next7Days = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const label =
        i === 0
          ? 'Today'
          : d.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            });
      return { date: d, label, offset: i };
    });
  }, []);

  // Load friend groups — **skip unnamed groups** (no "Untit empty Group" fallback)
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
      setTimeMeridiem('AM');
    }

    setOptionsOpen(true);
  };

  // Guided first beacon (final tour step): pre-fill an intro message + default to today and OPEN
  // the options sheet — editing options and hitting Save is how you set a beacon, and doing so
  // completes the tour (see the beacon-set effect below). Per-run only; defaults are untouched.
  const startFirstBeacon = () => {
    setMessage(FIRST_BEACON_INTRO);
    setPlannedMessage(FIRST_BEACON_INTRO);
    setDayOffset(0);
    setTimeHourInput('');
    setTimeMinuteInput('');
    setTimeMeridiem('AM');
    setSelectedGroupIds([]);
    setOptionsOpen(true);
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

  // Start (or replay) the beacon coach-mark tour. `startAtTarget` lets the resume banner jump to
  // the earliest incomplete setup step.
  const pendingStartTargetRef = useRef<string | undefined>(undefined);
  const startBeaconTour = (opts?: { startAtTarget?: string }) => {
    // Never build the tour before the friend count is known — otherwise the add-brian step can be
    // wrongly kept (the auto-start/resume/banner/help entry points all funnel through here). Defer
    // via the pendingAutoStart machinery, which re-fires this once isLit + friendsLoaded are ready
    // (remembering the requested jump target across the defer).
    if (!friendsLoaded) {
      pendingStartTargetRef.current = opts?.startAtTarget;
      setPendingAutoStart(true);
      return;
    }
    startTour(
      buildBeaconTour({
        openSheet: () => setOptionsOpen(true),
        closeSheet: () => setOptionsOpen(false),
        goFriends: () => router.navigate('/friends'),
        goHome: () => router.navigate('/home'),
        goSettings: () => router.navigate('/settings'),
        // The notifications step lives on /settings; jump back Home before opening the beacon sheet.
        openFirstBeacon: () => { router.navigate('/home'); startFirstBeacon(); },
        hasFriends: hasFriendsRef.current,
        // Whether the user ALREADY has a beacon (lit / active / planned) when the tour is built —
        // switches the final step to the "you're all set" wrap-up instead of "set your first beacon".
        hasBeacon: !hasNoBeaconYet,
        online,
        onEnableNotifications: enableBeaconNotifications,
      }),
      {
        startAtTarget: opts?.startAtTarget,
        onFinish: () => {
          success();
          setSeen('beacon');
        },
        // Dismissing the main tour ANY way (skip or finish) also satisfies the standalone chat
        // explainer — the chat is already covered by step 1's branch — so it never pops on the
        // first light right after the user skips. (onClose fires on both skip and finish.)
        onClose: () => {
          setSeen('beacon_chat');
        },
      }
    );
  };

  // The final tour step is ALWAYS shown and completes only when the user taps Done — never
  // auto-skipped, even when setup + a lit beacon are already done (that case just gets the
  // celebratory "you're all set" variant; see buildBeaconTour's hasBeacon branch). Tapping Done
  // ends the tour via onFinish (setSeen('beacon') + the success haptic).

  // If the user LIGHTS the beacon during tour step 1, opt into the chat mini-step (a branch) so we
  // explain the chat right there. Marks beacon_chat seen so the post-tour explainer won't repeat it.
  // Edge-gated on a real false→true light: starting the tour with an already-lit beacon (e.g. the
  // help-button replay) must NOT jump straight to the branch, and stepping Back into step 1 must not
  // re-bounce. Entered without pushing history so the branch shows no Back button.
  const prevLitForBranchRef = useRef(isLit);
  useEffect(() => {
    const wasLit = prevLitForBranchRef.current;
    prevLitForBranchRef.current = isLit;
    if (isActive && currentStepId === 'light-beacon-demo' && isLit && !wasLit && myActiveBeacon) {
      setSeen('beacon_chat');
      // Push history so Back from the chat mini-step returns to the fire/logs step (the edge-gate
      // above stops it from immediately re-branching when Back lands back on step 1).
      goToTarget('beacon-chat');
    }
  }, [isActive, currentStepId, isLit, myActiveBeacon, goToTarget]);

  // Keep the options sheet OPEN whenever the tour is on a sheet step — including when the user steps
  // BACK into one from a later screen. (The per-step onEnter's openSheet closure can be stale after a
  // Stack re-mount, so drive sheet-open from the CURRENT step on the live home instance.)
  useEffect(() => {
    const SHEET_TARGETS = ['beacon-style', 'sheet-day', 'sheet-time', 'sheet-groups', 'sheet-message'];
    if (isActive && currentStepTarget && SHEET_TARGETS.includes(currentStepTarget)) {
      setOptionsOpen(true);
    }
  }, [isActive, currentStepTarget]);

  // One-time beacon-chat explainer: the first time the user has a LIT beacon while username + friend
  // are set (and no tour is mid-flow — e.g. right after the final tour step lights it, or any later
  // light), spotlight the "Open beacon chat" button and explain it. Highlight only, never opens it.
  const usernameDone = !!onboarding.steps.find((s) => s.key === 'username')?.done;
  const friendDone = !!onboarding.steps.find((s) => s.key === 'friend')?.done;
  const chatExplainerShownRef = useRef(false);
  useEffect(() => {
    if (!isLit || !myActiveBeacon || !usernameDone || !friendDone || isActive || chatExplainerShownRef.current) return;
    chatExplainerShownRef.current = true;
    getSeen('beacon_chat').then((seen) => {
      if (seen) return;
      startTour(
        [
          {
            target: 'beacon-chat',
            title: 'Your beacon chat',
            body: "Friends who can see your beacon can RSVP and chat here — tap it any time to open the conversation.",
            cta: 'Got it',
          },
        ],
        { onFinish: () => setSeen('beacon_chat'), onClose: () => setSeen('beacon_chat') }
      );
    });
  }, [isLit, myActiveBeacon, usernameDone, friendDone, isActive]);

  // Decide ONCE whether to auto-pop the tour for a new user (the resume banner takes over after).
  // Skipped when arriving via a notification deep link so we don't cover the opened beacon.
  const [pendingAutoStart, setPendingAutoStart] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (params.beaconId) return;
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
  }, []);

  // Start the auto-shown tour only once Home's content (hence the spotlight targets) is mounted —
  // i.e. after isLit resolves — and the friend count is known. Also re-fires a deferred start
  // (banner/resume) once those are ready, preserving the requested jump target.
  useEffect(() => {
    if (pendingAutoStart && isLit !== null && friendsLoaded) {
      setPendingAutoStart(false);
      const t = pendingStartTargetRef.current;
      pendingStartTargetRef.current = undefined;
      startBeaconTour(t ? { startAtTarget: t } : undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoStart, isLit, friendsLoaded]);

  // Resume the tutorial when navigated here from the resume banner on another screen, optionally
  // jumping to the first incomplete step (?tourTarget=...).
  useEffect(() => {
    if (params.tutorial === '1') {
      const t = typeof params.tourTarget === 'string' ? params.tourTarget : undefined;
      startBeaconTour(t ? { startAtTarget: t } : undefined);
      router.setParams({ tutorial: undefined as any, tourTarget: undefined as any });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tutorial]);

  // Track keyboard visibility so the options sheet can drop its home-indicator padding while
  // typing — keeps the Save/Cancel row tight to the keyboard's Done bar.
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKbVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Slide the options sheet in/out; keep it mounted through the exit animation.
  useEffect(() => {
    if (optionsOpen) {
      setOptionsRendered(true);
      Animated.timing(optionsAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      Animated.timing(optionsAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setOptionsRendered(false);
      });
    }
  }, [optionsOpen, optionsAnim]);

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
  const toggleBeacon = () => {
    const action = isLit ? 'Extinguish' : 'Light';
    Alert.alert(`${action} Beacon`, `Are you sure you want to ${action.toLowerCase()} your beacon?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: isLit ? 'destructive' : 'default',
        onPress: async () => {
          press();
          const user = auth.currentUser;
          if (!user) {
            Alert.alert('Error', 'User not authenticated');
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
              const base = startOfDay(new Date());
              const chosen = nextPlannedDate
                ? startOfDay(nextPlannedDate)
                : (() => {
                    const d = new Date(base);
                    d.setDate(base.getDate() + dayOffset);
                    return startOfDay(d);
                  })();
              const sd = startOfDay(chosen);
              const ed = endOfDay(chosen);

              const meUid = user.uid;
              let allowedUids: string[] = [meUid];
              groups
                .filter((g) => selectedGroupIds.includes(g.id))
                .forEach((g) => {
                  allowedUids.push(...g.memberUids);
                });
              allowedUids = Array.from(new Set(allowedUids));

              const ownerName = profile?.displayName || profile?.username || null;
              await addDoc(beaconsRef, {
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
                groupIds: selectedGroupIds,
                allowedUids,
              });

              // First-time creator might not have notification permission yet —
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
                  .filter((b) => b.data()?.active !== true)
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
          }
        },
      },
    ]);
  };

  // save options
  const saveBeaconOptions = async () => {
    press();
    const user = auth.currentUser;
    if (!user) return;

    // Catch the partial-input case here rather than inline — surfacing it
    // mid-typing would scold the user during normal hour-then-minutes flow.
    const hTrim = timeHourInput.trim();
    const mTrim = timeMinuteInput.trim();
    if ((hTrim && !mTrim) || (!hTrim && mTrim)) {
      Alert.alert('Time', 'Enter both hour and minutes, or clear the time.');
      return;
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

      const meUid = user.uid;
      let allowedUids: string[] = [meUid];
      groups
        .filter((g) => selectedGroupIds.includes(g.id))
        .forEach((g) => {
          allowedUids.push(...g.memberUids);
        });
      allowedUids = Array.from(new Set(allowedUids));

      if (isLit && myActiveBeacon) {
        await updateDoc(doc(db, 'Beacons', myActiveBeacon.id), {
          ownerName,
          message: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          details: (message || '').trim() || DEFAULT_BEACON_MESSAGE,
          startAt: Timestamp.fromDate(sd),
          expiresAt: Timestamp.fromDate(ed),
          scheduled: true,
          updatedAt: serverTimestamp(),
          groupIds: selectedGroupIds,
          allowedUids,
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
            groupIds: selectedGroupIds,
            allowedUids,
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
    } catch (e: any) {
      if (__DEV__) console.error(e);
      Alert.alert('Error', e?.message || 'Failed to save options.');
    }
  };

  // "I'm in" handler
  const handleImIn = async () => {
    const user = auth.currentUser;
    const b = selectedBeacon;
    if (!user || !b) return;

    try {
      await updateDoc(doc(db, 'Beacons', b.id), {
        inUids: arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
      });

      const name = profile?.displayName || profile?.username || 'Someone';
      await addDoc(collection(db, 'Beacons', b.id, 'ChatMessages'), {
        type: 'system',
        subtype: 'im-in',
        actorUid: user.uid,
        actorName: name,
        text: `${name} is in`,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      if (__DEV__) console.warn('im-in failed', e);
      Alert.alert('Error', 'Could not mark you as in. Try again.');
    }
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

  return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
        <View ref={pageRef} collapsable={false} style={styles.page}>
          {/* SCENE — backmost layer (only the mountains skin renders it): dusk sky + ridgelines +
              the distant beacon chain. Behind everything, pointerEvents none. */}
          <BeaconScene skin={skin} active={!!isLit} />
          {/* SMOKE — drifts up BEHIND the friend tiles (shown through the gaps; the tile list stays
              in front and untouched). Rises from the measured structure anchor. */}
          <BeaconSmoke skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={beaconAnchor.y} measured={beaconAnchor.measured} />
          <TutorialResumeBanner
            visible={onboarding.loaded && !onboarding.allDone && !isActive && !pendingAutoStart}
            doneCount={onboarding.doneCount}
            total={onboarding.total}
            nextLabel={onboarding.firstIncomplete?.label}
            onPress={() => startBeaconTour({ startAtTarget: onboarding.firstIncomplete?.target })}
          />
          <View style={styles.beaconsWrap}>
            <FriendsBeaconsList onSelect={setSelectedBeacon} showExampleWhenEmpty />
          </View>

          <View style={styles.controls}>
            <View style={styles.myBeaconColumn}>
              <View ref={logsRef} collapsable={false} style={{ position: 'relative' }} onLayout={measureBeaconAnchor}>
                <TouchableOpacity onPress={toggleBeacon} activeOpacity={0.7} style={styles.beaconContainer}>
                  <BeaconStructure skin={skin} size={180} lit={!!isLit} />
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
                  (taller) chat button [lit] or the caption [unlit] — both center within it. */}
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
                  <Text style={[styles.logHint, { color: colors.subtle }]}>Tap the logs to light your Beacon</Text>
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

          {/* FIRE — last child, on TOP of the structure (pointerEvents none, taps reach the structure
              + chat button below). Skipped for the lantern tower, which lights its own lanterns. */}
          {skin.structure !== 'tower' && (
            <BeaconFire skin={skin} active={!!isLit} anchorX={beaconAnchor.x} anchorY={beaconAnchor.y} measured={beaconAnchor.measured} />
          )}
        </View>

        {/* Options sheet — an in-tree overlay (not a RN <Modal>) so the coach-mark tour can point
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
                  {/* Beacon style (skin) — switches the home beacon live */}
                  <View ref={beaconStyleRef} collapsable={false}>
                    <Text style={[styles.modalLabel, { color: colors.text }]}>Beacon style</Text>
                    <View style={styles.daysWrap}>
                      {BEACON_SKINS.map((bs) => (
                        <Pressable
                          key={bs.id}
                          onPress={() => { selection(); setBeaconSkinId(bs.id); }}
                          style={[styles.dayChip, { backgroundColor: colors.inputBg, borderColor: colors.border }, bs.id === skinId && [styles.dayChipActive, { backgroundColor: colors.primary, borderColor: colors.primary }]]}
                        >
                          <Text style={[styles.dayChipText, { color: colors.text }, bs.id === skinId && styles.dayChipTextActive]}>{bs.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

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
                      placeholder="--"
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
                      {online ? "No groups yet — create some in Friends." : "Can't load groups — no internet connection."}
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

                  <View style={styles.modalBtnRow}>
                    <TouchableOpacity style={[styles.btn, styles.btnGhost, { backgroundColor: colors.inputBg, borderColor: colors.border }]} onPress={() => { tap(); setOptionsOpen(false); }}>
                      <Text style={[styles.btnGhostText, { color: colors.text }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.btn,
                        styles.btnPrimary,
                        { backgroundColor: colors.primary, borderColor: colors.primary },
                        !!timeRangeError && { opacity: 0.5 },
                      ]}
                      onPress={saveBeaconOptions}
                      disabled={!!timeRangeError}
                    >
                      <Text style={styles.btnPrimaryText}>Save</Text>
                    </TouchableOpacity>
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
            style={[styles.modalBackdropCenter, { backgroundColor: colors.backdrop }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => { tap(); setSelectedBeacon(null); setSelectedBeaconMessageId(undefined); }} />
            {/* Bottom gap lives on the CARD, not the KAV: KeyboardAvoidingView (behavior padding)
                overwrites the container's paddingBottom with the keyboard height (0 when closed),
                which would otherwise drop the card into the home-indicator / curved corner. */}
            <View style={[styles.detailCard, { backgroundColor: colors.card, marginBottom: insets.bottom + 16 }]} pointerEvents="box-none">
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
              Now that you've lit a beacon, we can let you know when friends RSVP or comment so you don't have to keep checking the chat.
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
                  if (granted) onboarding.refresh(); // keep the setup banner in sync
                  if (!granted) {
                    Alert.alert(
                      "Permission declined",
                      "No worries — you can enable notifications later from Settings.",
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

  controls: {
    // Transparent (not colors.bg) so the smoke layer behind shows through the controls region and
    // connects to the fire. colors.bg already paints behind via SafeAreaView, so this is no color
    // change in light OR dark — but it MUST be transparent here, not '#fff'.
    backgroundColor: 'transparent',
    alignItems: 'center',
    paddingHorizontal: SCREEN_PAD,
    paddingTop: 12,
    paddingBottom: 16,
    marginBottom: 72, // lift above BottomBar
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
    color: '#6B7280',
    fontWeight: '600',
    textAlign: 'center',
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
  // the Beacon options card below — without changing total layout height.
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
    paddingTop: 130,
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
    marginBottom: 12,
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