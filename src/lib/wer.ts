// Word Error Rate (WER) utility — word-level Levenshtein distance.
// WER = (S + D + I) / N where N = reference word count.

export interface WERResult {
  wer: number; // 0..1 (may exceed 1 if hypothesis has many insertions)
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
  hypothesisWords: number;
}

export function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function computeWER(reference: string, hypothesis: string): WERResult {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  const n = ref.length;
  const m = hyp.length;

  if (n === 0) {
    return {
      wer: m === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      referenceWords: 0,
      hypothesisWords: m,
    };
  }

  // DP matrix: d[i][j] = edit distance between ref[0..i) and hyp[0..j)
  const d: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        d[i][j] = d[i - 1][j - 1];
      } else {
        d[i][j] = 1 + Math.min(
          d[i - 1][j - 1], // substitution
          d[i - 1][j],     // deletion
          d[i][j - 1],     // insertion
        );
      }
    }
  }

  // Back-trace to count S / D / I separately
  let i = n;
  let j = m;
  let s = 0, del = 0, ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      i--; j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      s++; i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      del++; i--;
    } else {
      ins++; j--;
    }
  }

  return {
    wer: (s + del + ins) / n,
    substitutions: s,
    deletions: del,
    insertions: ins,
    referenceWords: n,
    hypothesisWords: m,
  };
}
