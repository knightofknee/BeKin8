// components/structures/GlassWatchfire.tsx
// Stained Glass's structure box. The watchfire and its basket are panes in the stained-glass window
// behind (scenes/StainedGlassScene), drawn around this box's flame seat, so the box itself is an
// empty, correctly sized tap target.
import React from 'react';
import { View } from 'react-native';

type Props = { size?: number; lit?: boolean; focused?: boolean };

export default function GlassWatchfire({ size = 180 }: Props) {
  return <View style={{ width: size, height: size }} />;
}
