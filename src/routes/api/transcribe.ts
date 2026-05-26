import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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
              { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
            );
          }

          const incoming = await request.formData();
          const file = incoming.get("file");
          const language = (incoming.get("language") as string) || "";
          const prompt = (incoming.get("prompt") as string) || "";

          if (!file || !(file instanceof File)) {
            return new Response(
              JSON.stringify({ error: "Missing audio file" }),
              { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } },
            );
          }

          const upstream = new FormData();
          upstream.append("file", file, file.name || "audio.wav");
          upstream.append("model", "whisper-large-v3");
          upstream.append("response_format", "json");
          if (language) upstream.append("language", language);
          if (prompt) upstream.append("prompt", prompt);

          const res = await fetch(
            "https://api.groq.com/openai/v1/audio/transcriptions",
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
              "Content-Type": res.headers.get("Content-Type") || "application/json",
              ...corsHeaders,
            },
          });
        } catch (err) {
          console.error("Transcription error:", err);
          return new Response(
            JSON.stringify({ error: (err as Error).message || "Unknown error" }),
            { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
          );
        }
      },
    },
  },
});
