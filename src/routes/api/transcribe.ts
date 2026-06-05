import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };

// Strictly limited to the three supported Nigerian languages.
const SUPPORTED = new Set(["ha", "yo", "pcm"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const apiKey = process.env.GROQ_API_KEY;
          if (!apiKey) {
            return new Response(
              JSON.stringify({ error: "GROQ_API_KEY not configured" }),
              { status: 500, headers: jsonHeaders },
            );
          }

          const incoming = await request.formData();
          const file = incoming.get("file");
          const language = ((incoming.get("language") as string) || "").toLowerCase();
          const mode = ((incoming.get("mode") as string) || "transcribe").toLowerCase();

          if (!file || !(file instanceof File)) {
            return new Response(JSON.stringify({ error: "Missing audio file" }), {
              status: 400,
              headers: jsonHeaders,
            });
          }

          if (file.size > MAX_BYTES) {
            return new Response(
              JSON.stringify({ error: "File exceeds 25 MB limit" }),
              { status: 413, headers: jsonHeaders },
            );
          }

          const isTranslate = mode === "translate";

          if (!isTranslate && !SUPPORTED.has(language)) {
            return new Response(
              JSON.stringify({
                error: "Unsupported language. Use 'ha', 'yo', or 'pcm'.",
              }),
              { status: 400, headers: jsonHeaders },
            );
          }

          const upstream = new FormData();
          upstream.append("file", file, file.name || "audio.wav");
          upstream.append("model", "whisper-large-v3");
          upstream.append("response_format", "json");
          upstream.append("temperature", "0.0");
          // Whisper has codes for Hausa (ha) and Yoruba (yo). Nigerian Pidgin
          // has no ISO Whisper code — let the model auto-detect.
          if (!isTranslate && (language === "ha" || language === "yo")) {
            upstream.append("language", language);
          }

          const endpoint = isTranslate
            ? "https://api.groq.com/openai/v1/audio/translations"
            : "https://api.groq.com/openai/v1/audio/transcriptions";

          const res = await fetch(
            endpoint,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              body: upstream,
            },
          );

          const text = await res.text();
          return new Response(text, {
            status: res.status,
            headers: {
              "Content-Type":
                res.headers.get("Content-Type") || "application/json",
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
