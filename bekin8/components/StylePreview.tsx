// components/StylePreview.tsx
// Live preview box for the Beacon style picker: a cropped, slightly zoomed WINDOW onto the skin's
// real home stage. The full-screen scene, smoke, structure and fire layers are all mounted inside a
// virtual page the size of the window, placed exactly where home puts them (same anchor), then the
// whole page is scaled and shifted so the structure sits near the bottom of the box. The scenery
// around it (distant beacons, ridges, sky) is really there and simply runs off the box edges.
// Cycle: unlit on open -> lit 0.5s after selection -> burns for 10s -> reverts to unlit -> relights,
// forever (each relight replays the skin's real ignition, torch and all). Rendered by the options
// sheet BELOW the style grid, overlaying the content under it, with a big X to dismiss.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BeaconSkin } from '../lib/beaconSkins';
import BeaconStructure from './BeaconStructure';
import BeaconScene from './BeaconScene';
import { ARRIVE_MS, RELAY_FIRST_MS, RELAY_STEP_MS, type ScenePerson } from './scenes/BeaconsScene';
import BeaconFire from './BeaconFireSkia';
import BeaconBonfireFlame from './BeaconBonfireFlame';
import BeaconPrintFire from './BeaconPrintFire';
import BeaconLighthouseBeam from './BeaconLighthouseBeam';
import BeaconSearchlightBeam from './BeaconSearchlightBeam';
import BeaconStormBolt from './BeaconStormBolt';
import BeaconFireworks from './BeaconFireworks';
import BeaconSmokeSignal from './BeaconSmokeSignal';
import BeaconSkyLanterns from './BeaconSkyLanterns';
import BeaconEmberColumn from './BeaconEmberColumn';
import BeaconSmoke from './BeaconSmokeSkia';
import { tap } from '../utils/haptics';

const BOX_H = 400;
const STRUCT = 180; // home's structure size; the page is rendered 1:1 then scaled as a whole
// Page px between the structure's bottom edge and the box's bottom edge (a little foreground).
const GROUND_BELOW = 40;
// Horizontal overfill: >1 crops the page's sides so the box reads as zoomed in on the beacon,
// and guarantees no empty margin past the scene's edges.
const ZOOM = 1.12;
const LIT_AFTER_MS = 500;
const BURN_MS = 10_000;

// The Beacons preview is a STYLE preview, not a data preview: it stages sample friends. Lighting
// sets the whole range burning; three answers label the nearest piles (Jordan rallied, so his burns
// brighter), then, after three relay gaps of quiet, a fourth (Devin) answers and his pile flares as
// his name lands, which is the thing this skin does that no other does.
const SAMPLE_PEOPLE: ScenePerson[] = [
  { id: 'sample-maya', name: 'Maya' },
  { id: 'sample-jordan', name: 'Jordan', rally: true }, // shows off a rally's brighter fire
  { id: 'sample-sam', name: 'Sam' },
];
const SAMPLE_LATE: ScenePerson = { id: 'sample-devin', name: 'Devin' };
const LATE_AT_MS = RELAY_FIRST_MS + 2 * RELAY_STEP_MS + 3 * RELAY_STEP_MS - ARRIVE_MS;
const PEOPLE_BURN_MS = LATE_AT_MS + 5_000; // let the late arrival burn a while before the cycle ends
const PEOPLE_FULL = [...SAMPLE_PEOPLE, SAMPLE_LATE];
const NO_PEOPLE: ScenePerson[] = [];
const RELIGHT_GAP_MS = 800;

/** Home's measured structure box, page-relative (see home's beaconAnchor). */
export type PreviewAnchor = { x: number; top: number; h: number; measured: boolean };

export default function StylePreview({
  skin,
  anchor,
  onClose,
}: {
  skin: BeaconSkin;
  anchor: PreviewAnchor;
  onClose: () => void;
}) {
  const [lit, setLit] = useState(false);
  const [lateArrived, setLateArrived] = useState(false);
  const showsPeople = !!skin.showsPeople;
  // Sample friends for skins that show people (Beacons chain, Campfire bugs, Fireworks names).
  const previewPeople = showsPeople && lit ? (lateArrived ? PEOPLE_FULL : SAMPLE_PEOPLE) : NO_PEOPLE;
  const [boxW, setBoxW] = useState(0);
  const { width: W, height: H } = useWindowDimensions();

  // The lit cycle. Restarts (from unlit) whenever the selected skin changes: the component is NOT
  // remounted on style switches, so the measured box width survives and nothing flashes misplaced.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let lateTimer: ReturnType<typeof setTimeout> | undefined;
    setLit(false);
    setLateArrived(false);
    const light = (delay: number) => {
      timer = setTimeout(() => {
        if (!alive) return;
        setLit(true);
        if (showsPeople) lateTimer = setTimeout(() => { if (alive) setLateArrived(true); }, LATE_AT_MS);
        timer = setTimeout(() => {
          if (!alive) return;
          setLit(false);
          setLateArrived(false);
          light(RELIGHT_GAP_MS);
        }, showsPeople ? PEOPLE_BURN_MS : BURN_MS);
      }, delay);
    };
    light(LIT_AFTER_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      if (lateTimer) clearTimeout(lateTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin.id]);

  // Same geometry home uses: structure box at (x, top), seat at top + h * origin.
  const ax = anchor.measured ? anchor.x : W / 2;
  const top = anchor.measured ? anchor.top : H * 0.62;
  const h = anchor.measured ? anchor.h : STRUCT;
  const anchorY = top + h * skin.origin;

  // Scale the page so it overfills the box width, then place the structure's bottom-center at
  // (box center, BOX_H - GROUND_BELOW * s). transformOrigin top-left keeps the math linear.
  const s = boxW > 0 ? (boxW / W) * ZOOM : 1;
  const tx = boxW / 2 - ax * s;
  const ty = BOX_H - GROUND_BELOW * s - (top + h) * s;
  // The page band actually visible in the box (page px).
  const visTop = -ty / s;
  const visH = BOX_H / s;
  const measured = boxW > 0;
  const common = { skin, active: lit, anchorX: ax, anchorY, measured: true, focused: true } as const;

  return (
    <View style={styles.box} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {measured && (
        <View
          pointerEvents="none"
          style={[
            styles.page,
            { width: W, height: H, transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] },
          ]}
        >
          <BeaconScene {...common} people={previewPeople} />

          {skin.smokeKind === 'signal' ? (
            <BeaconSmokeSignal {...common} />
          ) : skin.smokeKind === 'fireworks' ? (
            // The show's burst altitudes are fractions of its stage height measured from the
            // stage top, so a full-page stage bursts above the box. Stage it to just the visible
            // band of the page instead (anchor re-based to that band) so every burst lands in view.
            <View style={[styles.stage, { top: visTop, width: W, height: visH }]}>
              <BeaconFireworks {...common} anchorY={anchorY - visTop} frameW={W} frameH={visH} people={previewPeople} />
            </View>
          ) : skin.smokeKind === 'lanterns' ? (
            <BeaconSkyLanterns {...common} />
          ) : skin.smokeKind === 'embers' ? (
            <BeaconEmberColumn {...common} />
          ) : skin.smokeKind === 'ambient' ? (
            <BeaconSmoke {...common} />
          ) : null}

          {/* behind-structure fire (the bonfire's tongue flame body) */}
          {skin.fire === 'pyre' && <BeaconBonfireFlame {...common} />}

          <View style={[styles.structWrap, { top, left: ax - STRUCT / 2, height: h }]}>
            <BeaconStructure skin={skin} size={STRUCT} lit={lit} focused />
          </View>

          {skin.fire === 'beam' ? (
            skin.structure === 'searchlight' ? (
              <BeaconSearchlightBeam {...common} />
            ) : (
              <BeaconLighthouseBeam {...common} />
            )
          ) : skin.fire === 'bolt' ? (
            <BeaconStormBolt {...common} />
          ) : skin.fire === 'print' ? (
            <BeaconPrintFire {...common} />
          ) : skin.fire === 'flame' ? (
            <BeaconFire {...common} />
          ) : null}
        </View>
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
  page: { position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' },
  structWrap: { position: 'absolute', width: STRUCT, alignItems: 'center' },
  stage: { position: 'absolute', left: 0 },
  label: {
    position: 'absolute',
    top: 10,
    left: 12,
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
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
