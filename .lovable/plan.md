# Fix nonsense Hausa/Yoruba output

## What's wrong

Whisper-large-v3 (Groq) lists Hausa and Yoruba as "supported" but in practice hallucinates on them — that's why you got `🎵`, Malay ("Terima kasih kerana menonton!"), and the garbled "I am a woman, a woman…" translation. Meta MMS actually has dedicated acoustic models for both languages and produces real transcripts.

## Change

**`src/routes/index.tsx`** — flip Hausa and Yoruba to MMS:

```ts
{ label: "Hausa",  code: "ha", provider: "mms" },
{ label: "Yoruba", code: "yo", provider: "mms" },
```

Pidgin stays on Whisper (English-based, Whisper handles it well).

**`src/routes/api/transcribe.ts`** — extend the MMS ISO-639-3 map so the new codes resolve correctly:

```ts
const MMS_LANG_MAP = {
  ha: "hau",   // Hausa
  yo: "yor",   // Yoruba
  ig: "ibo",
  ff: "fuv",
  kr: "knc",
  ibb: "ibb",
  tiv: "tiv",
  pcm: "pcm",
};
```

## Translation still works

The NLLB branch we just built already covers Hausa (`hau_Latn`) and Yoruba (`yor_Latn`), so the "Translate to English" button keeps working — it just goes MMS → NLLB instead of Whisper → Whisper-translate. Pidgin keeps using the Whisper audio-translate path.

## UI copy

Update the "Engine:" helper text mapping so Hausa/Yoruba show "Meta MMS (HuggingFace)" instead of "Whisper-large-v3 (Groq)". The `translatable` flag is no longer used for gating (already removed) — safe to drop from the type.

## Out of scope

- No changes to recording, WAV encoding, or the route/API shape.
- No new dependencies or secrets.
