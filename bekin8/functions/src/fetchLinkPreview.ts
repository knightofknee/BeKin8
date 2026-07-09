// functions/src/fetchLinkPreview.ts
// Server-side link-preview fetcher. The client used to fetch the shared URL directly from the
// viewer's device, which leaked the viewer's IP to any host someone pasted into a post. This
// callable moves the fetch to the server so the request originates here, not from the reader.
//
// Contract (consumed by components/LinkPreview.tsx):
//   fetchLinkPreview({ url: string })
//     -> { ok: true, title?, description?, image?, siteName?, url? }  on success
//     -> { ok: false }                                                on any failure
//
// SSRF hardening: only http/https, private/local/link-local hosts rejected up front AND on every
// redirect hop (redirects are followed manually so we can re-validate each Location). Response is
// capped to the first ~64KB (we only need the <head>) with a short timeout. Note: host checks are
// on the literal hostname, so a public name that resolves to a private IP (DNS rebinding) is not
// caught here, the on-device leak, which is what this finding closes, is fixed regardless.
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

const USER_AGENT =
  'Mozilla/5.0 (compatible; bekin8-linkpreview/1.0; +https://waldgrave.com)';
const TIMEOUT_MS = 5000;
const MAX_BYTES = 64 * 1024; // only the <head> is needed for OpenGraph/meta tags
const MAX_REDIRECTS = 4;

// ---------- SSRF host checks ----------

function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  if ([a, b, c, d].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed => unsafe
  if (a === 0 || a === 127 || a === 10) return true; // this-host, loopback, private
  if (a === 169 && b === 254) return true; // link-local (includes 169.254.169.254 metadata)
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10)
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/** True when a literal hostname is loopback/private/link-local and must not be fetched. */
function isPrivateHost(hostRaw: string): boolean {
  const host = (hostRaw || '')
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  // IPv6 literal (contains a colon).
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true; // loopback / unspecified
    if (host.startsWith('fe80:')) return true; // link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique-local fc00::/7
    const mapped = host.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); // ::ffff:127.0.0.1
    if (mapped) return isPrivateIPv4(+mapped[1], +mapped[2], +mapped[3], +mapped[4]);
    return false;
  }

  // IPv4 dotted-quad literal.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return isPrivateIPv4(+m[1], +m[2], +m[3], +m[4]);

  return false;
}

function isFetchableUrl(u: URL): boolean {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (isPrivateHost(u.hostname)) return false;
  return true;
}

// ---------- fetch with manual redirects + size/time cap ----------

/** Read at most maxBytes of the response body, decoding as UTF-8, stopping early at </head>. */
async function readCappedHtml(res: Response, maxBytes: number): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body) {
    const buf = new Uint8Array(await res.arrayBuffer()).subarray(0, maxBytes);
    return new TextDecoder('utf-8').decode(buf);
  }
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        out += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(out)) break; // everything we need is above </head>
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return out;
}

type FetchedHead = { html: string; finalUrl: string };

/** Follow redirects manually, re-validating the host on every hop, and return the head HTML. */
async function fetchHead(startUrl: string): Promise<FetchedHead | null> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (!isFetchableUrl(parsed)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual', // we resolve redirects ourselves so private hops can't slip through
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      // Redirect: validate the next hop's host before following it.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        if (!loc) return null;
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return null;
        }
        if (!isFetchableUrl(next)) return null;
        current = next.toString();
        continue;
      }

      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        return null;
      }

      // Only parse HTML.
      const ct = res.headers.get('content-type') || '';
      if (ct && !/text\/html|application\/xhtml/i.test(ct)) {
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        return null;
      }

      const html = await readCappedHtml(res, MAX_BYTES);
      return { html, finalUrl: current };
    } catch {
      return null; // network error, timeout/abort, etc.
    } finally {
      clearTimeout(timer);
    }
  }

  return null; // too many redirects
}

// ---------- meta parsing ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Read a single attribute value off one HTML tag string (handles ", ', and unquoted). */
function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return undefined;
  const v = m[2] ?? m[3] ?? m[4];
  return v != null ? decodeEntities(v).trim() : undefined;
}

function clip(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

type Meta = { title?: string; description?: string; image?: string; siteName?: string };

function parseMeta(html: string, baseUrl: string): Meta {
  // Restrict to <head> when present, so body content can't masquerade as metadata.
  const headMatch = html.match(/<head[\s>][\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : html;

  // First value wins for each property/name key.
  const metas: Record<string, string> = {};
  const metaTagRe = /<meta\b[^>]*>/gi;
  let mt: RegExpExecArray | null;
  while ((mt = metaTagRe.exec(head))) {
    const tag = mt[0];
    const key = (attr(tag, 'property') || attr(tag, 'name'))?.toLowerCase();
    if (!key) continue;
    const content = attr(tag, 'content');
    if (!content) continue;
    if (!(key in metas)) metas[key] = content;
  }

  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const docTitle = titleTag ? decodeEntities(titleTag[1]) : undefined;

  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) if (metas[k]) return metas[k];
    return undefined;
  };

  const title = pick('og:title', 'twitter:title') || docTitle;
  const description = pick('og:description', 'twitter:description', 'description');
  const siteName = pick('og:site_name', 'application-name');

  let image = pick(
    'og:image',
    'og:image:secure_url',
    'og:image:url',
    'twitter:image',
    'twitter:image:src'
  );
  if (image) {
    try {
      image = new URL(image, baseUrl).toString(); // resolve relative image paths
    } catch {
      // keep as-is
    }
  }

  return {
    title: clip(title, 300),
    description: clip(description, 500),
    image,
    siteName: clip(siteName, 120),
  };
}

// ---------- callable ----------

export const fetchLinkPreview = onCall({ enforceAppCheck: false }, async (req) => {
  // Authenticated callers only. This is not a public open proxy, and the client that renders
  // previews is always signed in. Fail soft (ok:false), the client shows a plain link.
  if (!req.auth?.uid) return { ok: false as const };

  try {
    const raw = String((req.data as any)?.url ?? '').trim();
    if (!raw) return { ok: false as const };

    // Accept bare hosts too (example.com) by defaulting to https, matching the client.
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      return { ok: false as const };
    }
    if (!isFetchableUrl(parsed)) return { ok: false as const };

    const fetched = await fetchHead(parsed.toString());
    if (!fetched) return { ok: false as const };

    const meta = parseMeta(fetched.html, fetched.finalUrl);
    if (!meta.title && !meta.description && !meta.image) return { ok: false as const };

    const out: {
      ok: true;
      title?: string;
      description?: string;
      image?: string;
      siteName?: string;
      url?: string;
    } = { ok: true, url: fetched.finalUrl };
    if (meta.title) out.title = meta.title;
    if (meta.description) out.description = meta.description;
    if (meta.image) out.image = meta.image;
    if (meta.siteName) out.siteName = meta.siteName;
    return out;
  } catch (err) {
    logger.warn('fetchLinkPreview failed', { err });
    return { ok: false as const };
  }
});
