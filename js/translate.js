// Chinese gloss for the looked-up word/definition. This is a supplementary
// machine-translated hint, not an authoritative definition, so callers
// should label it as such.
import { Converter } from "https://esm.sh/opencc-js@1.0.5";

// Primary source: the same free, keyless endpoint translate.google.com's
// own web page calls (client=gtx), CORS-enabled. Undocumented and
// unofficial — Google could rate-limit or change it without notice — but
// noticeably better quality than MyMemory below, especially for idioms:
// "kick the bucket" comes back as MyMemory's literal "踢水桶" (wrong) vs
// this endpoint's correct idiomatic "氣絕".
const GOOGLE_BASE = "https://translate.googleapis.com/translate_a/single";

// Fallback if the endpoint above ever breaks or gets rate-limited: MyMemory
// (https://mymemory.translated.net), an official, documented, free, no-key,
// CORS-enabled API — just weaker translation quality on average.
const MYMEMORY_BASE = "https://api.mymemory.translated.net/get";

// Neither source reliably honors "give me Traditional Chinese" — MyMemory
// is a crowd-sourced translation memory that sometimes has Simplified
// entries on file regardless of what's requested, and Google's own output
// can't be steered any harder than the tl=zh-TW param already does. Run
// everything through a deterministic converter so the app's own output is
// always Traditional no matter which source answered or what it returned.
const toTraditional = Converter({ from: "cn", to: "tw" });

async function translateViaGoogle(text) {
  const res = await fetch(
    `${GOOGLE_BASE}?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(text)}`
  );
  if (!res.ok) return "";
  const data = await res.json();
  const translated = (data?.[0] || []).map((seg) => seg[0]).join("").trim();
  if (!translated || translated.toLowerCase() === text.toLowerCase()) return "";
  return translated;
}

async function translateViaMyMemory(text) {
  const res = await fetch(
    `${MYMEMORY_BASE}?q=${encodeURIComponent(text)}&langpair=en|zh-TW`
  );
  if (!res.ok) return "";
  const data = await res.json();
  const translated = data?.responseData?.translatedText?.trim() || "";
  if (!translated || translated.toLowerCase() === text.toLowerCase()) return "";
  return translated;
}

export async function translateToChinese(text) {
  const clean = text.trim();
  if (!clean) return "";

  let translated = "";
  try {
    translated = await translateViaGoogle(clean);
  } catch {
    translated = "";
  }

  if (!translated) {
    try {
      translated = await translateViaMyMemory(clean);
    } catch {
      translated = "";
    }
  }

  return translated ? toTraditional(translated) : "";
}
