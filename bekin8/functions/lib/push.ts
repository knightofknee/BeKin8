// app/lib/push.ts
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase.config';

// iOS foreground behavior: modern flags (no deprecated fields)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    // modern iOS behavior flags (Expo SDK 51+) – safe to omit on Android
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensurePushTokenOnLogin() {
  // 1) must be a physical device
  if (!Device.isDevice) return null;

  // 2) ask permission (idempotent)
  const settings = await Notifications.getPermissionsAsync();
  let finalStatus = settings.status;
  if (finalStatus !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    finalStatus = req.status;
  }
  if (finalStatus !== 'granted') return null;

  // 3) get the Expo token
  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync();

  // 4) Android channel for importance
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  // 5) persist it for the signed-in user (both places we read in Cloud Function)
  const user = auth.currentUser;
  if (!user) return expoPushToken;

  // Write to Profiles/{uid} and users/{uid}
  await Promise.all([
    setDoc(
      doc(db, 'Profiles', user.uid),
      { expoPushToken },
      { merge: true }
    ),
    setDoc(
      doc(db, 'users', user.uid),
      { uid: user.uid, expoPushToken },
      { merge: true }
    ),
  ]);

  return expoPushToken;
}