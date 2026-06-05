## Goal
Add manual English translation of the recorded/uploaded audio via Groq's Whisper `/audio/translations` endpoint, surfaced as a button next to Copy/Download and rendered in a new panel below the transcription panel.

## Changes

### 1. `src/routes/api/transcribe.ts`
- Add a second handler path by accepting a new form field `mode` (`"transcribe"` | `"translate"`, default `"transcribe"`).
- When `mode === "translate"`:
  - POST the audio file to `https://api.groq.com/openai/v1/audio/translations` with `model=whisper-large-v3`, `response_format=json`, `temperature=0.0`.
  - Do NOT send a `language` param (translations endpoint auto-detects source and always outputs English).
  - Keep the same 25 MB cap, CORS, and error envelope.
- Keep existing transcription behavior unchanged.

### 2. `src/routes/index.tsx`
- New state: `translation: string`, `translating: boolean`, `lastAudioFile: File | null` (stash the most recent File/Blob used for transcription so the translate button can reuse it without re-recording).
- Update `sendForTranscription` to remember the `File` it sent (store in ref `lastAudioFileRef`).
- New handler `translateToEnglish()`:
  - Guard: requires `lastAudioFileRef.current`; otherwise show error "Record or upload audio first."
  - POSTs to `/api/transcribe` with `mode=translate` and the stored file.
  - Sets `translation` on success; sets `error` on failure.
- New "Translate to English" button in the transcription panel header row (next to Copy / Download). Disabled when no audio or while busy. Shows spinner while translating.
- New panel rendered below the transcription panel when `translation || translating`:
  - Title: "English Translation"
  - Editable `<textarea>` bound to `translation`
  - Its own Copy + Download `.txt` buttons (filename `translation-en-${ts}.txt`)
  - Word / character counts
- Persist `translation` alongside transcript in `localStorage` under `STORAGE_KEY`.
- Clear `translation` when a new recording/upload starts so the panel reflects the current audio.

## Out of scope
- No automatic translation after transcription (manual button only).
- No LLM fallback for Pidgin — Whisper translations endpoint handles all three languages; Pidgin quality is accepted as-is.
- No changes to language selector, recorder, or styling tokens beyond adding the new button + panel using existing classes.
