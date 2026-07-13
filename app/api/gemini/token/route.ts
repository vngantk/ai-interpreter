import { GoogleGenAI, Modality } from "@google/genai";
import { NextResponse } from "next/server";
import { DEFAULT_CHINESE_SCRIPT, type ChineseScript } from "@/lib/chinese-script";
import {
  GEMINI_LIVE_TRANSLATE_MODEL,
  toGeminiTargetLanguageCode,
} from "@/lib/gemini-languages";
import { normalizeTargetLanguage } from "@/lib/languages";

type TokenResponse = {
  token: string;
  targetLanguageCode: string;
  model: string;
  expires_at: string | null;
  error?: string;
};

/**
 * Mint a short-lived Gemini ephemeral token so the browser never sees the
 * long-lived API key. Translation config is locked server-side.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const payload =
    typeof body === "object" && body !== null
      ? (body as { targetLanguage?: unknown; chineseScript?: unknown })
      : {};

  let language: ReturnType<typeof normalizeTargetLanguage>;
  try {
    language = normalizeTargetLanguage(payload.targetLanguage);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid target language.",
      },
      { status: 400 },
    );
  }

  const chineseScript = normalizeChineseScript(payload.chineseScript);
  const targetLanguageCode = toGeminiTargetLanguageCode(
    language,
    chineseScript,
  );

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("[gemini/token] GEMINI_API_KEY missing");
    return NextResponse.json(
      {
        error:
          "GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured on the server.",
      },
      { status: 500 },
    );
  }

  console.log("[gemini/token] minting ephemeral token", {
    model: GEMINI_LIVE_TRANSLATE_MODEL,
    targetLanguage: language,
    targetLanguageCode,
  });

  const startedAt = Date.now();
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(
    Date.now() + 2 * 60 * 1000,
  ).toISOString();

  try {
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: GEMINI_LIVE_TRANSLATE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            translationConfig: {
              targetLanguageCode,
              echoTargetLanguage: true,
            },
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    const elapsedMs = Date.now() - startedAt;
    const tokenName = token.name;
    if (!tokenName) {
      console.error("[gemini/token] response missing name", { elapsedMs });
      return NextResponse.json(
        { error: "Gemini did not return an ephemeral token name." },
        { status: 502 },
      );
    }

    console.log("[gemini/token] minted", {
      targetLanguageCode,
      elapsedMs,
      expiresAt: expireTime,
      tokenPrefix: `${tokenName.slice(0, 12)}…`,
    });

    const responseBody: TokenResponse = {
      token: tokenName,
      targetLanguageCode,
      model: GEMINI_LIVE_TRANSLATE_MODEL,
      expires_at: expireTime,
    };
    return NextResponse.json(responseBody);
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message =
      error instanceof Error ? error.message : "Failed to mint Gemini token.";
    console.error("[gemini/token] failed", { elapsedMs, error: message });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function normalizeChineseScript(value: unknown): ChineseScript {
  if (value === "simplified" || value === "traditional") {
    return value;
  }
  return DEFAULT_CHINESE_SCRIPT;
}
