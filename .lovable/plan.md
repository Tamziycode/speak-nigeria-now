# Translate to English for all languages

The native transcript card already exists. Right now the "English Translation" card only appears for Hausa and Yoruba. Extend it to every language in the dropdown.

## How each language reaches English

- **Hausa, Yoruba** — already works. Whisper `/audio/translations` with the recorded WAV.
- **Pidgin** — same Whisper translations endpoint, no language code (auto-detect). Whisper handles Pidgin well because it's English-based.
- **Igbo, Fulfulde, Kanuri, Ibibio, Tiv** — Whisper can't translate these. Two-step:
  1. We already have the MMS transcript (native text) from the first pass.
  2. Send that text to **NLLB-200** (`facebook/nllb-200-distilled-600M`) on HuggingFace with the source language code, target = `eng_Latn`.

  No second audio upload, no re-recording — we translate the text we already have.

## Files to change

**`src/routes/api/transcribe.ts`**
- Add a new branch: if `provider === "nllb"`, read `text` + `sourceLang` form fields, POST to `https://api-inference.huggingface.co/models/facebook/nllb-200-distilled-600M` with `{ inputs: text, parameters: { src_lang, tgt_lang: "eng_Latn" } }`, return `{ text: translation }`.
- Add NLLB language code map: `ig → ibo_Latn`, `ff → fuv_Latn`, `kr → knc_Latn`, `ibb → ibb_Latn` (fallback to `eng_Latn` if unsupported), `tiv → tiv_Latn`. Any code NLLB doesn't recognise → return a clear 400 so the UI shows "Translation not available for this language".
- Reuses existing `HF_TOKEN` secret.

**`src/routes/index.tsx`**
- Remove the `translatable` gate. The Translation card renders whenever `transcript?.text` exists.
- `handleTranslate` branches on the selected language's `provider`:
  - `whisper` (Pidgin/Hausa/Yoruba) → existing audio-based call (`provider=whisper, mode=translate`, language code if set).
  - `mms` → text-based call (`provider=nllb`, `text=<transcript>`, `sourceLang=<code>`).
- Button label stays "Translate to English" / "Re-translate" / "Translating…".
- If NLLB returns "language not supported" for a given MMS code, show the error in the card (no crash, no hidden button).

## Technical notes

- NLLB language codes use BCP-47-ish format: `ibo_Latn` (Igbo), `fuv_Latn` (Nigerian Fulfulde), `knc_Latn` (Central Kanuri), `tiv_Latn` (Tiv). Ibibio (`ibb`) is **not** in NLLB-200 — for that one we'll surface "Translation not available" in the card rather than send a bad request.
- HuggingFace serverless inference for NLLB sometimes returns 503 "model loading" on first call; pass `{ options: { wait_for_model: true } }` so the request blocks until ready instead of failing.
- No new dependencies, no new secrets, no styling-token changes.

## Out of scope

- Caching translations (re-translate re-hits the API).
- Choosing a different translation provider per language (single NLLB fallback is enough for now).
- Translating from English back to native.
