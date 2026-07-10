# EchoLine — Realtime One-Way Translation

Browser web app that streams microphone or tab audio to OpenAI's `gpt-realtime-translate` over WebRTC and plays back translated speech with live captions.

## Prerequisites

- Node.js 20+ (18 may work; 21+ is fine)
- An [OpenAI API key](https://platform.openai.com/api-keys) with access to Realtime Translation

## Setup

```bash
cp .env.local.example .env.local
```

Add your key to `.env.local`:

```bash
OPENAI_API_KEY=sk-...
```

Install and run:

```bash
npm install
npm run dev
```

`npm run dev` serves **HTTPS** on all interfaces (`0.0.0.0`) so other machines on your LAN can open the app. It auto-generates a self-signed cert in `certs/` (localhost + detected LAN IPs).

Open [https://localhost:3000](https://localhost:3000). From another device, use `https://<your-lan-ip>:3000`.

Browsers will warn about the self-signed certificate — accept/continue once per device. That secure context is required for microphone and tab audio capture off `localhost`.

If your LAN IP changes (or wasn’t detected), regenerate:

```bash
HTTPS_EXTRA_HOSTS=192.168.1.50 npm run certs
```

Then restart `npm run dev` so both the TLS cert and `allowedDevOrigins` (needed for Fast Refresh / HMR WebSockets) pick up the new IP.

Useful scripts:

| Script | Purpose |
|--------|---------|
| `npm run certs` | Regenerate TLS certs (e.g. after your LAN IP changes) |
| `npm run build && npm run start:https` | Production build over HTTPS (same `certs/` or `HTTPS_KEY` / `HTTPS_CERT`) |

## How it works

1. The browser asks your Next.js API route (`POST /api/session`) for a short-lived client secret.
2. The server calls `https://api.openai.com/v1/realtime/translations/client_secrets` with your API key — the key never reaches the browser.
3. The browser captures mic or tab audio, opens an `RTCPeerConnection`, and posts an SDP offer to `https://api.openai.com/v1/realtime/translations/calls`.
4. Translated audio arrives as a remote WebRTC track; caption deltas arrive on the `oai-events` data channel.

This uses the dedicated **translation** endpoint (`/v1/realtime/translations`), not the voice-agent Realtime session. There is no `response.create` turn loop — audio is translated continuously as it arrives.

## Supported output languages

The model auto-detects 70+ input languages. Spoken output is limited to these 13 codes:

| Code | Language   |
|------|------------|
| `es` | Spanish    |
| `pt` | Portuguese |
| `fr` | French     |
| `ja` | Japanese   |
| `ru` | Russian    |
| `zh` | Chinese    |
| `de` | German     |
| `ko` | Korean     |
| `hi` | Hindi      |
| `id` | Indonesian |
| `vi` | Vietnamese |
| `it` | Italian    |
| `en` | English    |

### Chinese caption script

The API only accepts `zh` for Chinese (typically Simplified captions). When Chinese is selected, the UI offers **Traditional (繁體)** or **Simplified (简体)** for captions. Traditional display is converted in the browser with [OpenCC](https://github.com/BYVoid/OpenCC) (`cn` → `tw`). Spoken audio is unchanged.

## Usage tips

- **Microphone / virtual input**: choose any audio input device the browser exposes, including virtual mics such as BlackHole or Loopback. Route another app’s output into that virtual device in your OS, then select it here. Enable **Audio volume** in Source transcript to monitor the captured input (keep volume low with a real mic to avoid feedback).
- **Browser tab**: share a tab with audio enabled. Prefer Chrome. When supported, local tab playback is suppressed so you do not hear original + translation at once; enable **Audio volume** in Source transcript if you want some source audio mixed in.
- Changing the target language requires stopping and starting a new session (one session per output language).
- Source transcripts use `gpt-realtime-whisper` when configured on the session.
- For Chinese, toggle caption script anytime; Traditional is the default.

## Cost

Realtime Translation is billed by **audio duration** (not text tokens). Check current pricing on the [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-realtime-translate). Keep sessions short while developing.

## Project layout

- `app/api/session/route.ts` — mints translation client secrets
- `app/api/debug/events/route.ts` — prints forwarded realtime model events to the server console
- `lib/languages.ts` — supported output language codes
- `lib/chinese-script.ts` — Simplified ↔ Traditional caption conversion (OpenCC)
- `lib/audio-devices.ts` — enumerate microphone / virtual input devices
- `lib/translation-session.ts` — WebRTC capture, SDP negotiation, event handling
- `components/TranslatorApp.tsx` — UI

While a session is live, watch the Next.js terminal for lines like `[session] …` and `[realtime][sess_…][model] session.output_transcript.delta …`.

## Notes

- Custom prompts, glossaries, and fixed voice selection are not supported by `gpt-realtime-translate` today.
- Speech already in the selected output language may produce little or no translated audio (by design).
- This app is one-way only; two-way conversation needs a second translation session in the reverse direction.
