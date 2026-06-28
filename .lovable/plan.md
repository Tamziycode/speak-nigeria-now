## Pre-Defense Polish Pass

Three focused upgrades to add presentation weight. All changes are frontend/presentation only.

### 1. Perceived Performance Polish
- **Shimmer skeleton**: while `isTranscribing` / `isTranslating`, replace the empty textarea area with 3–4 animated grey bars using a `@keyframes shimmer` utility added to `src/styles.css`.
- **Pulsing record ring**: while recording, add a Tailwind-only pulsating red ring around the mic button (`animate-ping` halo + steady inner dot) so the live state is unmistakable.

### 2. Bulletproof Error Surface
- **Mic denial**: catch `NotAllowedError` / `NotFoundError` from `getUserMedia` and show a dedicated alert card with remediation copy instead of a toast.
- **Upload validation**: reject files >25 MB, 0-byte files, non-audio MIME types, and multiple-file drops — surface a visible inline warning beneath the upload button (not just a toast).
- **Network failure**: distinguish `AbortError`, offline (`navigator.onLine === false`), and HTTP errors with tailored messages.

### 3. Repo Polish
- Strip stray `console.log` calls from `src/routes/index.tsx`, `src/routes/api/transcribe.ts`, `src/lib/recorder.ts`. Keep `console.error` for genuine error paths.
- Verify `.gitignore` blocks `.env*` (add if missing).
- Rewrite `README.md` as the project abstract: title, stack (React 19 + TanStack Start + Cloudflare Workers + Groq Whisper-large-v3), 3-step local install, feature list, supported languages, known limitations (Pidgin ISO gap, 25 MB cap).

### Files touched
- `src/routes/index.tsx` — skeletons, pulsing ring, hardened error handling, log purge.
- `src/routes/api/transcribe.ts` — log purge only.
- `src/lib/recorder.ts` — log purge only.
- `src/styles.css` — `shimmer` keyframes + utility, pulse-ring utility.
- `README.md` — full rewrite.
- `.gitignore` — confirm/extend `.env*` entries.

### Out of scope
No backend logic changes, no new dependencies, no metrics panel, no pidgin disclosure banner.
