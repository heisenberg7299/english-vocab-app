// localStorage persistence for the vocabulary list
const STORAGE_KEY = "vocab_words_v1";
const STATS_KEY = "vocab_stats_v1";

export function loadWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWords(words) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

export function upsertWord(word) {
  const words = loadWords();
  const idx = words.findIndex(
    (w) => w.word.toLowerCase() === word.word.toLowerCase()
  );
  if (idx >= 0) {
    words[idx] = { ...words[idx], ...word };
  } else {
    words.push(word);
  }
  saveWords(words);
  return words;
}

export function deleteWord(word) {
  const words = loadWords().filter(
    (w) => w.word.toLowerCase() !== word.toLowerCase()
  );
  saveWords(words);
  return words;
}

export function getWord(word) {
  return loadWords().find(
    (w) => w.word.toLowerCase() === word.toLowerCase()
  );
}

export function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : { reviewedDates: [] };
  } catch {
    return { reviewedDates: [] };
  }
}

export function recordReviewToday() {
  const stats = loadStats();
  const today = new Date().toISOString().slice(0, 10);
  if (!stats.reviewedDates.includes(today)) {
    stats.reviewedDates.push(today);
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  return stats;
}

export function getStreak() {
  const stats = loadStats();
  const dates = new Set(stats.reviewedDates);
  let streak = 0;
  let cursor = new Date();
  // if today not yet reviewed, start checking from yesterday so streak doesn't
  // drop to 0 before the user has had a chance to review today
  const todayStr = cursor.toISOString().slice(0, 10);
  if (!dates.has(todayStr)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
