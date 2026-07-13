import { GeminiTranslationSession } from "@/lib/gemini-translation-session";
import { TranslationSession } from "@/lib/translation-session";
import type {
  LiveTranslationSession,
  TranslationProviderId,
  TranslationSessionOptions,
} from "@/lib/translation-types";

export function createTranslationSession(
  provider: TranslationProviderId,
  options: TranslationSessionOptions,
): LiveTranslationSession {
  if (provider === "gemini") {
    return new GeminiTranslationSession(options);
  }
  return new TranslationSession(options);
}
