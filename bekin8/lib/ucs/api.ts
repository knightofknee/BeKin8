// lib/ucs/api.ts
// Complaint mode's two calls (functions/src/ucs.ts), and the shape of what the Universal Complaint
// System's model says about a complaint (a subset of UCS src/lib/types.ts).
import { getFunctions, httpsCallable } from 'firebase/functions';

export type IntakeResult = {
  safety?: { unsafe: boolean; reason: string | null };
  isComplaint: boolean;
  notComplaintReason: string | null;
  pii: { found: string[]; redactedText: string | null; sensitive: string[] };
  points: { matchedPointId: string | null; statement: string }[];
  tone: 'constructive' | 'neutral' | 'rant';
  /** 1-5 peppers. 5 is over the line (name-calling at people) and can't post. */
  spice?: number;
  spiceReason?: string | null;
  alternatives?: string[];
  missing?: string[];
  suggestedRewrite: string | null;
};

export type Analysis = {
  draftId: string;
  result: IntakeResult;
  matched: Record<string, { id: string; text: string; supportCount: number }>;
  termsAccepted: boolean;
};

export type ComplaintVisibility = 'feed' | 'profile' | 'hidden';

export type Submitted = { submissionId: string; url: string | null; authorName: string | null; joined: number; added: number };

export const UCS_TERMS_URL = 'https://www.waldgrave.com/ucs/app/terms';

export async function ucsAnalyze(text: string, notSure: boolean): Promise<Analysis> {
  const res = await httpsCallable(getFunctions(), 'ucsAnalyze', { timeout: 125_000 })({ text, notSure });
  return res.data as Analysis;
}

export async function ucsSubmit(input: {
  draftId: string;
  useRewrite: boolean;
  removePII: boolean;
  keepPoints: number[];
  acceptTerms: boolean;
  visibility: ComplaintVisibility;
}): Promise<Submitted> {
  const res = await httpsCallable(getFunctions(), 'ucsSubmit', { timeout: 125_000 })(input);
  return res.data as Submitted;
}

/** Their public name on the complaint system (the one their next complaint goes up under). */
export async function ucsName(): Promise<string> {
  const res = await httpsCallable(getFunctions(), 'ucsName', { timeout: 65_000 })({});
  return String((res.data as any)?.name ?? '');
}

/** A dozen other names to shuffle through. */
export async function ucsNameOptions(): Promise<string[]> {
  const res = await httpsCallable(getFunctions(), 'ucsName', { timeout: 65_000 })({ options: true });
  const names = (res.data as any)?.names;
  return Array.isArray(names) ? names.filter((n: unknown): n is string => typeof n === 'string') : [];
}

/** Take one of those names. Throws with a message for the person when it can't be taken. */
export async function ucsChooseName(name: string): Promise<string> {
  const res = await httpsCallable(getFunctions(), 'ucsName', { timeout: 65_000 })({ choose: name });
  return String((res.data as any)?.name ?? name);
}

/**
 * Shuffle the complaint name: steps through a batch of options (fetching another batch when it
 * runs out) and takes each one as it is shown. `set` gets the new name at once and the old one
 * back if the pick is refused (one new name a day once you have posted under the current one).
 */
export function makeNameShuffler(get: () => string | null, set: (n: string | null) => void, onError: (msg: string) => void) {
  let queue: string[] = [];
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    const before = get();
    try {
      if (!queue.length) queue = await ucsNameOptions();
      const next = queue.shift();
      if (!next) return;
      set(next);
      await ucsChooseName(next);
    } catch (e: any) {
      set(before);
      queue = [];
      onError(e?.message ?? 'Try again in a moment.');
    } finally {
      busy = false;
    }
  };
}
