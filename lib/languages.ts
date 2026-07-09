export const OUTPUT_LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "ja", label: "Japanese" },
  { code: "ru", label: "Russian" },
  { code: "zh", label: "Chinese" },
  { code: "de", label: "German" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "vi", label: "Vietnamese" },
  { code: "it", label: "Italian" },
  { code: "en", label: "English" },
] as const;

export type OutputLanguageCode = (typeof OUTPUT_LANGUAGES)[number]["code"];

const SUPPORTED = new Set<string>(OUTPUT_LANGUAGES.map((l) => l.code));

export const DEFAULT_TARGET_LANGUAGE: OutputLanguageCode = "es";

export function isOutputLanguageCode(value: string): value is OutputLanguageCode {
  return SUPPORTED.has(value);
}

export function normalizeTargetLanguage(targetLanguage: unknown): OutputLanguageCode {
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
