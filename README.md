# AI Interpreter

Browser web app that streams microphone or tab audio for one-way live speech translation and plays back translated speech with live captions.

Providers (toggle in the UI):

- **OpenAI** — `gpt-realtime-translate` over WebRTC
- **Gemini** — `gemini-3.5-live-translate-preview` over the Live API (WebSocket + PCM)

## Prerequisites

- Node.js 20+ (18 may work; 21+ is fine)
- An [OpenAI API key](https://platform.openai.com/api-keys) with access to Realtime Translation (for the OpenAI provider)
- A [Gemini API key](https://aistudio.google.com/apikey) with access to Live Translate (for the Gemini provider)

## Setup

```bash
cp .env.local.example .env.local
```

Add keys to `.env.local`:

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

`GOOGLE_API_KEY` is accepted as an alias for `GEMINI_API_KEY`.

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

### Share over the internet (Cloudflare Tunnel)

With `npm run dev` already running, expose the app with a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/):

```bash
cloudflared tunnel --url https://127.0.0.1:3000 --no-tls-verify --protocol http2
```

`cloudflared` prints a public `https://….trycloudflare.com` URL. `--no-tls-verify` is required because the local cert is self-signed. The URL changes each time you restart the tunnel; anyone with it can reach your local app (and use your server-side API keys), so treat it as temporary.

Install `cloudflared` from [Cloudflare’s downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) if it isn’t on your PATH yet.

Useful scripts:

| Script | Purpose |
|--------|---------|
| `npm run certs` | Regenerate TLS certs (e.g. after your LAN IP changes) |
| `npm run build && npm run start:https` | Production build over HTTPS (same `certs/` or `HTTPS_KEY` / `HTTPS_CERT`) |

## How it works

### OpenAI

1. The browser asks `POST /api/session` for a short-lived client secret.
2. The server calls OpenAI `…/realtime/translations/client_secrets` with your API key — the key never reaches the browser.
3. The browser captures mic or tab audio, opens an `RTCPeerConnection`, and posts an SDP offer to `…/realtime/translations/calls`.
4. Translated audio arrives as a remote WebRTC track; caption deltas arrive on the `oai-events` data channel.

### Gemini

1. The browser asks `POST /api/gemini/token` for a short-lived ephemeral token with translation config locked server-side.
2. The server mints the token via the Gemini `v1alpha` Auth Tokens API using `GEMINI_API_KEY`.
3. The browser opens a Live API WebSocket, streams 16 kHz PCM from the mic/tab, and plays 24 kHz PCM translated audio.
4. Input/output transcriptions arrive on the same WebSocket for captions.

Both paths are continuous speech→speech translation (not a turn-based voice agent).

## Supported output languages

Both providers auto-detect many input languages. This UI exposes the same 13 output codes (default: Chinese) for A/B comparison:

| Code | Language   | OpenAI | Gemini |
|------|------------|--------|--------|
| `zh` | Chinese    | `zh`   | `zh-Hans` / `zh-Hant` |
| `en` | English    | yes    | yes |
| `es` | Spanish    | yes    | yes |
| `pt` | Portuguese | yes    | `pt-BR` |
| `fr` | French     | yes    | yes |
| `ja` | Japanese   | yes    | yes |
| `ru` | Russian    | yes    | yes |
| `de` | German     | yes    | yes |
| `ko` | Korean     | yes    | yes |
| `hi` | Hindi      | yes    | yes |
| `id` | Indonesian | yes    | yes |
| `vi` | Vietnamese | yes    | yes |
| `it` | Italian    | yes    | yes |

Gemini Live Translate supports 70+ languages in the API; this branch keeps the shared list for parity. Cantonese is **not** in Gemini’s published Live Translate language table.

### Chinese script

- **OpenAI**: API accepts `zh` only. The UI Traditional/Simplified control converts captions in the browser with [OpenCC](https://github.com/BYVoid/OpenCC). Spoken audio is unchanged.
- **Gemini**: Traditional/Simplified selects `zh-Hant` vs `zh-Hans` for spoken output (and captions). Changing script requires a new session.

Traditional is the default.

## Usage tips

- Pick **OpenAI** or **Gemini** before starting; switch requires stop/start.
- **Microphone / Virtual input**: choose any audio input device the browser exposes, including virtual mics such as BlackHole or Loopback.
- **Browser tab**: share a tab with audio enabled. Prefer Chrome.
- **Translated captions** and **Source transcript** each have an independent **Audio** toggle and volume slider.
- Panels can be collapsed; caption panels can pop out (Document PiP when available).
- Changing the target language requires stopping and starting a new session.

## Cost

- **OpenAI** Realtime Translation is billed by **audio duration** (~$0.034/min). See the [model page](https://developers.openai.com/api/docs/models/gpt-realtime-translate).
- **Gemini** Live Translate is billed by **audio tokens** (~$0.0368/min effective when input+output stream continuously). See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

Keep sessions short while developing.

## Project layout

- `app/api/session/route.ts` — OpenAI client secrets
- `app/api/gemini/token/route.ts` — Gemini ephemeral tokens
- `lib/create-translation-session.ts` — provider factory
- `lib/translation-session.ts` — OpenAI WebRTC session
- `lib/gemini-translation-session.ts` — Gemini Live WebSocket session
- `lib/languages.ts` — shared output language codes
- `lib/gemini-languages.ts` — BCP-47 mapping for Gemini
- `components/TranslatorApp.tsx` — UI
- `scripts/generate-dev-certs.mjs` — local/LAN HTTPS cert generation
- `server-https.mjs` — production HTTPS server

## Notes

- Custom prompts, glossaries, and fixed voice selection are limited by each provider’s Live Translate surface.
- Speech already in the selected output language may produce little or no translated audio (OpenAI) or may be echoed when `echoTargetLanguage` is enabled (Gemini).
- This app is one-way only; two-way conversation needs a second translation session in the reverse direction.
- Gemini Live Translate is a preview model; behavior and pricing can change.
