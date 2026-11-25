// components/ucs/ComplaintMode.tsx
// COMPLAINT MODE for a post (app/create-post.tsx): the Universal Complaint System's writing help,
// inside BeKin.
//
//   <ComplaintPanel>   under the post while typing: the three things a complaint needs ticking off
//                      (who / how it is / how it should be), Rudy the red pepper and the peppers,
//                      his one-line nudge, and who in BeKin gets to see it.
//   <ComplaintReview>  after Next: what the UCS model made of it (the issues it raises, anything
//                      missing, a calmer wording if it has one), or why it can't be recorded.
//
// The reading rules, Rudy's lines and Rudy himself are UCS's own (lib/ucs, components/ucs/Rudy).
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../providers/ThemeProvider';
import { selection, tap } from '../../utils/haptics';
import { SPICE_LABELS, type Read } from '../../lib/ucs/read';
import { pick, RUDY_QUIPS, RUDY_READING, rudyVerdict } from '../../lib/ucs/rudy';
import { UCS_TERMS_URL, type Analysis, type ComplaintVisibility } from '../../lib/ucs/api';
import { Rudy } from './Rudy';

const GOOD = '#2FA36B';

export function Peppers({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }} accessibilityLabel={`${n} of 5 peppers`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ width: size * 1.25, height: size * 1.4, alignItems: 'center', overflow: 'hidden' }}>
          <Text style={{ fontSize: size, lineHeight: size * 1.35, opacity: i <= n ? 1 : 0.18 }} numberOfLines={1}>🌶️</Text>
        </View>
      ))}
    </View>
  );
}

const VISIBILITY: { id: ComplaintVisibility; label: string; note: string }[] = [
  { id: 'profile', label: 'My profile only', note: 'Stays out of feeds. Friends find it under Complaints on your profile.' },
  { id: 'feed', label: "Friends' feeds", note: 'Friends see it in their feed. Uses one of your posts.' },
  { id: 'hidden', label: 'Hidden from friends', note: 'Nobody on BeKin sees it.' },
];

type PanelProps = {
  read: Read;
  notSure: boolean;
  onNotSure: () => void;
  visibility: ComplaintVisibility;
  onVisibility: (v: ComplaintVisibility) => void;
  /** The model is reading it: Rudy dances and says what it is doing. */
  reading: boolean;
  /** Their name on the complaint system, once known, and a way to swap it for another. */
  name: string | null;
  onShuffle?: () => void;
};

export function ComplaintPanel({ read, notSure, onNotSure, visibility, onVisibility, reading, name, onShuffle }: PanelProps) {
  const { colors } = useTheme();
  const done = [read.goals.who, read.goals.what, read.goals.better].filter(Boolean).length;
  const [hops, setHops] = useState(0);
  const [quip, setQuip] = useState<string | null>(null);
  const [readingAt, setReadingAt] = useState(0);
  useEffect(() => { if (done > 0) setHops((h) => h + 1); }, [done]);
  useEffect(() => {
    if (!reading) { setReadingAt(0); return; }
    const t = setInterval(() => setReadingAt((i) => Math.min(i + 1, RUDY_READING.length - 1)), 1700);
    return () => clearInterval(t);
  }, [reading]);
  useEffect(() => {
    if (!quip) return;
    const t = setTimeout(() => setQuip(null), 3500);
    return () => clearTimeout(t);
  }, [quip]);

  const goal = (ok: boolean, text: string, bonus = false) => (
    <View key={text} style={st.goal} accessible accessibilityLabel={`${text}: ${ok ? 'done' : bonus ? 'optional' : 'still to say'}`}>
      <Ionicons
        name={ok ? (bonus ? 'star' : 'checkmark-circle') : bonus ? 'star-outline' : 'ellipse-outline'}
        size={15}
        color={ok ? (bonus ? '#E0452B' : GOOD) : colors.subtle}
      />
      <Text style={[st.goalTxt, { color: ok ? colors.text : colors.subtle }]}>{text}</Text>
    </View>
  );
  const offerNotSure = !read.quiet && read.goals.who && read.goals.what && (notSure || !read.goals.better);
  const active = VISIBILITY.find((v) => v.id === visibility)!;

  return (
    <View style={[st.panel, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
      {!read.quiet ? (
        <View style={st.goals}>
          {goal(read.goals.who, 'Who')}
          {goal(read.goals.what, 'How it is')}
          {goal(read.goals.better, 'How it should be')}
          {offerNotSure ? (
            <Pressable
              onPress={() => { selection(); onNotSure(); }}
              hitSlop={6}
              style={[st.notSure, { borderColor: notSure ? GOOD : colors.border }]}
              accessibilityRole="button"
              accessibilityState={{ selected: notSure }}
            >
              <Text style={[st.goalTxt, { color: notSure ? GOOD : colors.subtle }]}>{notSure ? '✓ Not sure' : 'Not sure?'}</Text>
            </Pressable>
          ) : null}
          {goal(read.goals.how, 'Bonus: how to get there', true)}
        </View>
      ) : null}

      <View style={st.rudyRow}>
        <Rudy spice={read.spice} dancing={reading} hops={hops} size={44} onPress={() => setQuip(pick(RUDY_QUIPS))} />
        <View style={{ flex: 1 }}>
          <View style={st.pepperRow}>
            <Peppers n={read.spice} />
            <Text style={[st.spiceTxt, { color: colors.subtle }]}>{SPICE_LABELS[read.spice]}</Text>
          </View>
          <Text style={[st.nudge, { color: colors.text }]}>{reading ? RUDY_READING[readingAt] : quip ?? read.nudge}</Text>
        </View>
      </View>

      <Text style={[st.label, { color: colors.text }]}>Who sees it on BeKin</Text>
      <View style={st.visRow}>
        {VISIBILITY.map((v) => {
          const on = v.id === visibility;
          return (
            <Pressable
              key={v.id}
              onPress={() => { selection(); onVisibility(v.id); }}
              style={[st.visChip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[st.visTxt, { color: on ? '#fff' : colors.text }]}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[st.fine, { color: colors.subtle }]}>{active.note}</Text>
      <View style={st.nameRow}>
        <Text style={[st.fine, { color: colors.subtle, flex: 1, marginTop: 0 }]}>
          Public on the Universal Complaint System as{' '}
          <Text style={{ color: colors.text, fontWeight: '700' }}>{name || 'a random name'}</Text>, never your BeKin name.
        </Text>
        {name && onShuffle ? (
          <Pressable
            onPress={() => { selection(); onShuffle(); }}
            hitSlop={8}
            style={[st.shuffle, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Shuffle your complaint name"
          >
            <Ionicons name="shuffle" size={15} color={colors.primary} />
            <Text style={[st.shuffleTxt, { color: colors.primary }]}>Shuffle</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

type ReviewProps = {
  analysis: Analysis | null;
  text: string;
  posting: boolean;
  onBack: () => void;
  /** Can't be recorded: post it to BeKin as an ordinary post instead. */
  onPostNormally: () => void;
  onPost: (o: { useRewrite: boolean; removePII: boolean; keepPoints: number[]; acceptTerms: boolean }) => void;
};

export function ComplaintReview({ analysis, text, posting, onBack, onPostNormally, onPost }: ReviewProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const r = analysis?.result;
  const [useRewrite, setUseRewrite] = useState(false);
  const [removePII, setRemovePII] = useState(true);
  const [keep, setKeep] = useState<number[]>([]);
  const [agreed, setAgreed] = useState(false);
  useEffect(() => {
    setUseRewrite(false);
    setRemovePII(true);
    setAgreed(false);
    setKeep(analysis ? analysis.result.points.map((_, i) => i) : []);
  }, [analysis?.draftId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!analysis || !r) return null;
  const spice = Math.max(1, Math.min(5, r.spice ?? 1));
  const blocked: { title: string; why: string } | null = r.safety?.unsafe
    ? { title: "This one can't go up", why: r.safety.reason ?? "It breaks the complaint system's terms of use." }
    : spice >= 5
      ? { title: 'Over the line', why: r.spiceReason ?? 'The name-calling has to go before it can be recorded.' }
      : !r.isComplaint
        ? { title: 'Not a complaint', why: r.notComplaintReason ?? 'There is nothing in this one to record.' }
        : null;
  const needTerms = !analysis.termsAccepted;
  const canPost = !blocked && keep.length > 0 && (!needTerms || agreed) && !posting;

  return (
    <Modal visible animationType="slide" onRequestClose={onBack}>
      <View style={[st.page, { backgroundColor: colors.bg, paddingTop: insets.top + 8 }]}>
        <View style={st.head}>
          <Pressable onPress={() => { tap(); onBack(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to editing">
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={[st.title, { color: colors.text }]}>{blocked ? blocked.title : 'Before it goes up'}</Text>
          <View style={{ width: 26 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 24 }}>
          <View style={[st.quote, { borderColor: colors.border, backgroundColor: colors.inputBg }]}>
            <Text style={[st.quoteTxt, { color: colors.text }]}>{useRewrite && r.suggestedRewrite ? r.suggestedRewrite : text}</Text>
          </View>

          <View style={[st.rudyRow, { marginTop: 14 }]}>
            <Rudy spice={Math.min(spice, blocked ? 5 : 4)} size={48} />
            <View style={{ flex: 1 }}>
              <View style={st.pepperRow}>
                <Peppers n={spice} />
                <Text style={[st.spiceTxt, { color: colors.subtle }]}>{SPICE_LABELS[spice]}</Text>
              </View>
              <Text style={[st.nudge, { color: colors.text }]}>{blocked ? blocked.why : rudyVerdict({ tone: r.tone, spice, missing: r.missing })}</Text>
            </View>
          </View>

          {blocked ? (
            <>
              {spice >= 5 && (r.alternatives ?? []).length > 0 ? (
                <>
                  <Text style={[st.section, { color: colors.text }]}>Same heat, no name-calling</Text>
                  {(r.alternatives ?? []).map((a, i) => (
                    <View key={i} style={[st.row, { borderColor: colors.border }]}>
                      <Text selectable style={[st.rowTxt, { color: colors.text }]}>{a}</Text>
                    </View>
                  ))}
                  <Text style={[st.fine, { color: colors.subtle }]}>Go back and reword it your way.</Text>
                </>
              ) : null}
            </>
          ) : (
            <>
              {r.suggestedRewrite ? (
                <View style={[st.switchRow, { borderColor: colors.border }]}>
                  <Text style={[st.rowTxt, { color: colors.text, flex: 1 }]}>Record this wording instead</Text>
                  <Switch value={useRewrite} onValueChange={(v) => { selection(); setUseRewrite(v); }} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
                </View>
              ) : null}

              {(r.missing ?? []).length > 0 ? (
                <>
                  <Text style={[st.section, { color: colors.text }]}>Potentially missing</Text>
                  <Text style={[st.fine, { color: colors.subtle, marginTop: 0 }]}>Optional. These would make it easier to act on. Go back to add any.</Text>
                  {(r.missing ?? []).map((m) => (
                    <Text key={m} style={[st.bullet, { color: colors.text }]}>•  {m}</Text>
                  ))}
                </>
              ) : null}

              <Text style={[st.section, { color: colors.text }]}>The issues it raises</Text>
              {r.points.map((p, i) => {
                const on = keep.includes(i);
                const hit = p.matchedPointId ? analysis.matched[p.matchedPointId] : null;
                return (
                  <Pressable
                    key={i}
                    onPress={() => { selection(); setKeep((k) => (on ? k.filter((x) => x !== i) : [...k, i].sort((a, b) => a - b))); }}
                    style={[st.row, st.pointRow, { borderColor: on ? colors.primary : colors.border }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.primary : colors.subtle} />
                    <View style={{ flex: 1 }}>
                      <Text style={[st.rowTxt, { color: colors.text }]}>{hit?.text ?? p.statement}</Text>
                      <Text style={[st.fine, { color: colors.subtle, marginTop: 2 }]}>
                        {hit ? `Joins ${hit.supportCount} ${hit.supportCount === 1 ? 'person' : 'people'} with this issue` : 'New issue · title by AI'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

              {r.pii.found.length > 0 && r.pii.redactedText ? (
                <View style={[st.switchRow, { borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.rowTxt, { color: colors.text }]}>Hide personal details</Text>
                    <Text style={[st.fine, { color: colors.subtle, marginTop: 2 }]}>Found: {r.pii.found.join(', ')}</Text>
                  </View>
                  <Switch value={removePII} onValueChange={(v) => { selection(); setRemovePII(v); }} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
                </View>
              ) : null}

              {needTerms ? (
                <Pressable onPress={() => { selection(); setAgreed((a) => !a); }} style={st.terms} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
                  <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? colors.primary : colors.subtle} />
                  <Text style={[st.rowTxt, { color: colors.text, flex: 1 }]}>
                    I agree to the Universal Complaint System&apos;s{' '}
                    <Text style={{ color: colors.primary }} onPress={() => Linking.openURL(UCS_TERMS_URL)}>terms of use</Text>.
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>

        <View style={[st.bar, { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {blocked ? (
            <>
              <Pressable onPress={() => { tap(); onBack(); }} style={[st.btn, { backgroundColor: colors.primary }]} accessibilityRole="button">
                <Text style={st.btnTxt}>Go back and edit</Text>
              </Pressable>
              {!r.safety?.unsafe && !r.isComplaint ? (
                <Pressable onPress={() => { tap(); onPostNormally(); }} style={st.link} accessibilityRole="button">
                  <Text style={[st.linkTxt, { color: colors.primary }]}>Post it as a regular post</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Pressable
              onPress={() => onPost({ useRewrite, removePII, keepPoints: keep, acceptTerms: agreed })}
              disabled={!canPost}
              style={[st.btn, { backgroundColor: colors.primary }, !canPost && { opacity: 0.45 }]}
              accessibilityRole="button"
            >
              {posting ? <ActivityIndicator color="#fff" /> : <Text style={st.btnTxt}>{keep.length ? 'Post it' : 'Nothing to post'}</Text>}
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 2 },
  goals: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, rowGap: 6 },
  goal: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  goalTxt: { fontSize: 13, fontWeight: '600' },
  notSure: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  rudyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  pepperRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spiceTxt: { fontSize: 12, fontWeight: '700' },
  nudge: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  visRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  visChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  visTxt: { fontSize: 13, fontWeight: '700' },
  fine: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  shuffle: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  shuffleTxt: { fontSize: 13, fontWeight: '700' },
  page: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: '800' },
  quote: { borderWidth: 1, borderRadius: 14, padding: 14 },
  quoteTxt: { fontSize: 15, lineHeight: 22 },
  section: { fontSize: 15, fontWeight: '800', marginTop: 20, marginBottom: 6 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowTxt: { fontSize: 15, lineHeight: 21 },
  bullet: { fontSize: 15, lineHeight: 22, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  terms: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 18 },
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 12 },
  btn: { borderRadius: 14, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  link: { alignItems: 'center', paddingVertical: 12 },
  linkTxt: { fontSize: 15, fontWeight: '700' },
});
