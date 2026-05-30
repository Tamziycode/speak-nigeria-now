import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  Copy,
  Check,
  Download,
  Upload,
  X,
} from "lucide-react";
import { blobTo16kWav } from "@/lib/recorder";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Multilingual STT Prototype" },
      {
        name: "description",
        content:
          "Speech-to-text for Yoruba, Hausa, and Nigerian Pidgin powered by Whisper-large-v3.",
      },
    ],
  }),
});

const LANGUAGES = [
  { label: "Hausa", code: "ha" },
  { label: "Yoruba", code: "yo" },
  { label: "Nigerian Pidgin", code: "pcm" },
] as const;

const STORAGE_KEY = "stt:last-session";
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = [
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
];
const ACCEPTED_EXTS = [".wav", ".mp3", ".m4a"];

type RecState = "idle" | "recording" | "processing";

function Index() {
  const [language, setLanguage] = useState<string>("ha");
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // API health
  useEffect(() => {
    fetch("/api/transcribe", { method: "OPTIONS" })
      .then((r) => setApiOnline(r.ok))
      .catch(() => setApiOnline(false));
  }, []);

  // Restore last session
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { transcript?: string; language?: string };
      if (saved.transcript) setTranscript(saved.transcript);
      if (saved.language && LANGUAGES.some((l) => l.code === saved.language)) {
        setLanguage(saved.language);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persist transcript + language
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ transcript, language }),
      );
    } catch {
      /* ignore */
    }
  }, [transcript, language]);

  // Revoke object URL on change/unmount
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const setNewAudio = (blob: Blob) => {
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
  };

  const sendForTranscription = useCallback(
    async (file: File) => {
      setState("processing");
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("language", language);

        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: form,
        });

        const json = await res
          .json()
          .catch(() => ({ error: "Invalid response from server" }));

        if (!res.ok) {
          const errField = (json as { error?: unknown }).error;
          const msg =
            typeof errField === "string"
              ? errField
              : `Request failed (${res.status})`;
          setError(msg);
          setState("idle");
          return;
        }

        const text =
          typeof (json as { text?: unknown }).text === "string"
            ? (json as { text: string }).text.trim()
            : "";
        setTranscript(text);
        setState("idle");
      } catch (e) {
        setError((e as Error).message || "Network error. Please try again.");
        setState("idle");
      }
    },
    [language],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        if (duration < 1) {
          setState("idle");
          setError("Please record a longer audio segment.");
          return;
        }
        try {
          const raw = new Blob(chunksRef.current, { type: "audio/webm" });
          const wav = await blobTo16kWav(raw);
          setNewAudio(wav);
          await sendForTranscription(
            new File([wav], "recording.wav", { type: "audio/wav" }),
          );
        } catch (e) {
          setError((e as Error).message || "Failed to process audio.");
          setState("idle");
        }
      };

      rec.start();
      startTimeRef.current = Date.now();
      setElapsed(0);
      setState("recording");
      timerRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch {
      setError(
        "Microphone access denied. Please allow microphone access and try again.",
      );
    }
  }, [sendForTranscription]);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    clearTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const validateFile = (file: File): string | null => {
    const name = file.name.toLowerCase();
    const extOk = ACCEPTED_EXTS.some((e) => name.endsWith(e));
    const typeOk = ACCEPTED_TYPES.includes(file.type);
    if (!extOk && !typeOk) {
      return "Unsupported file type. Please upload a .wav, .mp3, or .m4a file.";
    }
    if (file.size > MAX_BYTES) {
      return "File exceeds the 25 MB size limit.";
    }
    return null;
  };

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      const validation = validateFile(file);
      if (validation) {
        setError(validation);
        return;
      }
      setNewAudio(file);
      await sendForTranscription(file);
    },
    [sendForTranscription],
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const handleCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    if (!transcript) return;
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcript-${language}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const { wordCount, charCount } = useMemo(() => {
    const trimmed = transcript.trim();
    return {
      wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
      charCount: transcript.length,
    };
  }, [transcript]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const busy = state !== "idle";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-base font-semibold tracking-tight">
            Multilingual STT Prototype
          </h1>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span
              className={`h-2 w-2 rounded-full ${
                apiOnline ? "bg-emerald-500" : "bg-red-500"
              }`}
              aria-hidden
            />
            <span className={apiOnline ? "text-emerald-700" : "text-red-700"}>
              API: {apiOnline ? "Online" : "Offline"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <span>{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
              className="text-red-700 hover:text-red-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <section className="flex flex-col items-center gap-8">
          {/* Language selector */}
          <div className="w-full max-w-sm">
            <label
              htmlFor="language"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              Target Language
            </label>
            <select
              id="language"
              value={language}
              disabled={busy}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* Controls */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-3">
              {state === "recording" ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-red-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
                >
                  <Square className="h-4 w-4 fill-current" />
                  Stop Recording
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={busy}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
                >
                  {state === "processing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                  {state === "processing" ? "Transcribing…" : "Start Recording"}
                </button>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-primary bg-card px-5 text-sm font-semibold text-primary shadow-sm transition hover:bg-accent disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                Upload Audio File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a"
                className="hidden"
                onChange={onFileInput}
              />
            </div>

            {state === "recording" && (
              <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-red-700">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" />
                {formatTime(elapsed)}
              </div>
            )}
            {state === "idle" && (
              <p className="text-xs text-muted-foreground">
                Record live or drop an audio file below · .wav, .mp3, .m4a · max 25 MB
              </p>
            )}
          </div>

          {/* Drop zone */}
          {state === "idle" && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`w-full rounded-lg border-2 border-dashed px-6 py-6 text-center text-sm transition ${
                dragOver
                  ? "border-primary bg-accent"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              Drag and drop an audio file here, or use the upload button above.
            </div>
          )}

          {/* Audio playback */}
          {audioUrl && (
            <div className="w-full">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Audio Preview
              </h2>
              <audio src={audioUrl} controls className="w-full" />
            </div>
          )}

          {/* Transcript */}
          <div className="w-full">
            <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcription Output
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!transcript}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-40"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!transcript}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download .txt
                  </button>
                </div>
              </div>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={
                  state === "processing"
                    ? "Transcribing…"
                    : "Your transcription will appear here. You can edit it freely."
                }
                className="min-h-[180px] w-full resize-y rounded-md border border-border bg-background p-3 text-base leading-relaxed text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="mt-2 flex justify-end gap-4 text-xs text-muted-foreground">
                <span>{wordCount} words</span>
                <span>{charCount} characters</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
