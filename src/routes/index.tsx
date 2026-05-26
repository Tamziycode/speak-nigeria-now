import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mic,
  Square,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  X,
  CircleDot,
} from "lucide-react";
import { blobTo16kWav } from "@/lib/recorder";
import { computeWER, type WERResult } from "@/lib/wer";


export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Multilingual STT Prototype" },
      {
        name: "description",
        content:
          "Real-time speech-to-text prototype for indigenous Nigerian languages.",
      },
    ],
  }),
});

// `supported: true` = native Groq Whisper language code.
// Unsupported languages are still selectable (for logging/UX) but we omit the
// `language` field on the API call and let Whisper auto-detect.
const LANGUAGES: { label: string; code: string; supported: boolean }[] = [
  { label: "Nigerian Pidgin", code: "pcm", supported: false },
  { label: "Hausa", code: "ha", supported: true },
  { label: "Yoruba", code: "yo", supported: true },
  { label: "Igbo", code: "ig", supported: false },
  { label: "Fulfulde", code: "ff", supported: false },
  { label: "Kanuri", code: "kr", supported: false },
  { label: "Ibibio", code: "ibb", supported: false },
  { label: "Tiv", code: "tiv", supported: false },
];


type RecState = "idle" | "recording" | "processing";

function Index() {
  const [language, setLanguage] = useState("pcm");
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<{ text: string; raw: unknown } | null>(null);
  const [groundTruth, setGroundTruth] = useState("");
  const [wer, setWer] = useState<WERResult | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const slowWarnRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/transcribe", { method: "OPTIONS" })
      .then((r) => setApiOnline(r.ok))
      .catch(() => setApiOnline(false));
  }, []);

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = useCallback(async () => {
    setError(null);
    setWarning(null);
    setTranscript(null);
    setWer(null);

    setPermissionDenied(false);

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
      rec.onstop = handleStop;

      rec.start();
      startTimeRef.current = Date.now();
      setElapsed(0);
      setState("recording");
      timerRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch (e) {
      console.error(e);
      setPermissionDenied(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    clearTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const handleStop = async () => {
    const duration = (Date.now() - startTimeRef.current) / 1000;
    setState("processing");

    if (duration < 1) {
      setState("idle");
      setError("Please record a longer audio segment.");
      return;
    }

    try {
      const raw = new Blob(chunksRef.current, { type: "audio/webm" });
      const wav = await blobTo16kWav(raw);

      const form = new FormData();
      form.append("file", new File([wav], "audio.wav", { type: "audio/wav" }));
      const lang = LANGUAGES.find((l) => l.code === language);
      if (lang?.supported) form.append("language", lang.code);

      const controller = new AbortController();
      slowWarnRef.current = window.setTimeout(() => {
        setWarning("Network degraded: Transcription delayed");
      }, 15000);

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (slowWarnRef.current) {
        window.clearTimeout(slowWarnRef.current);
        slowWarnRef.current = null;
      }

      const json = await res.json().catch(() => ({ error: "Invalid response" }));
      if (!res.ok) {
        const errField = (json as { error?: unknown }).error;
        const msg =
          typeof errField === "string"
            ? errField
            : errField && typeof errField === "object" && "message" in errField
              ? String((errField as { message: unknown }).message)
              : `Request failed (${res.status})`;
        setError(msg);
        setState("idle");
        return;
      }

      const text =
        typeof (json as { text?: unknown }).text === "string"
          ? ((json as { text: string }).text.trim())
          : "";
      setTranscript({ text, raw: json });
      setWer(null);
      setState("idle");
    } catch (e) {
      console.error(e);
      setError((e as Error).message || "Transcription failed");
      setState("idle");
    }
  };

  const handleCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCalculateWER = () => {
    if (!transcript?.text || !groundTruth.trim()) return;
    setWer(computeWER(groundTruth, transcript.text));
  };


  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    const ms = Math.floor((s % 1) * 10);
    return `${m}:${sec}.${ms}`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background">
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

      <main className="mx-auto max-w-3xl px-6 py-12">
        {/* Banners */}
        {permissionDenied && (
          <Banner
            tone="error"
            onClose={() => setPermissionDenied(false)}
            message="Microphone access denied. Please allow microphone access in your browser settings and try again."
          />
        )}
        {error && (
          <Banner tone="error" onClose={() => setError(null)} message={error} />
        )}
        {warning && (
          <Banner
            tone="warning"
            onClose={() => setWarning(null)}
            message={warning}
          />
        )}

        {/* Dashboard */}
        <section className="flex flex-col items-center gap-8">
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
              disabled={state !== "idle"}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground disabled:opacity-50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* Record button */}
          <div className="flex flex-col items-center gap-4">
            <RecordButton
              state={state}
              elapsed={elapsed}
              onStart={startRecording}
              onStop={stopRecording}
            />
            <p className="text-xs text-muted-foreground">
              {state === "idle" && "Press to capture audio · 16kHz mono WAV"}
              {state === "recording" && (
                <span className="font-mono tabular-nums">
                  {formatTime(elapsed)}
                </span>
              )}
              {state === "processing" && "Forwarding to inference engine…"}
            </p>
          </div>

          {/* Transcript card */}
          <div className="w-full">
            <div className="rounded-lg border border-border bg-[oklch(0.985_0_0)] p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcription Output
                </h2>
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
              </div>
              <pre className="min-h-[140px] whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
                {transcript
                  ? JSON.stringify(transcript, null, 2)
                  : state === "processing"
                    ? "…"
                    : "// Awaiting transcription"}
              </pre>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function RecordButton({
  state,
  elapsed,
  onStart,
  onStop,
}: {
  state: RecState;
  elapsed: number;
  onStart: () => void;
  onStop: () => void;
}) {
  if (state === "processing") {
    return (
      <button
        disabled
        className="inline-flex h-14 min-w-[220px] items-center justify-center gap-2.5 rounded-full border border-border bg-card px-7 text-sm font-semibold text-foreground shadow-sm"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Transcribing…
      </button>
    );
  }

  if (state === "recording") {
    return (
      <button
        onClick={onStop}
        className="inline-flex h-14 min-w-[220px] items-center justify-center gap-2.5 rounded-full bg-destructive px-7 text-sm font-semibold text-destructive-foreground shadow-[var(--shadow-elegant)] transition hover:opacity-90"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <Square className="h-4 w-4 fill-current" />
        Stop · <span className="font-mono tabular-nums">
          {Math.floor(elapsed / 60).toString().padStart(2, "0")}:
          {Math.floor(elapsed % 60).toString().padStart(2, "0")}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={onStart}
      style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-elegant)" }}
      className="inline-flex h-14 min-w-[220px] items-center justify-center gap-2.5 rounded-full px-7 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
    >
      <Mic className="h-4 w-4" />
      Start Recording
    </button>
  );
}


function Banner({
  tone,
  message,
  onClose,
}: {
  tone: "error" | "warning";
  message: string;
  onClose: () => void;
}) {
  const styles =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  const Icon = tone === "error" ? AlertCircle : CircleDot;
  return (
    <div
      className={`mb-6 flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${styles}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{message}</p>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="opacity-60 transition hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
