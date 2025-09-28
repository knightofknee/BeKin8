// app/_layout.tsx
import React from "react";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Keep default animations for non-bottom-bar routes
        animation: "default",
        // Slightly nicer replace behavior when we redirect after auth
        animationTypeForReplace: "pop",
      }}
    >
      {/* Bottom-bar destinations: fast, subtle fade */}
      <Stack.Screen name="home" options={{ animation: "fade" }} />
      <Stack.Screen name="feed" options={{ animation: "fade" }} />
      <Stack.Screen name="friends" options={{ animation: "fade" }} />
      <Stack.Screen name="create-post" options={{ animation: "fade" }} />

      {/* Auth & other routes keep platform default transitions */}
      <Stack.Screen name="index" options={{ animation: "default" }} />
      <Stack.Screen name="signup" options={{ animation: "default" }} />
    </Stack>
  );
}