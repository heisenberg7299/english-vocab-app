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

// Dictionary sources only store phrases/idioms in their base (lemma) form
// — "beat around the bush", never "beating around the bush" — so an exact
// -match lookup on a conjugated phrase fails even though the idiom itself
// is well-documented. This covers the common regular -ing/-ed/-s endings
// with de-doubling ("running" -> "run") and silent-e reinsertion
// ("making" -> "make") heuristics. Irregular verbs (bite -> bit, break ->
// broke) aren't recoverable this way and still need manual entry.
function deinflectCandidates(word) {
  const w = word.toLowerCase();
  const candidates = new Set();

  if (w.endsWith("ing") && w.length > 4) {
    const stem = w.slice(0, -3);
    candidates.add(stem);
    if (/([^aeiou])\1$/.test(stem)) candidates.add(stem.slice(0, -1));
    candidates.add(stem + "e");
  }
  if (w.endsWith("ed") && w.length > 3) {
    const stem = w.slice(0, -2);
    candidates.add(stem);
    candidates.add(stem + "e");
    if (/([^aeiou])\1$/.test(stem)) candidates.add(stem.slice(0, -1));
  }
  if (w.endsWith("es") && w.length > 3) candidates.add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 2) candidates.add(w.slice(0, -1));

  return [...candidates];
}

// Only the phrase's first word gets de-inflected (that's where idioms
// actually conjugate — "kicked the bucket", "beating around the bush");
// the rest of the phrase is kept as typed. Single words return no
// candidates, since those already go through the normal exact-match path.
export function phraseDeinflectionAttempts(phrase) {
  const tokens = phrase.trim().split(/\s+/);
  if (tokens.length < 2) return [];
  const [first, ...rest] = tokens;
  return deinflectCandidates(first).map((c) => [c, ...rest].join(" "));
}

// dictionaryapi.dev's free tier is flaky rather than actually down — spot
// checks show ~1/3 of requests coming back 500/502 at times, but retrying
// the exact same word moments later frequently succeeds. It's the only
// source with phonetics, pronunciation audio, and synonyms/antonyms, so a
// couple of quick retries on a 5xx is worth it before conceding the lookup
// to the fallback chain (which loses that data even though it usually has
// the definition itself).
async function fetchWithRetry(url, retries = 2, delayMs = 400) {
  let res;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      res = await fetch(url);
    } catch {
      throw new Error("網路連線失敗，請確認網路連線後再試一次");
    }
    if (res.status < 500 || attempt === retries) return res;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return res;
}

export async function lookupWord(word) {
  const clean = word.trim().toLowerCase();
  if (!clean) throw new Error("請輸入單字");

  const res = await fetchWithRetry(API_BASE + encodeURIComponent(clean));

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

// Third fallback, tried after both the primary dictionary and Datamuse
// come up empty: Wiktionary itself, via MediaWiki's API (CORS-enabled
// through origin=*). The response is rendered HTML, not structured JSON
// like the other two sources, so this parses it with DOMParser — and
// noticeably widens phrase/idiom coverage beyond Datamuse's own (older,
// partial) Wiktionary snapshot; confirmed "rally behind" only shows up
// through this path, not the other two.
const WIKTIONARY_BASE = "https://en.wiktionary.org/w/api.php";
const WIKTIONARY_POS = new Set([
  "noun", "verb", "adjective", "adverb", "pronoun", "preposition",
  "conjunction", "interjection", "phrase", "idiom", "proverb",
  "prepositional phrase", "determiner", "numeral", "particle",
]);

export async function lookupWordWiktionary(word) {
  const clean = word.trim().toLowerCase();
  let page;
  try {
    const res = await fetch(
      `${WIKTIONARY_BASE}?action=query&titles=${encodeURIComponent(clean)}&prop=extracts&format=json&origin=*`
    );
    if (!res.ok) return null;
    const data = await res.json();
    page = Object.values(data.query.pages || {})[0];
  } catch {
    return null;
  }
  if (!page || page.missing !== undefined || !page.extract) return null;

  const doc = new DOMParser().parseFromString(page.extract, "text/html");
  const englishH2 = [...doc.querySelectorAll("h2")].find(
    (h) => h.textContent.trim() === "English"
  );
  if (!englishH2) return null;

  const meanings = [];
  let node = englishH2.nextElementSibling;
  while (node && node.tagName !== "H2") {
    if (node.tagName === "H3" && WIKTIONARY_POS.has(node.textContent.trim().toLowerCase())) {
      const partOfSpeech = node.textContent.trim().toLowerCase();
      // walk forward to the definitions <ol> (headword line sits in
      // between), stopping early if another heading turns up first
      let sib = node.nextElementSibling;
      let ol = null;
      while (sib && sib.tagName !== "H2" && sib.tagName !== "H3") {
        if (sib.tagName === "OL") { ol = sib; break; }
        sib = sib.nextElementSibling;
      }
      if (ol) {
        const definitions = [];
        for (const li of ol.children) {
          if (li.tagName !== "LI") continue;
          const clone = li.cloneNode(true);
          // strip nested synonym notes (<dl>) and quotation blocks (<ul>)
          // so the definition text itself doesn't get diluted
          clone.querySelectorAll("dl, ul").forEach((el) => el.remove());
          const text = clone.textContent.replace(/\s+/g, " ").trim();
          if (text) definitions.push({ definition: text, example: "", synonyms: [], antonyms: [] });
          if (definitions.length >= 3) break;
        }
        if (definitions.length) meanings.push({ partOfSpeech, definitions });
      }
    }
    node = node.nextElementSibling;
  }

  if (!meanings.length) return null;

  return {
    word: clean,
    phonetic: "",
    audio: "",
    meanings,
    synonyms: [],
    antonyms: [],
    source: "wiktionary",
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

// Meaning-related words (synonyms/close concepts) via Datamuse's ml=
// ("means like") param — used to suggest new words worth learning, seeded
// from words already in the user's own list.
export async function fetchRelatedWords(word) {
  const clean = word.trim().toLowerCase();
  try {
    const res = await fetch(`${DATAMUSE_BASE}?ml=${encodeURIComponent(clean)}&max=15`);
    if (!res.ok) return [];
    const entries = await res.json();
    return entries.map((e) => e.word).filter((w) => w.toLowerCase() !== clean);
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
