import type { ChineseScript } from "@/lib/chinese-script";
import type { OutputLanguageCode } from "@/lib/languages";

/**
 * Map app language codes to Gemini Live Translate BCP-47 target codes.
 * Chinese uses script variants; Portuguese defaults to Brazilian.
 */
export function toGeminiTargetLanguageCode(
  code: OutputLanguageCode,
  chineseScript: ChineseScript = "traditional",
): string {
  switch (code) {
    case "zh":
      return chineseScript === "simplified" ? "zh-Hans" : "zh-Hant";
    case "pt":
      return "pt-BR";
    default:
      return code;
  }
}

export const GEMINI_LIVE_TRANSLATE_MODEL =
  "gemini-3.5-live-translate-preview";
