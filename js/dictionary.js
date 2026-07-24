// Fetches and normalizes word data from the Free Dictionary API
// (https://dictionaryapi.dev). No API key required, CORS-enabled.
const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";

export class WordNotFoundError extends Error {}

export async function lookupWord(word) {
  const clean = word.trim().toLowerCase();
  if (!clean) throw new Error("請輸入單字");

  let res;
  try {
    res = await fetch(API_BASE + encodeURIComponent(clean));
  } catch {
    throw new Error("網路連線失敗，請確認網路連線後再試一次");
  }

  if (res.status === 404) {
    throw new WordNotFoundError(`找不到「${clean}」，請確認拼字是否正確`);
  }
  if (!res.ok) {
    throw new Error(`查詢失敗（HTTP ${res.status}）`);
  }

  const data = await res.json();
  return normalize(clean, data);
}

function normalize(word, entries) {
  const phonetic =
    entries.find((e) => e.phonetic)?.phonetic ||
    entries.flatMap((e) => e.phonetics || []).find((p) => p.text)?.text ||
    "";

  const audio = entries
    .flatMap((e) => e.phonetics || [])
    .find((p) => p.audio)?.audio;

  const meanings = [];
  const allSynonyms = new Set();
  const allAntonyms = new Set();

  for (const entry of entries) {
    for (const meaning of entry.meanings || []) {
      const definitions = (meaning.definitions || []).slice(0, 3).map((d) => ({
        definition: d.definition,
        example: d.example || "",
        synonyms: d.synonyms || [],
        antonyms: d.antonyms || [],
      }));

      for (const d of definitions) {
        d.synonyms.forEach((s) => allSynonyms.add(s));
        d.antonyms.forEach((a) => allAntonyms.add(a));
      }
      (meaning.synonyms || []).forEach((s) => allSynonyms.add(s));
      (meaning.antonyms || []).forEach((a) => allAntonyms.add(a));

      meanings.push({
        partOfSpeech: meaning.partOfSpeech,
        definitions,
      });
    }
  }

  return {
    word,
    phonetic,
    audio: audio || "",
    meanings,
    synonyms: [...allSynonyms].slice(0, 10),
    antonyms: [...allAntonyms].slice(0, 10),
  };
}
