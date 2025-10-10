// lib/push.ts
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { auth, db } from "../firebase.config";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const tokenDocId = (t: string) => t.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);

export async function registerAndSaveExpoToken() {
  if (!Device.isDevice) return;
  const user = auth.currentUser;
  if (!user) return;

  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== "granted") {
    perm = await Notifications.requestPermissionsAsync();
  }}