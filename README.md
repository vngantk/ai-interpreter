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

Open [http://localhost:3000](http://localhost:3000).

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

## Usage tips

- **Microphone**: speak into your mic; hear the translation and watch captions.
- **Browser tab**: share a tab with audio enabled. Prefer Chrome. When supported, local tab playback is suppressed so you do not hear original + translation at once; use the **Original** slider if you want some source audio mixed in.
- Changing the target language requires stopping and starting a new session (one session per output language).
- Source transcripts use `gpt-realtime-whisper` when configured on the session.

## Cost

Realtime Translation is billed by **audio duration** (not text tokens). Check current pricing on the [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-realtime-translate). Keep sessions short while developing.

## Project layout

- `app/api/session/route.ts` — mints translation client secrets
- `lib/languages.ts` — supported output language codes
- `lib/translation-session.ts` — WebRTC capture, SDP negotiation, event handling
- `components/TranslatorApp.tsx` — UI

## Notes

- Custom prompts, glossaries, and fixed voice selection are not supported by `gpt-realtime-translate` today.
- Speech already in the selected output language may produce little or no translated audio (by design).
- This app is one-way only; two-way conversation needs a second translation session in the reverse direction.
