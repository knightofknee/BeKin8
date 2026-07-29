// components/StylePreview.tsx
// Live preview box for the Beacon style picker: shows the selected skin's structure lighting up
// for real. Cycle: unlit on open -> lit 0.5s after selection -> burns for 10s -> reverts to unlit
// -> relights, forever (each relight replays the skin's real ignition, torch and all). Rendered
// by the options sheet BELOW the style grid, overlaying the content under it, with a big X to
// dismiss. The full-screen fire layers (Skia flame / tongue flame / beam) are mounted inside an
// overflow-hidden box with box-local anchors, so they draw correctly and clip to the preview.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BeaconSkin } from '../lib/beaconSkins';
import BeaconStructure from './BeaconStructure';
import BeaconFire from './BeaconFireSkia';
import BeaconBonfireFlame from './BeaconBonfireFlame';
import BeaconPrintFire from './BeaconPrintFire';
import BeaconLighthouseBeam from './BeaconLighthouseBeam';
import BeaconFireworks from './BeaconFireworks';
import { tap } from '../utils/haptics';

const BOX_H = 280;
const STRUCT = 150;
const LIT_AFTER_MS = 500;
const BURN_MS = 10_000;
const RELIGHT_GAP_MS = 800;

export default function StylePreview({ skin, onClose }: { skin: BeaconSkin; onClose: () => void }) {
  const [lit, setLit] = useState(false);
  const [boxW, setBoxW] = useState(0);

  // The lit cycle. Restarts (from unlit) whenever the selected skin changes: the component is NOT
  // remounted on style switches, so the measured box width survives and nothing flashes misplaced.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setLit(false);
    const light = (delay: number) => {
      timer = setTimeout(() => {
        if (!alive) return;
        setLit(true);
        timer = setTimeout(() => {
          if (!alive) return;
          setLit(false);
          light(RELIGHT_GAP_MS);
        }, BURN_MS);
      }, delay);
    };
    light(LIT_AFTER_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [skin.id]);

  const structTop = BOX_H - 26 - STRUCT;
  const anchorX = boxW / 2;
  const anchorY = structTop + skin.origin * STRUCT;
  const measured = boxW > 0;

  return (
    <View style={styles.box} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {/* behind-structure fire (the bonfire's tongue flame body) */}
      {measured && skin.fire === 'pyre' && (
        <BeaconBonfireFlame skin={skin} active={lit} anchorX={anchorX} anchorY={anchorY} measured focused />
      )}

      {measured && (
        <View style={[styles.structWrap, { top: structTop, left: anchorX - STRUCT / 2 }]} pointerEvents="none">
          <BeaconStructure skin={skin} size={STRUCT} lit={lit} focused />
        </View>
      )}

      {/* the fireworks SHOW, staged to the box: the shader choreographs burst altitude and x
          spread against its frame size, so passing the box as the frame keeps every shell arc
          and explosion inside the preview. anchorY nudged +14 so the shader's muzzle offset
          (authored for the 180px structure) lands on this 150px rocket's muzzle. */}
      {measured && skin.smokeKind === 'fireworks' && (
        <BeaconFireworks
          skin={skin}
          active={lit}
          anchorX={anchorX}
          anchorY={anchorY + 14}
          measured
          focused
          frameW={boxW}
          frameH={BOX_H}
        />
      )}

      {/* front fire layers, clipped to the box */}
      {measured && skin.fire === 'flame' && (
        <BeaconFire skin={skin} active={lit} anchorX={anchorX} anchorY={anchorY} measured focused />
      )}
      {measured && skin.fire === 'print' && (
        <BeaconPrintFire skin={skin} active={lit} anchorX={anchorX} anchorY={anchorY} measured focused />
      )}
      {measured && skin.fire === 'beam' && (
        <BeaconLighthouseBeam skin={skin} active={lit} anchorX={anchorX} anchorY={anchorY} measured focused />
      )}

      <Text style={styles.label}>{skin.label}</Text>

      <Pressable
        onPress={() => { tap(); onClose(); }}
        style={styles.closeBtn}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close style preview"
      >
        <Ionicons name="close" size={26} color="#F1F5F9" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: BOX_H,
    borderRadius: 14,
    backgroundColor: '#0D1326',
    borderWidth: 1,
    borderColor: '#2A3352',
    overflow: 'hidden',
  },
  structWrap: { position: 'absolute' },
  label: {
    position: 'absolute',
    top: 10,
    left: 12,
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '800',
  },
  closeBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(15,23,42,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
