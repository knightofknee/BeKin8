// components/ErrorBoundary.tsx
// Minimal white-screen-of-death guard: catches render crashes anywhere below it,
// shows a friendly fallback with a reset button, and best-effort logs the error to
// Firestore. Logging is fully wrapped so it can never re-crash the fallback.
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase.config";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

// Best-effort write to a ClientErrors collection. Swallows every failure so error
// logging never itself throws. Exported so the global JS handler can reuse it.
export async function logClientError(error: unknown, context?: string) {
  try {
    const err = error as any;
    await addDoc(collection(db, "ClientErrors"), {
      message: String(err?.message ?? err ?? "unknown"),
      stack: typeof err?.stack === "string" ? err.stack.slice(0, 4000) : null,
      context: context ?? null,
      uid: auth.currentUser?.uid ?? null,
      createdAt: serverTimestamp(),
    });
  } catch {
    // logging must never re-crash; ignore
  }
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info?.componentStack);
    void logClientError(error, "render");
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong.</Text>
          <Text style={styles.body}>Please restart BeKin.</Text>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

// Theme context is unavailable inside a class boundary during a crash, so use fixed,
// safe colors that stay readable regardless of the app theme at crash time.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#0B1220",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    color: "#C7D0DE",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#4B8BFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
