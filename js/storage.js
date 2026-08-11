// Local-first persistence for the vocabulary list. Always reads/writes an
// in-memory cache mirrored to localStorage, so callers stay synchronous.
// cloud-sync.js observes writes via onWrite() to mirror them to Firestore,
// and pushes remote changes back in via replaceWords()/replaceStats().
const STORAGE_KEY = "vocab_words_v1";
const STATS_KEY = "vocab_stats_v1";

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

let wordsCache = readLocal(STORAGE_KEY, []);
let statsCache = readLocal(STATS_KEY, { reviewedDates: [] });

const writeListeners = [];
export function onWrite(fn) {
  writeListeners.push(fn);
  return () => {
    const i = writeListeners.indexOf(fn);
    if (i >= 0) writeListeners.splice(i, 1);
  };
}
function emit(type, payload) {
  writeListeners.forEach((fn) => fn(type, payload));
}

export function loadWords() {
  return wordsCache;
}

export function upsertWord(word, opts = {}) {
  const idx = wordsCache.findIndex(
    (w) => w.word.toLowerCase() === word.word.toLowerCase()
  );
  if (idx >= 0) {
    wordsCache[idx] = { ...wordsCache[idx], ...word };
  } else {
    wordsCache.push(word);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wordsCache));
  if (!opts.fromRemote) emit("upsertWord", wordsCache[idx >= 0 ? idx : wordsCache.length - 1]);
  return wordsCache;
}

export function deleteWord(word, opts = {}) {
  wordsCache = wordsCache.filter(
    (w) => w.word.toLowerCase() !== word.toLowerCase()
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wordsCache));
  if (!opts.fromRemote) emit("deleteWord", word);
  return wordsCache;
}

// Used by cloud-sync.js when a Firestore snapshot arrives — replaces the
// whole cache without re-emitting (that would just echo back to Firestore).
export function replaceWords(words) {
  wordsCache = words;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wordsCache));
}

export function getWord(word) {
  return wordsCache.find((w) => w.word.toLowerCase() === word.toLowerCase());
}

export function loadStats() {
  return statsCache;
}

export function replaceStats(stats) {
  statsCache = stats;
  localStorage.setItem(STATS_KEY, JSON.stringify(statsCache));
}

// Wipes the local cache — used on logout, since without this the last
// signed-in account's word list and stats just sit in localStorage and
// stay visible to whoever uses this browser next, logged in or not.
export function clearAll() {
  wordsCache = [];
  statsCache = { reviewedDates: [] };
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STATS_KEY);
}

export function recordReviewToday(opts = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const reviewedDates = statsCache.reviewedDates.includes(today)
    ? statsCache.reviewedDates
    : [...statsCache.reviewedDates, today];
  const dailyCounts = { ...(statsCache.dailyCounts || {}) };
  dailyCounts[today] = (dailyCounts[today] || 0) + 1;
  statsCache = { ...statsCache, reviewedDates, dailyCounts };
  localStorage.setItem(STATS_KEY, JSON.stringify(statsCache));
  if (!opts.fromRemote) emit("recordReviewToday", statsCache);
  return statsCache;
}

export function getStreak() {
  const dates = new Set(statsCache.reviewedDates);
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

// Current streak resets to 0 the moment a day is missed, so it can't tell a
// returning user what their all-time-best run was. Recomputed from the raw
// date list every time rather than tracked incrementally, since that stays
// correct even if reviewedDates ever gets merged/edited out of order (e.g.
// cross-device sync).
export function getBestStreak() {
  const dates = [...new Set(statsCache.reviewedDates)].sort();
  let best = 0;
  let run = 0;
  let prevTime = null;
  for (const d of dates) {
    const t = new Date(d).getTime();
    run = prevTime !== null && t - prevTime === 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
    prevTime = t;
  }
  return Math.max(best, getStreak());
}

// Single-day review-count record, e.g. "most words reviewed in one day".
export function getBestDailyReviews() {
  const counts = Object.values(statsCache.dailyCounts || {});
  return counts.length ? Math.max(...counts) : 0;
}

export function getBestCombo() {
  return statsCache.bestCombo || 0;
}

// Combo (consecutive correct answers in one session) only lives in memory
// during a review session — this just persists the high-water mark so it
// survives across sessions/devices as a record to chase.
export function recordCombo(combo, opts = {}) {
  const bestCombo = Math.max(statsCache.bestCombo || 0, combo);
  const isNewBest = bestCombo > (statsCache.bestCombo || 0);
  if (isNewBest) {
    statsCache = { ...statsCache, bestCombo };
    localStorage.setItem(STATS_KEY, JSON.stringify(statsCache));
    if (!opts.fromRemote) emit("recordCombo", statsCache);
  }
  return { isNewBest, bestCombo };
}
