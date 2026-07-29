// GRE-style multiple-choice review questions (Text Completion / definition /
// synonym), used instead of plain self-graded recall. Needs at least 4 saved
// words so there's a pool to draw plausible wrong answers from — callers
// should fall back to plain flashcard review below that threshold.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstDefinition(word) {
  for (const m of word.meanings || []) {
    for (const d of m.definitions || []) {
      if (d.definition) return d.definition;
    }
  }
  return "";
}

// Builds a regex matching `word` in a sentence, allowing for inflection.
// For a single word this just permits a trailing suffix (avoid -> avoids).
// For a phrase, only the first token gets that treatment (kick the bucket
// -> kicked/kicking the bucket) since that's where idioms actually inflect
// — the rest of the phrase has to match literally, joined by \s+ so any
// whitespace variation in the source sentence still lines up.
function buildWordRegex(word) {
  const tokens = word.trim().split(/\s+/).map(escapeRegex);
  const pattern = tokens.map((t, i) => (i === 0 ? `${t}\\w*` : t)).join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i");
}

function findExampleSentence(word) {
  const wordRe = buildWordRegex(word.word);
  for (const m of word.meanings || []) {
    for (const d of m.definitions || []) {
      if (d.example && wordRe.test(d.example)) return d.example;
    }
  }
  return null;
}

function blankOutWord(sentence, word) {
  return sentence.replace(buildWordRegex(word), "＿＿＿＿＿");
}

function pickDistractorWords(word, allWords, count) {
  const pool = allWords
    .map((w) => w.word)
    .filter((w) => w.toLowerCase() !== word.word.toLowerCase());
  return shuffle(pool).slice(0, count);
}

function pickDistractorDefinitions(word, allWords, count) {
  const pool = allWords
    .filter((w) => w.word.toLowerCase() !== word.word.toLowerCase())
    .map((w) => firstDefinition(w))
    .filter(Boolean);
  return shuffle(pool).slice(0, count);
}

export function isQuizReady(allWords) {
  return allWords.length >= 4;
}

export function buildQuestion(word, allWords) {
  const example = findExampleSentence(word);
  const hasDefinition = !!firstDefinition(word);
  const hasSynonym = (word.synonyms || []).length > 0;

  const types = [];
  if (example) types.push("cloze");
  if (hasDefinition) types.push("definition");
  if (hasSynonym) types.push("synonym");
  const type = types[Math.floor(Math.random() * types.length)] || "definition";

  if (type === "cloze") {
    const distractors = pickDistractorWords(word, allWords, 3);
    return {
      type,
      prompt: "根據句意，選出最適合填入空格的單字：",
      sentence: blankOutWord(example, word.word),
      fullSentence: example,
      options: shuffle([word.word, ...distractors]),
      correctAnswer: word.word,
    };
  }

  if (type === "synonym") {
    const correct = word.synonyms[Math.floor(Math.random() * word.synonyms.length)];
    const distractors = pickDistractorWords(word, allWords, 3);
    return {
      type,
      prompt: `「${word.word}」的同義字是？`,
      options: shuffle([correct, ...distractors]),
      correctAnswer: correct,
    };
  }

  const correct = firstDefinition(word);
  const distractors = pickDistractorDefinitions(word, allWords, 3);
  return {
    type: "definition",
    prompt: `「${word.word}」的意思是？`,
    options: shuffle([correct, ...distractors]),
    correctAnswer: correct,
  };
}
