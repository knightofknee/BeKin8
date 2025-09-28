// app/_layout.tsx
import React from "react";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerTitleAlign: "center",
      }}
    >
      {/* Auth screens (no headers) */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />

      {/* Main app screens */}
      <Stack.Screen
        name="home"
        options={{
          // Remove the back chevron after signup/login
          headerBackVisible: false,
          // Also prevent iOS swipe-back from showing the previous route
          gestureEnabled: false,
          title: "Home",
        }}
      />
      <Stack.Screen name="feed" options={{ title: "Feed" }} />
      <Stack.Screen name="friends" options={{ title: "Friends" }} />
      <Stack.Screen name="create-post" options={{ title: "Create Post" }} />
    </Stack>
  );
}