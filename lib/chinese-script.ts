import OpenCC from "opencc-js";

export type ChineseScript = "simplified" | "traditional";

export const DEFAULT_CHINESE_SCRIPT: ChineseScript = "traditional";

export const CHINESE_SCRIPTS: { id: ChineseScript; label: string }[] = [
  { id: "traditional", label: "Traditional (繁體)" },
  { id: "simplified", label: "Simplified (简体)" },
];

type Converter = (text: string) => string;

let toTraditional: Converter | null = null;

function getToTraditional(): Converter {
  if (!toTraditional) {
    // OpenCC cn → tw: Simplified Mainland → Traditional Taiwan phrasing/characters.
    toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });
  }
  return toTraditional;
}

/** Convert Simplified Chinese text to Traditional for display. */
export function toTraditionalChinese(text: string): string {
  if (!text) return text;
  return getToTraditional()(text);
}

export function formatChineseCaption(
  text: string,
  script: ChineseScript,
): string {
  if (!text || script === "simplified") return text;
  return toTraditionalChinese(text);
}
