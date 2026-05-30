# Chunk MMS audio to bypass HF 30s limit

Implementation per the spec. All work in `src/routes/api/transcribe.ts`; nothing else changes.

## 1. `sliceWavToChunks(buffer: ArrayBuffer): Uint8Array[]`

- Read 44-byte RIFF/WAV header with `DataView`:
  - `numChannels` @ offset 22 (uint16 LE)
  - `sampleRate` @ offset 24 (uint32 LE)
  - `byteRate` @ offset 28 (uint32 LE)
  - `bitsPerSample` @ offset 34 (uint16 LE)
- PCM payload = bytes from offset 44 to end.
- Chunk size (bytes) = `byteRate * 25` (25s). Overlap = `byteRate * 0.5` (0.5s back-step). Align both down to a sample frame boundary (`numChannels * bitsPerSample / 8`) so we never split a sample.
- Walk the payload with `step = chunkBytes - overlapBytes`, slicing `[i, i + chunkBytes)`.
- For each slice, build a new 44-byte header (copy original, then patch):
  - offset 4 — `ChunkSize` = `36 + dataLen` (uint32 LE)
  - offset 40 — `Subchunk2Size` = `dataLen` (uint32 LE)
- Concatenate header + slice into a `Uint8Array` and push.

## 2. Sequential dispatch in the MMS branch

- Compute `durationSec = (totalBytes - 44) / byteRate`.
- If `durationSec <= 25` → keep the existing single-request path untouched.
- Else: `const chunks = sliceWavToChunks(buffer)`, then `for (const chunk of chunks) { ... await fetch(...) }`. No `Promise.all` — HF serverless rate-limits parallel ASR calls (429s).
- Same endpoint, same headers (`Authorization`, `Content-Type: audio/wav`, `x-wait-for-model: true`) as today; body is the chunk bytes.

## 3. Concatenation + fault tolerance

- `let finalTranscript = ""`.
- Per chunk: `try` → parse JSON, append `text.trim()` joined by a single space. `catch` → append `[untranscribed segment]` and continue (log the error server-side via `console.error`).
- Return the same response shape as before: `{ text: finalTranscript.trim(), provider: "mms", language: targetLang }`. The frontend needs zero changes.

## Out of scope

- Whisper branch (Groq comfortably handles long audio).
- NLLB translation chunking (text input — fine as-is).
- Client-side progress updates.
