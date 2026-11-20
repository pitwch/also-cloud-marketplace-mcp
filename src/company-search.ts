/**
 * Company name search that also finds abbreviations, initials, word prefixes,
 * domains and small typos ("BP" → "Beispiel …", "BH" → "Beispiel Handel AG",
 * "beisp hand", "Beispil"). Direct hits win; fuzzy hits are only returned when
 * nothing matched directly, and are labelled so the caller can confirm them.
 */

export type MatchType =
  | 'exact'
  | 'customerId'
  | 'substring'
  | 'wordPrefix'
  | 'initials'
  | 'domain'
  | 'abbreviation'
  | 'typo';

const SCORES: Record<MatchType, number> = {
  exact: 100,
  customerId: 95,
  substring: 90,
  wordPrefix: 85,
  initials: 80,
  domain: 75,
  typo: 65,
  abbreviation: 60,
};

/** Scores at or above this are direct matches; below are fuzzy suggestions. */
const DIRECT_MIN = SCORES.domain;

const LEGAL_FORM_WORDS = new Set([
  'ag', 'gmbh', 'sa', 'sarl', 'sagl', 'kg', 'og', 'ug', 'ltd', 'llc', 'inc', 'co', 'kmg', 'klg',
  'ev', 'genossenschaft', 'stiftung', 'verein', 'se', 'plc', 'bv', 'nv', 'srl', 'spa',
]);

/** Lowercase, umlauts and accents folded, punctuation → space. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  const all = fold(s).split(' ').filter(Boolean);
  const core = all.filter((w) => !LEGAL_FORM_WORDS.has(w));
  return core.length ? core : all;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** "BP" in "Beispiel": starts at a word start, remaining letters in order within that word. */
function abbreviates(q: string, nameWords: string[]): boolean {
  if (q.length < 2) return false;
  return nameWords.some((w, i) => {
    if (w[0] !== q[0]) return false;
    // within one word, or across the following words ("bhandel" style)
    return isSubsequence(q, w) || isSubsequence(q, nameWords.slice(i).join(''));
  });
}

function typoMatch(qWords: string[], nameWords: string[]): boolean {
  const long = qWords.filter((w) => w.length >= 4);
  if (!long.length) return false;
  return long.every((qw) => {
    const max = qw.length >= 7 ? 2 : 1;
    return nameWords.some(
      (nw) => levenshtein(qw, nw) <= max || (nw.length > qw.length && levenshtein(qw, nw.slice(0, qw.length)) <= max),
    );
  });
}

export type CompanyFields = {
  companyName?: unknown;
  customerId?: unknown;
  domain?: unknown;
  email?: unknown;
};

/** Best match type of one company for the query, or undefined. */
export function matchCompany(c: CompanyFields, query: string): MatchType | undefined {
  const name = String(c.companyName ?? '');
  const qFold = fold(query);
  if (!qFold) return undefined;
  const qWords = words(query);
  const qCompact = qFold.replace(/ /g, '');
  const nameFold = fold(name);
  const nameWords = words(name);

  if (qWords.join(' ') === nameWords.join(' ')) return 'exact';
  if (c.customerId != null && String(c.customerId).trim().toLowerCase() === query.trim().toLowerCase()) {
    return 'customerId';
  }
  if (nameFold.includes(qFold)) return 'substring';
  // Without spaces ("beispielhandel") only for longer input: short ones would match
  // across word borders ("bp" in "club partner").
  if (qCompact.length >= 5 && nameFold.replace(/ /g, '').includes(qCompact)) return 'substring';
  if (qWords.length && qWords.every((qw) => nameWords.some((nw) => nw.startsWith(qw)))) return 'wordPrefix';

  const initials = nameWords.map((w) => w[0]).join('');
  if (qCompact.length >= 2 && initials.length >= 2 && initials.startsWith(qCompact)) return 'initials';

  if (qCompact.length >= 3) {
    const domains = [
      ...(Array.isArray(c.domain) ? c.domain : c.domain != null ? [c.domain] : []),
      String(c.email ?? '').split('@')[1] ?? '',
    ]
      .map((d) => fold(String(d)).replace(/ /g, ''))
      .filter(Boolean);
    if (domains.some((d) => d.includes(qCompact))) return 'domain';
  }

  if (typoMatch(qWords, nameWords)) return 'typo';
  if (abbreviates(qCompact, nameWords)) return 'abbreviation';
  return undefined;
}

export type SearchResult<T> = {
  /** "direct" = name/ID/domain hits; "fuzzy" = only abbreviation/typo suggestions. */
  matchMode: 'direct' | 'fuzzy' | 'none';
  matches: Array<T & { matchType: MatchType }>;
};

/** Ranks companies; returns direct hits, or fuzzy suggestions only when there is no direct hit. */
export function searchCompanies<T extends CompanyFields>(companies: T[], query: string): SearchResult<T> {
  const scored = companies
    .map((c) => ({ c, type: matchCompany(c, query) }))
    .filter((x): x is { c: T; type: MatchType } => x.type !== undefined)
    .sort((a, b) => SCORES[b.type] - SCORES[a.type]);
  const direct = scored.filter((x) => SCORES[x.type] >= DIRECT_MIN);
  const chosen = direct.length ? direct : scored;
  return {
    matchMode: direct.length ? 'direct' : scored.length ? 'fuzzy' : 'none',
    matches: chosen.map((x) => ({ ...x.c, matchType: x.type })),
  };
}

export const FUZZY_HINT =
  'No company name contains the search text directly; these are possible matches by abbreviation or typo (see matchType). Confirm the right company with the user before acting.';
