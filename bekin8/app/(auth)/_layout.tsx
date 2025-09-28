// app/(auth)/_layout.tsx
import { Stack, Redirect } from "expo-router";
import React from "react";
import { useAuth } from "../providers/AuthProvider";

export default function AuthLayout() {
  const { user, loading } = useAuth();
  if (loading) return null; // Splash could go here
  if (user) return <Redirect href="/home" />; // already signed in -> app
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: false,         // 🚫 no swipe back into app
        headerBackVisible: false,
      }}
    />
  );
}