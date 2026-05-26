// components/PasswordInput.tsx
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type PasswordInputHandle = {
  focus: () => void;
  blur: () => void;
};

type Props = Omit<TextInputProps, "secureTextEntry"> & {
  toggleColor?: string;
  toggleHitSlop?: number;
};

// Thin wrapper around TextInput that:
//   - masks via the OS (secureTextEntry) so password-manager autofill keeps working
//   - exposes a one-tap eye toggle to reveal/hide the value
//   - blocks the visible-password keyboard hint that some callers were passing,
//     which on Android effectively renders the password in plaintext
const PasswordInput = forwardRef<PasswordInputHandle, Props>(function PasswordInput(
  { toggleColor, toggleHitSlop = 10, style, ...rest },
  ref,
) {
  const inputRef = useRef<TextInput>(null);
  const [reveal, setReveal] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }),
    [],
  );

  return (
    <View style={styles.row}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        textContentType="password"
        autoComplete="password"
        {...rest}
        ref={inputRef}
        style={[styles.input, style]}
        secureTextEntry={!reveal}
      />
      <Pressable
        onPress={() => setReveal((r) => !r)}
        hitSlop={toggleHitSlop}
        style={styles.toggle}
        accessibilityRole="button"
        accessibilityLabel={reveal ? "Hide password" : "Show password"}
      >
        <Ionicons
          name={reveal ? "eye-off-outline" : "eye-outline"}
          size={20}
          color={toggleColor}
        />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  input: {
    flex: 1,
  },
  toggle: {
    marginLeft: 10,
  },
});

export default PasswordInput;
