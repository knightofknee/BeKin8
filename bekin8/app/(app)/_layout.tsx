// app/(app)/_layout.tsx
import { Stack, Redirect } from "expo-router";
import React from "react";
import { useAuth } from "../../providers/AuthProvider";

export default function AppLayout() {
  const { user, loading } = useAuth();
  if (loading) return null; // Splash could go here
  if (!user) return <Redirect href="/" />; // not signed in -> auth
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true, // normal in-app gestures
      }}
    />
  );
}