import { NextResponse } from "next/server";
import { normalizeTargetLanguage } from "@/lib/languages";

const TRANSLATION_CLIENT_SECRET_URL =
  "https://api.openai.com/v1/realtime/translations/client_secrets";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const targetLanguage =
    typeof body === "object" && body !== null && "targetLanguage" in body
      ? (body as { targetLanguage: unknown }).targetLanguage
      : undefined;

  let language: string;
  try {
    language = normalizeTargetLanguage(targetLanguage);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid target language." },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[session] OPENAI_API_KEY missing");
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  console.log("[session] minting client secret", {
    model: "gpt-realtime-translate",
    targetLanguage: language,
    inputTranscription: "gpt-realtime-whisper",
    noiseReduction: "near_field",
  });

  const startedAt = Date.now();
  const response = await fetch(TRANSLATION_CLIENT_SECRET_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "realtime-translate-local-dev",
    },
    body: JSON.stringify({
      session: {
        model: "gpt-realtime-translate",
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            noise_reduction: { type: "near_field" },
          },
          output: { language },
        },
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? JSON.stringify((payload as { error: unknown }).error)
        : `OpenAI request failed with status ${response.status}.`;
    console.error("[session] client secret failed", {
      status: response.status,
      elapsedMs,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: response.status });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { value?: unknown }).value !== "string"
  ) {
    console.error("[session] unexpected OpenAI response shape", {
      elapsedMs,
      keys:
        payload && typeof payload === "object"
          ? Object.keys(payload as object)
          : null,
    });
    return NextResponse.json(
      { error: "OpenAI did not return a client secret value." },
      { status: 502 },
    );
  }

  const expiresAt =
    (payload as { expires_at?: number | null }).expires_at ?? null;
  const sessionMeta = (payload as { session?: unknown }).session ?? null;

  console.log("[session] client secret minted", {
    targetLanguage: language,
    elapsedMs,
    expiresAt,
    secretPrefix: `${(payload as { value: string }).value.slice(0, 8)}…`,
    session: sessionMeta,
  });

  return NextResponse.json({
    client_secret: (payload as { value: string }).value,
    expires_at: expiresAt,
    targetLanguage: language,
  });
}
