// Priority-based review scheduling: instead of a fixed per-card due date,
// every word gets a priority score each day (forgetting risk + difficulty +
// lapse history + a small under-review bonus) and the top N across the
// whole library are picked. No due date to fall behind on — a big library
// degrades gracefully by always surfacing whatever's most at risk.
//
// R_i = 2^(-t_i/S_i)                                    predicted retention
// P_i = 0.65(1-R_i) + 0.20 D_i + 0.10 L_i/(L_i+2) + 0.05 /(N_i+1)

const WEIGHTS = { forgetting: 0.65, difficulty: 0.2, lapse: 0.1, underReviewed: 0.05 };
const COOLDOWN_DAYS = { again: 1, hard: 1, good: 1, easy: 3 };
const EXPLORE_TEMPERATURE = 0.15;

export function newCard() {
  // t_i starts at 1 (not 0) for a fresh word per design: gives it a
  // moderate initial priority (R = 2^-1 = 50%) rather than either the very
  // top or bottom of the ranking on day one.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    stability: 1,
    difficulty: 0.5,
    lapses: 0,
    reviews: 0,
    lastReviewDate: yesterday.toISOString().slice(0, 10),
    lastGrade: null,
    reviewHistory: [],
  };
}

// Cards saved before this scheduling model existed (SM-2 era: repetition/
// interval/easeFactor/dueDate) get converted on read so nothing already
// synced to Firestore breaks — the old fields carry over as reasonable
// starting estimates for stability/difficulty rather than being discarded.
function normalize(card) {
  if (!card) return null;
  if (card.stability !== undefined && card.lastReviewDate !== undefined) return card;

  const history = card.reviewHistory || [];
  const lapses = history.filter((h) => h.quality < 3).length;
  const lastEntry = history[history.length - 1];
  const lastGrade = lastEntry
    ? lastEntry.quality < 3
      ? "again"
      : lastEntry.quality === 3
      ? "hard"
      : lastEntry.quality === 4
      ? "good"
      : "easy"
    : null;

  let lastReviewDate;
  if (card.dueDate && card.interval) {
    const d = new Date(card.dueDate);
    d.setDate(d.getDate() - card.interval);
    lastReviewDate = d.toISOString().slice(0, 10);
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    lastReviewDate = yesterday.toISOString().slice(0, 10);
  }

  const ease = card.easeFactor ?? 2.5;
  const difficulty = Math.max(0, Math.min(1, 0.5 - (ease - 2.5) * 0.3));

  return {
    stability: card.interval > 0 ? card.interval : 1,
    difficulty,
    lapses,
    reviews: history.length,
    lastReviewDate,
    lastGrade,
    reviewHistory: history,
  };
}

function daysSince(card, atDate) {
  const last = new Date(card.lastReviewDate);
  return Math.max(0, (atDate - last) / 86400000);
}

// Predicted probability of recall right now. 1 = just reviewed, decays
// toward 0 the longer it's been relative to this word's stability.
export function retention(card, atDate = new Date()) {
  const c = normalize(card);
  if (!c) return null;
  const t = daysSince(c, atDate);
  const s = Math.max(c.stability ?? 1, 0.1);
  return Math.pow(2, -t / s);
}

export function priorityScore(card, atDate = new Date()) {
  const c = normalize(card);
  if (!c) return 0;
  const r = retention(c, atDate) ?? 0;
  return (
    WEIGHTS.forgetting * (1 - r) +
    WEIGHTS.difficulty * c.difficulty +
    WEIGHTS.lapse * (c.lapses / (c.lapses + 2)) +
    WEIGHTS.underReviewed * (1 / (c.reviews + 1))
  );
}

// A word just graded today shouldn't be handed back out again immediately
// — Easy needs longer before it's worth re-testing than Again does.
export function cooldownActive(card, atDate = new Date()) {
  const c = normalize(card);
  if (!c || !c.lastGrade) return false;
  const minDays = COOLDOWN_DAYS[c.lastGrade] ?? 1;
  return daysSince(c, atDate) < minDays;
}

// quality: 0-5 rating of recall (Again=1, Hard=3, Good=4, Easy=5)
export function review(card, quality) {
  const grade = quality < 3 ? "again" : quality === 3 ? "hard" : quality === 4 ? "good" : "easy";
  const current = normalize(card);
  const next = { ...current };

  if (grade === "again") {
    next.stability = Math.max(0.5, 0.4 * current.stability);
    next.difficulty = Math.min(1, current.difficulty + 0.12);
    next.lapses = current.lapses + 1;
  } else if (grade === "hard") {
    next.stability = 1.2 * current.stability;
    next.difficulty = Math.min(1, current.difficulty + 0.04);
  } else if (grade === "good") {
    next.stability = 1.8 * current.stability;
    next.difficulty = Math.max(0, current.difficulty - 0.03);
  } else {
    next.stability = 2.5 * current.stability;
    next.difficulty = Math.max(0, current.difficulty - 0.08);
  }

  next.reviews = current.reviews + 1;
  next.lastGrade = grade;
  const today = new Date();
  next.lastReviewDate = today.toISOString().slice(0, 10);
  next.reviewHistory = [...current.reviewHistory, { date: next.lastReviewDate, quality }];

  return next;
}

function weightedSample(candidates, count, temperature) {
  const pool = [...candidates];
  const picked = [];
  for (let i = 0; i < count && pool.length; i++) {
    const weights = pool.map((c) => Math.exp(c.priority / temperature));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let j = 0; j < weights.length; j++) {
      r -= weights[j];
      if (r <= 0) {
        idx = j;
        break;
      }
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

// The actual "pick today's words" step: rank everything not in cooldown by
// priority, take the top (limit - exploreCount), then fill the rest with a
// priority-weighted random draw from what's left so mid-priority words
// don't get starved forever by whatever's topping the list.
// Self-rated familiarity (紅/黃/綠, set from the word card) nudges the
// score on top of the objective SRS priority — marking something "不熟"
// makes it more likely to come up for review, "熟悉" less likely, since
// the user's own sense of a word is a signal worth listening to alongside
// the forgetting-curve math.
const FAMILIARITY_ADJUSTMENT = { red: 0.15, yellow: 0, green: -0.15 };

export function selectDailyWords(words, limit = 15, exploreCount = 2) {
  const today = new Date();
  const candidates = words
    .filter((w) => w.srs && !cooldownActive(w.srs, today))
    .map((w) => ({
      word: w,
      priority:
        priorityScore(w.srs, today) +
        (FAMILIARITY_ADJUSTMENT[w.familiarity] || 0) +
        Math.random() * 0.001,
    }));

  candidates.sort((a, b) => b.priority - a.priority);

  const exploitCount = Math.max(0, limit - exploreCount);
  const top = candidates.slice(0, exploitCount);
  const rest = candidates.slice(exploitCount);
  const explored = weightedSample(rest, Math.min(exploreCount, rest.length, Math.max(0, limit - top.length)), EXPLORE_TEMPERATURE);

  return [...top, ...explored].map((c) => c.word);
}
