import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };

// Per-language fine-tuned MMS endpoints (avoid mms-1b-all hallucination loops).
const mmsEndpoints: Record<string, string> = {
  yo: "https://api-inference.huggingface.co/models/facebook/mms-1b-yor",
  ig: "https://api-inference.huggingface.co/models/facebook/mms-1b-ibo",
  ha: "https://api-inference.huggingface.co/models/facebook/mms-1b-hau",
  ff: "https://api-inference.huggingface.co/models/facebook/mms-1b-fuv",
  kr: "https://api-inference.huggingface.co/models/facebook/mms-1b-knc",
  ibb: "https://api-inference.huggingface.co/models/facebook/mms-1b-ibb",
  tiv: "https://api-inference.huggingface.co/models/facebook/mms-1b-tiv",
  pcm: "https://api-inference.huggingface.co/models/facebook/mms-1b-eng", // Pidgin fallback
};
const DEFAULT_MMS_ENDPOINT =
  "https://api-inference.huggingface.co/models/facebook/mms-1b-eng";


// Human-readable names used in the LLM translation prompt.
const LANG_NAMES: Record<string, string> = {
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
  ff: "Nigerian Fulfulde",
  kr: "Kanuri",
  pcm: "Nigerian Pidgin English",
  ibb: "Ibibio",
  tiv: "Tiv",
};

// Split a 16-bit PCM RIFF/WAV buffer into ~25s chunks with 0.5s overlap.
// Each chunk is a fully self-contained WAV (44-byte header + sliced PCM data).
function sliceWavToChunks(buffer: ArrayBuffer): Uint8Array[] {
  const src = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const bitsPerSample = view.getUint16(34, true);

  if (!byteRate || !numChannels || !bitsPerSample) {
    // Header looks broken — fall back to single chunk.
    return [src];
  }

  const frameSize = (numChannels * bitsPerSample) / 8; // bytes per sample frame
  const alignDown = (n: number) => Math.floor(n / frameSize) * frameSize;
  const chunkBytes = alignDown(byteRate * 25);
  const overlapBytes = alignDown(byteRate * 0.5);
  const step = Math.max(frameSize, chunkBytes - overlapBytes);

  const pcm = src.subarray(44);
  const out: Uint8Array[] = [];

  for (let i = 0; i < pcm.length; i += step) {
    const slice = pcm.subarray(i, Math.min(i + chunkBytes, pcm.length));
    if (slice.length < frameSize) break;

    const wav = new Uint8Array(44 + slice.length);
    wav.set(src.subarray(0, 44), 0); // copy original header
    wav.set(slice, 44);

    const dv = new DataView(wav.buffer);
    dv.setUint32(4, 36 + slice.length, true); // ChunkSize
    dv.setUint32(40, slice.length, true); // Subchunk2Size
    // sampleRate/byteRate untouched — same encoding as source.
    void sampleRate;

    out.push(wav);
    if (i + chunkBytes >= pcm.length) break;
  }

  return out.length ? out : [src];
}



export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const incoming = await request.formData();
          const file = incoming.get("file");
          const language = (incoming.get("language") as string) || "";
          const provider = ((incoming.get("provider") as string) || "whisper").toLowerCase();
          const mode = ((incoming.get("mode") as string) || "transcribe").toLowerCase();
          const prompt = (incoming.get("prompt") as string) || "";

          if (!file || !(file instanceof File)) {
            return new Response(JSON.stringify({ error: "Missing audio file" }), {
              status: 400,
              headers: jsonHeaders,
            });
          }

          // ===== Text translation via LLM (HF router + Groq fallback) =====
          if (provider === "nllb") {
            const text = (incoming.get("text") as string) || "";
            const sourceLang = (incoming.get("sourceLang") as string) || "";
            if (!text.trim()) {
              return new Response(
                JSON.stringify({ error: "Missing text to translate" }),
                { status: 400, headers: jsonHeaders },
              );
            }

            const langName = LANG_NAMES[sourceLang] || sourceLang || "the source language";
            const system =
              `You are a professional translator. Translate the user's text from ${langName} to English. ` +
              `Output ONLY the English translation as plain text — no quotes, no preface, no explanation, no notes.`;
            const chatBody = {
              messages: [
                { role: "system", content: system },
                { role: "user", content: text },
              ],
              temperature: 0.2,
              max_tokens: 1024,
            };

            type Attempt = { url: string; token: string | undefined; model: string; label: string };
            const attempts: Attempt[] = [
              {
                label: "hf-router",
                url: "https://router.huggingface.co/v1/chat/completions",
                token: process.env.HF_TOKEN,
                model: "meta-llama/Llama-3.3-70B-Instruct",
              },
              {
                label: "hf-router-qwen",
                url: "https://router.huggingface.co/v1/chat/completions",
                token: process.env.HF_TOKEN,
                model: "Qwen/Qwen2.5-72B-Instruct",
              },
              {
                label: "groq",
                url: "https://api.groq.com/openai/v1/chat/completions",
                token: process.env.GROQ_API_KEY,
                model: "llama-3.3-70b-versatile",
              },
            ];

            const errors: string[] = [];
            for (const a of attempts) {
              if (!a.token) {
                errors.push(`${a.label}: no token configured`);
                continue;
              }
              try {
                const r = await fetch(a.url, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${a.token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ model: a.model, ...chatBody }),
                });
                const raw = await r.text();
                if (!r.ok) {
                  let msg = raw;
                  try {
                    const j = JSON.parse(raw);
                    msg = j.error?.message || j.error || raw;
                  } catch {}
                  errors.push(`${a.label} ${r.status}: ${String(msg).slice(0, 200)}`);
                  continue;
                }
                const j = JSON.parse(raw);
                const translated = j.choices?.[0]?.message?.content?.trim?.() || "";
                if (!translated) {
                  errors.push(`${a.label}: empty response`);
                  continue;
                }
                return new Response(
                  JSON.stringify({ text: translated, provider: "nllb" }),
                  { status: 200, headers: jsonHeaders },
                );
              } catch (e) {
                errors.push(`${a.label}: ${(e as Error).message}`);
              }
            }

            console.error("Translation providers failed:", errors.join(" | "));
            return new Response(
              JSON.stringify({
                error: "Translation providers unavailable — please try again shortly.",
              }),
              { status: 502, headers: jsonHeaders },
            );
          }

          // ===== MMS via HuggingFace Inference (per-language endpoints) =====
          if (provider === "mms") {
            const hfToken = process.env.HF_API_KEY || process.env.HF_TOKEN;
            if (!hfToken) {
              return new Response(
                JSON.stringify({ error: "HF_API_KEY not configured" }),
                { status: 500, headers: jsonHeaders },
              );
            }
            const mmsUrl = mmsEndpoints[language] || DEFAULT_MMS_ENDPOINT;
            const targetLang = language || "eng";
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);

            const mmsHeaders = {
              Authorization: `Bearer ${hfToken}`,
              "Content-Type": "audio/wav",
              "X-Wait-For-Model": "true",
            };


            // Parse WAV header to decide whether chunking is needed.
            const view = new DataView(buffer);
            const byteRate = view.getUint32(28, true);
            const durationSec = byteRate > 0 ? (bytes.length - 44) / byteRate : 0;

            const callMms = async (body: Uint8Array) => {
              const r = await fetch(mmsUrl, { method: "POST", headers: mmsHeaders, body: body as BodyInit });
              const txt = await r.text();
              if (!r.ok) {
                let msg = txt;
                try {
                  const j = JSON.parse(txt);
                  msg = j.error || txt;
                } catch {}
                throw new Error(`HF ${r.status}: ${msg}`);
              }
              try {
                const j = JSON.parse(txt);
                return typeof j.text === "string" ? j.text : "";
              } catch {
                return txt;
              }
            };

            // ≤25s: single request, original behaviour.
            if (durationSec <= 25) {
              try {
                const text = await callMms(bytes);
                return new Response(
                  JSON.stringify({ text, provider: "mms", language: targetLang }),
                  { status: 200, headers: jsonHeaders },
                );
              } catch (e) {
                return new Response(
                  JSON.stringify({
                    error: `MMS (${targetLang}) unavailable: ${(e as Error).message}`,
                  }),
                  { status: 502, headers: jsonHeaders },
                );
              }
            }

            // >25s: slice into 25s chunks with 0.5s overlap, dispatch sequentially.
            const chunks = sliceWavToChunks(buffer);
            let finalTranscript = "";
            for (const chunk of chunks) {
              try {
                const piece = (await callMms(chunk)).trim();
                if (piece) finalTranscript += (finalTranscript ? " " : "") + piece;
              } catch (e) {
                console.error("MMS chunk failed:", (e as Error).message);
                finalTranscript +=
                  (finalTranscript ? " " : "") + "[untranscribed segment]";
              }
            }
            return new Response(
              JSON.stringify({
                text: finalTranscript.trim(),
                provider: "mms",
                language: targetLang,
              }),
              { status: 200, headers: jsonHeaders },
            );
          }


          // ===== Whisper (Groq) =====
          const apiKey = process.env.GROQ_API_KEY;
          if (!apiKey) {
            return new Response(
              JSON.stringify({ error: "GROQ_API_KEY not configured" }),
              { status: 500, headers: jsonHeaders },
            );
          }

          const upstream = new FormData();
          upstream.append("file", file, file.name || "audio.wav");
          upstream.append("response_format", "json");
          if (prompt) upstream.append("prompt", prompt);

          const endpoint =
            mode === "translate"
              ? "https://api.groq.com/openai/v1/audio/translations"
              : "https://api.groq.com/openai/v1/audio/transcriptions";

          if (mode === "translate") {
            upstream.append("model", "whisper-large-v3");
          } else {
            upstream.append("model", "whisper-large-v3");
            if (language) upstream.append("language", language);
          }

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: upstream,
          });

          const text = await res.text();
          return new Response(text, {
            status: res.status,
            headers: {
              "Content-Type": res.headers.get("Content-Type") || "application/json",
              ...corsHeaders,
            },
          });
        } catch (err) {
          console.error("Transcription error:", err);
          return new Response(
            JSON.stringify({ error: (err as Error).message || "Unknown error" }),
            { status: 500, headers: jsonHeaders },
          );
        }
      },
    },
  },
});
