// Chinese gloss via MyMemory (https://mymemory.translated.net) — free,
// no API key, CORS-enabled. This is a supplementary machine-translated
// hint, not an authoritative definition, so callers should label it as such.
const TRANSLATE_BASE = "https://api.mymemory.translated.net/get";

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
    return translated;
  } catch {
    return "";
  }
}
