# Multilingual STT Prototype

A research-grade speech-to-text web application for **Yoruba**, **Hausa**, and
**Nigerian Pidgin**, built to evaluate state-of-the-art multilingual ASR
performance on low-resource Nigerian languages.

Audio captured in-browser (or uploaded) is normalized to 16 kHz mono WAV and
proxied through a Cloudflare Worker to the Groq API, which serves OpenAI's
`whisper-large-v3` model at temperature `0.0` for deterministic transcription.
Transcripts can be edited, copied, exported to `.txt`, and translated to
English on demand.

## Technical Stack

| Layer       | Technology                                                  |
| ----------- | ----------------------------------------------------------- |
| Frontend    | React 19, TanStack Start, TanStack Router, Tailwind CSS v4  |
| Build       | Vite 7                                                      |
| Runtime     | Cloudflare Workers (serverless edge)                        |
| Audio DSP   | Web Audio API (`AudioContext`, `OfflineAudioContext`)       |
| ASR Model   | `whisper-large-v3` via Groq Inference API                   |
| Persistence | `localStorage` (last session recovery)                      |

## Core Features

- Live microphone capture with WAV normalization (16 kHz mono PCM)
- Drag-and-drop / file upload (`.wav`, `.mp3`, `.m4a`, max 25 MB)
- Editable transcript with real-time word and character analytics
- One-click English translation via Whisper's translation endpoint
- Copy to clipboard and `.txt` export for both transcript and translation
- Session recovery across page reloads
- Live API health indicator, mic-permission diagnostics, offline detection

## Supported Languages

| Language        | ISO Code | Strategy                                            |
| --------------- | -------- | --------------------------------------------------- |
| Hausa           | `ha`     | Native Whisper language hint                        |
| Yoruba          | `yo`     | Native Whisper language hint                        |
| Nigerian Pidgin | `pcm`    | Auto-detection (no ISO 639-1 code in Whisper)       |

## Local Setup

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
echo "GROQ_API_KEY=gsk_your_key_here" > .env

# 3. Run the dev server
bun dev
```

The app boots at `http://localhost:8080`.

## Known Limitations

- **Nigerian Pidgin** is handled via Whisper's auto-detect; transcription
  quality degrades on heavily code-switched audio.
- **25 MB upload cap** enforced both client- and server-side to control
  inference cost.
- Whisper-large-v3 was not specifically fine-tuned on Nigerian dialects, so
  accuracy on regional accents may vary.

## Security

- The Groq API key is **never** shipped to the browser; all inference is
  proxied through the `/api/transcribe` server route.
- `.env` files are git-ignored and must be configured per environment.
