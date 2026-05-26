
## 1. Clean transcription display

In `src/routes/index.tsx`, replace the `<pre>{JSON.stringify(transcript)}</pre>` block with:
- A typed `transcript` state: `{ text: string; raw: unknown } | null` (keep `raw` so Copy can still export the full payload if needed — but Copy will now copy the plain text by default).
- Render `transcript.text` inside a `<p>` with `whitespace-pre-wrap break-words leading-relaxed text-base text-foreground` for readable wrapping/contrast.
- Empty state: muted "Awaiting transcription" placeholder.
- Copy button copies `transcript.text` (plain string).

## 2. New "Evaluation Metrics" section

Add below the transcript card, only visible once `transcript.text` exists (keeps the idle UI minimal):
- Heading: "Evaluation Metrics" (matches existing uppercase-tracking label style).
- `<textarea>` labeled "Ground Truth (Reference Text)" — controlled state `groundTruth`, ~4 rows, same border/focus tokens as the language selector.
- "Calculate WER" button using the existing `--gradient-primary` style (matches Start Recording).
- Result panel (only after calculation): big percentage + breakdown (Substitutions, Deletions, Insertions, Reference word count) + the readiness badge.

## 3. WER utility

New file `src/lib/wer.ts`:
- `normalize(s: string)`: lowercase, strip punctuation, collapse whitespace, split into word array.
- `computeWER(reference: string, hypothesis: string)`: word-level Levenshtein via classic DP matrix with a back-trace to count S / D / I separately.
- Returns `{ wer: number, substitutions: number, deletions: number, insertions: number, referenceWords: number, hypothesisWords: number }`.
- Edge cases: empty reference → return `wer: hypothesis.length > 0 ? 1 : 0` and surface a friendly inline message in the UI ("Enter ground truth to evaluate") instead of NaN.

Formula: `WER = (S + D + I) / N` where N = reference word count. Displayed as `Math.round(wer * 1000) / 10` %.

## 4. Readiness badge

Helper in the route file:
```
0–10%   → Green   "Highly Accurate · Ready for Production"
11–20%  → Yellow  "Acceptable · Requires Minor Correction UI"
21–35%  → Orange  "Poor · Requires Model Fine-tuning"
>35%    → Red     "Failure · Not Viable for Commercial Use"
```
Rendered as a pill with colored text + matching border, on a near-white background to stay academic/minimal. Colors come from Tailwind's emerald/amber/orange/red scales (used only here as semantic status colors, not theme tokens).

## Files touched

- `src/lib/wer.ts` (new) — pure function, easily unit-testable.
- `src/routes/index.tsx` — typed transcript, new Evaluation section, badge helper.
- `src/routes/api/transcribe.ts` — no change (Groq already returns `{text: "..."}`).

After you approve, switch to build mode and I'll implement.
