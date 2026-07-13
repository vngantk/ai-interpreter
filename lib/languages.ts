import type { TranslationProviderId } from "@/lib/translation-types";

export const OUTPUT_LANGUAGES = [
  {
    code: "zh",
    label: "Chinese",
    providers: ["openai", "gemini"] as const,
  },
  { code: "en", label: "English", providers: ["openai", "gemini"] as const },
  { code: "es", label: "Spanish", providers: ["openai", "gemini"] as const },
  { code: "pt", label: "Portuguese", providers: ["openai", "gemini"] as const },
  { code: "fr", label: "French", providers: ["openai", "gemini"] as const },
  { code: "ja", label: "Japanese", providers: ["openai", "gemini"] as const },
  { code: "ru", label: "Russian", providers: ["openai", "gemini"] as const },
  { code: "de", label: "German", providers: ["openai", "gemini"] as const },
  { code: "ko", label: "Korean", providers: ["openai", "gemini"] as const },
  { code: "hi", label: "Hindi", providers: ["openai", "gemini"] as const },
  { code: "id", label: "Indonesian", providers: ["openai", "gemini"] as const },
  { code: "vi", label: "Vietnamese", providers: ["openai", "gemini"] as const },
  { code: "it", label: "Italian", providers: ["openai", "gemini"] as const },
] as const;

export type OutputLanguageCode = (typeof OUTPUT_LANGUAGES)[number]["code"];

const SUPPORTED = new Set<string>(OUTPUT_LANGUAGES.map((l) => l.code));

export const DEFAULT_TARGET_LANGUAGE: OutputLanguageCode = "zh";

export function isOutputLanguageCode(
  value: string,
): value is OutputLanguageCode {
  return SUPPORTED.has(value);
}

export function languagesForProvider(provider: TranslationProviderId) {
  return OUTPUT_LANGUAGES.filter((language) =>
    (language.providers as readonly TranslationProviderId[]).includes(provider),
  );
}

export function isLanguageSupportedByProvider(
  code: OutputLanguageCode,
  provider: TranslationProviderId,
): boolean {
  const language = OUTPUT_LANGUAGES.find((item) => item.code === code);
  if (!language) return false;
  return (language.providers as readonly TranslationProviderId[]).includes(
    provider,
  );
}

export function normalizeTargetLanguage(
  targetLanguage: unknown,
): OutputLanguageCode {
  if (typeof targetLanguage !== "string" || !targetLanguage.trim()) {
    throw new Error("A target language code is required.");
  }

  const normalized = targetLanguage.trim().toLowerCase();
  if (!isOutputLanguageCode(normalized)) {
    throw new Error(
      "Use a supported target language code: es, pt, fr, ja, ru, zh, de, ko, hi, id, vi, it, or en.",
    );
  }

  return normalized;
}
