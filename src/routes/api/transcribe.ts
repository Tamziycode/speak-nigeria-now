import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };

// ISO 639-3 codes for MMS adapters
const MMS_LANG_MAP: Record<string, string> = {
  ig: "ibo",
  ff: "fuv", // Nigerian Fulfulde
  kr: "knc", // Central Kanuri
  ibb: "ibb",
  tiv: "tiv",
  pcm: "pcm",
};

// NLLB-200 source language codes (BCP-47 style: lang_Script)
// Tiv and Ibibio are NOT in NLLB-200 → surface a clear error.
const NLLB_LANG_MAP: Record<string, string> = {
  ha: "hau_Latn",
  yo: "yor_Latn",
  ig: "ibo_Latn",
  ff: "fuv_Latn", // Nigerian Fulfulde
  kr: "knc_Latn", // Central Kanuri
  pcm: "eng_Latn", // Pidgin → treat as English (Whisper path handles it better)
};

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

          // ===== MMS via HuggingFace Inference =====
          if (provider === "mms") {
            const hfToken = process.env.HF_TOKEN;
            if (!hfToken) {
              return new Response(
                JSON.stringify({ error: "HF_TOKEN not configured" }),
                { status: 500, headers: jsonHeaders },
              );
            }
            const targetLang = MMS_LANG_MAP[language] || language || "eng";
            const bytes = new Uint8Array(await file.arrayBuffer());

            const hfRes = await fetch(
              "https://api-inference.huggingface.co/models/facebook/mms-1b-all",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${hfToken}`,
                  "Content-Type": "audio/wav",
                  "x-wait-for-model": "true",
                  "x-use-cache": "false",
                },
                body: bytes,
              },
            );

            const raw = await hfRes.text();
            if (!hfRes.ok) {
              let msg = raw;
              try {
                const j = JSON.parse(raw);
                msg = j.error || raw;
              } catch {}
              return new Response(
                JSON.stringify({
                  error: `MMS (${targetLang}) unavailable: ${msg}`,
                }),
                { status: hfRes.status, headers: jsonHeaders },
              );
            }
            let parsed: { text?: string } = {};
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = { text: raw };
            }
            return new Response(
              JSON.stringify({ text: parsed.text || "", provider: "mms", language: targetLang }),
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
