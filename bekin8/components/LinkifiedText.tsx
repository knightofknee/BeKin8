// components/LinkifiedText.tsx
// Renders text verbatim (newlines included) with any URLs inside it tappable, the baseline
// behavior users expect from every posting/comments surface. Matches http(s):// and www. forms;
// trailing sentence punctuation is excluded from the match so "check example.com." links cleanly.
import React from 'react';
import { Linking, Text, type StyleProp, type TextStyle } from 'react-native';

// Capture group on purpose: String.split keeps the captured URLs at odd indices.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,!?;:'"’\]])/gi;

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  linkColor: string;
  selectable?: boolean;
};

export default function LinkifiedText({ text, style, linkColor, selectable = true }: Props) {
  const parts = String(text ?? '').split(URL_RE);
  if (parts.length === 1) {
    return (
      <Text selectable={selectable} style={style}>
        {text}
      </Text>
    );
  }
  return (
    <Text selectable={selectable} style={style}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text
            key={`u${i}`}
            style={{ color: linkColor, textDecorationLine: 'underline' }}
            onPress={() => {
              const url = /^https?:\/\//i.test(part) ? part : `https://${part}`;
              Linking.openURL(url).catch(() => {});
            }}
            suppressHighlighting={false}
          >
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}
