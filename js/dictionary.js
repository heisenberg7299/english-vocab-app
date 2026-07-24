// Fetches and normalizes word data from the Free Dictionary API
// (https://dictionaryapi.dev). No API key required, CORS-enabled.
const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";

// Datamuse (https://www.datamuse.com/api/) is used as a fallback when a word
// isn't in the Free Dictionary API: its md=d flag returns Wiktionary
// definitions for words that API doesn't have, and its sp= (spelled like)
// param finds similarly-spelled words for a "did you mean" suggestion list.
const DATAMUSE_BASE = "https://api.datamuse.com/words";

const DATAMUSE_POS = {
  n: "noun",
  v: "verb",
  adj: "adjective",
  adv: "adverb",
};

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

// Fallback for words the Free Dictionary API doesn't have. Returns null
// (rather than throwing) when Datamuse has no exact-spelling definition
// either, so callers can fall through to suggestions / manual entry.
export async function lookupWordFallback(word) {
  const clean = word.trim().toLowerCase();
  let entries;
  try {
    const res = await fetch(
      `${DATAMUSE_BASE}?sp=${encodeURIComponent(clean)}&md=d&max=1`
    );
    if (!res.ok) return null;
    entries = await res.json();
  } catch {
    return null;
  }

  const entry = entries.find((e) => e.word.toLowerCase() === clean && e.defs?.length);
  if (!entry) return null;

  const meaningsByPos = new Map();
  for (const raw of entry.defs) {
    const [tag, ...rest] = raw.split("\t");
    const partOfSpeech = DATAMUSE_POS[tag] || tag || "";
    const definition = rest.join("\t").trim();
    if (!definition) continue;
    if (!meaningsByPos.has(partOfSpeech)) meaningsByPos.set(partOfSpeech, []);
    meaningsByPos.get(partOfSpeech).push({
      definition,
      example: "",
      synonyms: [],
      antonyms: [],
    });
  }

  if (!meaningsByPos.size) return null;

  return {
    word: clean,
    phonetic: "",
    audio: "",
    meanings: [...meaningsByPos.entries()].map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions,
    })),
    synonyms: [],
    antonyms: [],
    source: "datamuse",
  };
}

// Similarly-spelled words for a "did you mean" list when nothing matched.
export async function fetchSimilarWords(word) {
  const clean = word.trim().toLowerCase();
  try {
    const res = await fetch(
      `${DATAMUSE_BASE}?sp=${encodeURIComponent(clean)}&max=8`
    );
    if (!res.ok) return [];
    const entries = await res.json();
    return entries
      .map((e) => e.word)
      .filter((w) => w.toLowerCase() !== clean)
      .slice(0, 6);
  } catch {
    return [];
  }
}

// Builds a word record from a user-typed definition, for words no
// dictionary API has at all.
export function buildManualWordData(word, { partOfSpeech, definition, example }) {
  return {
    word: word.trim().toLowerCase(),
    phonetic: "",
    audio: "",
    meanings: [
      {
        partOfSpeech: (partOfSpeech || "").trim(),
        definitions: [
          {
            definition: definition.trim(),
            example: (example || "").trim(),
            synonyms: [],
            antonyms: [],
          },
        ],
      },
    ],
    synonyms: [],
    antonyms: [],
    source: "manual",
  };
}
