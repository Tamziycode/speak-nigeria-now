# Fix "Model not supported by provider hf-inference"

## Root cause

`router.huggingface.co/hf-inference/models/facebook/nllb-200-distilled-600M` returns `Model not supported by provider hf-inference`. HF removed NLLB from the serverless `hf-inference` provider — it's a provider-side change, not a code bug. The same token works for MMS because MMS is still on that provider.

## Fix (single file: `src/routes/api/transcribe.ts`, NLLB branch only)

Try providers/models in order and use the first that returns 200. Stop at the first success; only error out if all fail.

1. **Primary — HF router auto-provider**: POST to `https://router.huggingface.co/v1/chat/completions` (OpenAI-compatible) using a translation-capable instruct model (`meta-llama/Llama-3.3-70B-Instruct` or `Qwen/Qwen2.5-72B-Instruct`) with a strict system prompt: "Translate the user text from {srcLang full name} to English. Output only the translation, no preface." Map our `ha/yo/ig/ff/kr/pcm` codes to human names for the prompt. Parse `choices[0].message.content`.

2. **Fallback — Groq**: If `GROQ_API_KEY` is set, hit `https://api.groq.com/openai/v1/chat/completions` with `llama-3.3-70b-versatile` and the same prompt. Groq is already wired for Whisper so the key exists.

3. **Last resort**: Return the existing 400 with a clearer message ("Translation providers unavailable — try again shortly") instead of leaking `hf-inference`.

Keep request/response shape identical (`{ text, provider: "nllb" }` — leave the provider tag as `"nllb"` so the frontend needs no changes, or rename to `"llm"` if you prefer; frontend only reads `text`).

## Out of scope

- MMS chunking (already done last turn).
- Whisper branch.
- Frontend changes.

## Why not just swap to another HF model

Every NLLB variant on HF serverless is in the same deprecated bucket right now. An LLM-based translation via the HF router (or Groq) is the lowest-friction working path and uses tokens you already have.
