// Chinese gloss via MyMemory (https://mymemory.translated.net) — free,
// no API key, CORS-enabled. This is a supplementary machine-translated
// hint, not an authoritative definition, so callers should label it as such.
import { Converter } from "https://esm.sh/opencc-js@1.0.5";

const TRANSLATE_BASE = "https://api.mymemory.translated.net/get";

// MyMemory is a crowd-sourced translation memory, not a rule-based
// converter — asking for zh-TW doesn't guarantee Traditional characters
// back, since some of its stored translations were contributed in
// Simplified Chinese. Run everything through a deterministic converter
// so the app's own output is always Traditional regardless of what
// MyMemory happens to have on file.
const toTraditional = Converter({ from: "cn", to: "tw" });

export async function translateToChinese(text) {
  const clean = text.trim();
  if (!clean) return "";

  try {
    const res = await fetch(
      `${TRANSLATE_BASE}?q=${encodeURIComponent(clean)}&langpair=en|zh-TW`
    );
    if (!res.ok) return "";
    const data = await res.json();
    const translated = data?.responseData?.translatedText?.trim() || "";
    if (!translated || translated.toLowerCase() === clean.toLowerCase()) return "";
    return toTraditional(translated);
  } catch {
    return "";
  }
}
