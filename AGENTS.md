<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Single service: a Next.js 16 app ("AI Interpreter"). Standard commands live in `package.json` (`npm run lint`, `npm run build`, `npm run dev`); see `README.md` for a full overview.

- `npm run dev` serves **HTTPS** on `0.0.0.0:3000` using a self-signed cert. The `predev` hook auto-runs `npm run certs` (needs `openssl`, already present) and is idempotent, so certs do not need separate setup. Open `https://localhost:3000` and accept/bypass the self-signed cert warning (in Chrome, type `thisisunsafe` on the warning page).
- Copy `.env.local.example` to `.env.local` and set `OPENAI_API_KEY` (needs OpenAI Realtime Translation access). Without it the UI still loads and client-side controls work, but `POST /api/session` returns HTTP 500 and no translation can start. In this cloud VM the key is not available as a secret, so the end-to-end translate flow (which also needs a real microphone/tab audio + WebRTC) cannot be exercised headlessly.
- If the LAN IP changes, regenerate certs (`HTTPS_EXTRA_HOSTS=<ip> npm run certs`) and restart dev so `allowedDevOrigins` in `next.config.ts` picks it up (required for HMR over non-localhost origins).
