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

function findExampleSentence(word) {
  const wordRe = new RegExp(`\\b${escapeRegex(word.word)}\\w*\\b`, "i");
  for (const m of word.meanings || []) {
    for (const d of m.definitions || []) {
      if (d.example && wordRe.test(d.example)) return d.example;
    }
  }
  return null;
}

function blankOutWord(sentence, word) {
  const wordRe = new RegExp(`\\b${escapeRegex(word)}\\w*\\b`, "i");
  return sentence.replace(wordRe, "＿＿＿＿＿");
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
