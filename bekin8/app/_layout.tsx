// app/_layout.tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: false,
        // Keep defaults so back buttons show naturally everywhere
      }}
    >
      {/* Login screen: no back button */}
      <Stack.Screen
        name="index"
        options={{
          title: "Sign in",
          headerBackVisible: false,
        }}
      />

      {/* Allow back from signup -> index */}
      <Stack.Screen
        name="signup"
        options={{
          title: "Create account",
        }}
      />

      {/* App screens (back buttons will show if navigated via push) */}
      <Stack.Screen name="home" options={{ title: "Home" }} />
      <Stack.Screen name="friends" options={{ title: "Friends" }} />
      <Stack.Screen name="feed" options={{ title: "Feed" }} />
      <Stack.Screen name="create-post" options={{ title: "Create Post" }} />
    </Stack>
  );
}