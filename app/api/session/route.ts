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
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

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

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? JSON.stringify((payload as { error: unknown }).error)
        : `OpenAI request failed with status ${response.status}.`;
    return NextResponse.json({ error: message }, { status: response.status });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { value?: unknown }).value !== "string"
  ) {
    return NextResponse.json(
      { error: "OpenAI did not return a client secret value." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    client_secret: (payload as { value: string }).value,
    expires_at: (payload as { expires_at?: number | null }).expires_at ?? null,
    targetLanguage: language,
  });
}
