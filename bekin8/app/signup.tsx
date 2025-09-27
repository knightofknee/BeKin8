// app/signup.tsx
import React, { useRef, useState } from 'react';
import {
  View,
  TextInput,
  Button,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '../firebase.config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function SignUp() {
  const router = useRouter();

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Small, sensible validation (client-side)
  const isValidEmail = (v: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const friendlyError = (code?: string, fallback?: string) => {
    switch (code) {
      case 'auth/invalid-email':
        return 'That email address looks invalid.';
      case 'auth/email-already-in-use':
        return 'There’s already an account with that email.';
      case 'auth/weak-password':
        return 'Password must be at least 6 characters.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled for this project.';
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.';
      default:
        return fallback || 'Something went wrong. Please try again.';
    }
  };

  const handleSignUp = async () => {
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter an email.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setError('That email address looks invalid.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);

      // Minimal profile bootstrap
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        email: trimmedEmail,
        username: null,
        hasUsername: false,
        createdAt: serverTimestamp(),
      });

      router.replace('/home');
    } catch (e: any) {
      setError(friendlyError(e?.code, e?.message));
    } finally {
      setLoading(false);
    }
  };

  const goToSignIn = () => router.replace('/');

  // ===== iOS autofill/overlay suppression =====
  // On iOS we set textContentType="oneTimeCode" and autoComplete="off"
  // to prevent the "Automatic Strong Password" sheet from hijacking input.
  const iosNoAutofill = {
    textContentType: 'oneTimeCode' as const,
    autoComplete: 'off' as const,
  };
  // Android can keep sane autofill hints
  const androidEmailHints = {
    textContentType: 'emailAddress' as const,
    autoComplete: 'email' as const,
    importantForAutofill: 'no' as const, // set 'yes' if you want autofill; 'no' keeps it quiet
  };
  const androidPasswordHints = {
    textContentType: 'password' as const,
    autoComplete: 'password' as const,
    importantForAutofill: 'no' as const,
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>

      {/* Email */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          key={Platform.OS === 'ios' ? 'ios-email' : 'email'} // force iOS to re-evaluate field heuristics
          ref={emailRef}
          style={styles.input}
          placeholder="you@example.com"
          keyboardType="email-address"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect={false}
          {...(Platform.OS === 'ios' ? iosNoAutofill : androidEmailHints)}
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
      </View>

      {/* Password */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          key={Platform.OS === 'ios' ? 'ios-pass' : 'pass'}
          ref={passwordRef}
          style={styles.input}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          {...(Platform.OS === 'ios' ? iosNoAutofill : androidPasswordHints)}
          value={password}
          onChangeText={setPassword}
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
      </View>

      {/* Confirm Password */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Confirm Password</Text>
        <TextInput
          key={Platform.OS === 'ios' ? 'ios-confirm' : 'confirm'}
          ref={confirmRef}
          style={styles.input}
          placeholder="••••••••"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          {...(Platform.OS === 'ios' ? iosNoAutofill : androidPasswordHints)}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          returnKeyType="done"
          onSubmitEditing={handleSignUp}
        />
      </View>

      {/* Inline validation hints (optional) */}
      {!isValidEmail(email) && email.length > 0 && (
        <Text style={styles.hint}>Use a valid email like name@domain.com</Text>
      )}
      {password.length > 0 && password.length < 6 && (
        <Text style={styles.hint}>Password must be at least 6 characters.</Text>
      )}
      {confirmPassword.length > 0 && confirmPassword !== password && (
        <Text style={styles.hint}>Passwords don’t match.</Text>
      )}

      {error !== '' && <Text style={styles.error}>{error}</Text>}

      <View style={styles.buttonContainer}>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Button title="Sign Up" onPress={handleSignUp} disabled={loading} />
        )}
        <View style={styles.switchButton}>
          <Button title="Have an account? Sign In" onPress={goToSignIn} disabled={loading} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 32,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  hint: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: -8,
    marginBottom: 8,
  },
  error: {
    color: '#B00020',
    marginTop: 4,
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  buttonContainer: {
    marginTop: 8,
  },
  switchButton: {
    marginTop: 12,
  },
});