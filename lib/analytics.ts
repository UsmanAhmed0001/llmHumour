// Pure, dependency-free analytics. Kept out of the component so the diversity
// math is trivially unit-testable and the same functions back both the live
// matrix and the summary cards.

/** Exact-match key for duplicate detection (challenge: "exact text duplicates"). */
export function normalizeExact(s: string): string {
  return s.trim();
}

/** Lowercased, punctuation-stripped word tokens. Unicode-aware. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Jaccard similarity of the token *sets* of two strings:
 *   |A ∩ B| / |A ∪ B|  ∈ [0, 1].
 * 1 = identical token sets, 0 = no shared tokens.
 */
export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Mean Jaccard between consecutive runs (run i vs run i+1), averaged over a
 * model's outputs. Higher = the model keeps repeating the same wording.
 * Returns null when there are fewer than 2 outputs to compare.
 */
export function avgConsecutiveJaccard(texts: string[]): number | null {
  if (texts.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 1 < texts.length; i++) {
    sum += jaccard(texts[i], texts[i + 1]);
    n++;
  }
  return n === 0 ? null : sum / n;
}

/**
 * Unique Joke Ratio = distinct exact strings / total outputs  ∈ [0, 1].
 * 1.0 = every response was different; 0.2 over 5 runs = the same joke 5×.
 * Returns null when there are no outputs yet.
 */
export function uniqueRatio(texts: string[]): number | null {
  if (texts.length === 0) return null;
  const set = new Set(texts.map(normalizeExact));
  return set.size / texts.length;
}

// Distinct, muted tints for duplicate groups. Each repeated joke gets its own
// colour so reviewers can see at a glance which runs collapsed onto each other.
export const DUP_COLORS = [
  "#E0A93B", // amber
  "#D07C7C", // rose
  "#9B86C4", // violet
  "#5FA89C", // teal
  "#D98E55", // coral
  "#7E97B6", // slate
  "#B7894E", // bronze
  "#C77FA6", // orchid
];

export interface DuplicateInfo {
  groupId: number;
  /** How many runs share this exact text. */
  size: number;
  color: string;
}

/**
 * Group items (each carrying its own run key) by exact text and return a map
 * from key → duplicate info, containing ONLY the keys that belong to a group
 * of size > 1. Singletons are absent (they are unique).
 */
export function computeDuplicates(
  items: { key: number; text: string }[],
): Map<number, DuplicateInfo> {
  const byText = new Map<string, number[]>();
  for (const { key, text } of items) {
    const norm = normalizeExact(text);
    const arr = byText.get(norm);
    if (arr) arr.push(key);
    else byText.set(norm, [key]);
  }

  const out = new Map<number, DuplicateInfo>();
  let groupId = 0;
  for (const keys of byText.values()) {
    if (keys.length > 1) {
      const color = DUP_COLORS[groupId % DUP_COLORS.length];
      for (const k of keys) out.set(k, { groupId, size: keys.length, color });
      groupId++;
    }
  }
  return out;
}

export interface Verdict {
  label: string;
  tone: "good" | "mixed" | "bad";
}

/** Headline read on a model's open-endedness, derived from the unique ratio. */
export function verdictFor(uniq: number | null): Verdict | null {
  if (uniq === null) return null;
  if (uniq >= 0.8) return { label: "Open-ended", tone: "good" };
  if (uniq >= 0.5) return { label: "Partly repetitive", tone: "mixed" };
  return { label: "Mode-collapsed", tone: "bad" };
}
