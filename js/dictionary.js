// Datamuse (https://www.datamuse.com/api/) is the primary dictionary
// source: its md=d flag returns Wiktionary definitions, and its sp=
// (spelled like) param finds similarly-spelled words for a "did you mean"
// suggestion list. dictionaryapi.dev used to be tried first (it had
// phonetics/audio/synonyms Datamuse lacks) but was dropped — it's been
// answering in 20s+ or timing out outright, which made every search slow
// or stuck regardless of retry/race logic on this end.
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

// Primary dictionary source. Returns null (rather than throwing) when
// Datamuse has no exact-spelling definition, so callers can fall through
// to Wiktionary / suggestions / manual entry.
export async function lookupWordDatamuse(word) {
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

// Fallback, tried when Datamuse comes up empty: Wiktionary itself, via
// MediaWiki's API (CORS-enabled through origin=*). The response is
// rendered HTML, not structured JSON like Datamuse, so this parses it
// with DOMParser — and noticeably widens phrase/idiom coverage beyond
// Datamuse's own (older, partial) Wiktionary snapshot; confirmed "rally
// behind" only shows up through this path, not Datamuse's.
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
