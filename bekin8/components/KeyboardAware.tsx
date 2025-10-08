// components/KeyboardAware.tsx
import React from 'react';
import { KeyboardAvoidingView, Platform, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function KeyboardAware({
  children,
  headerHeight = 0,
  style,
  behaviorIOS = 'padding',
}: {
  children: React.ReactNode;
  headerHeight?: number;
  style?: ViewStyle | ViewStyle[];
  /** For capped panels (cards/modals), 'height' on iOS works best */
  behaviorIOS?: 'padding' | 'position' | 'height';
}) {
  const insets = useSafeAreaInsets();
  const offset = Platform.OS === 'ios' ? (headerHeight || 0) + (insets?.top || 0) : 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? behaviorIOS : 'height'}
      keyboardVerticalOffset={offset}
      style={style}
    >
      {children}
    </KeyboardAvoidingView>
  );
}