// Spaced-repetition scheduling grounded in Ebbinghaus's forgetting curve:
// https://zh.wikipedia.org/zh-tw/遺忘曲線 — memory retention decays over
// time roughly as R(t) = r0^(t/S), where S ("stability", in days) is how
// long it takes retention to fall to r0 (we use r0 = TARGET_RETENTION,
// 90%). Every review reschedules the next check for exactly the day
// retention is predicted to hit that 90% floor, and a correct recall grows
// S (the word is now better consolidated, so it decays slower next time) —
// a failed recall means the real retention had already dropped below what
// the curve predicted, so S resets back down to rebuild from the steep
// early part of the curve. `interval` in a card *is* S: the number of days
// from the last review to the next scheduled one.
const TARGET_RETENTION = 0.9;

// Growth multiplier applied to stability after a successful review, scaled
// further by how confidently it was recalled (Hard/Good/Easy).
const GROWTH = { hard: 1.2, good: 2.0, easy: 3.0 };

export function newCard() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    repetition: 0,
    interval: 0,
    easeFactor: 2.5,
    dueDate: today,
    reviewHistory: [],
  };
}

// Predicted probability of recall right now, per the forgetting-curve
// formula above. 1 = just reviewed, 0.9 = exactly at the scheduled review
// date, lower if it's gone unreviewed past that. Returns null for cards
// that have never been scheduled (no interval yet).
export function retention(card, atDate = new Date()) {
  if (!card || !card.interval) return null;
  const due = new Date(card.dueDate);
  const lastReview = new Date(due);
  lastReview.setDate(lastReview.getDate() - card.interval);
  const daysSince = (atDate - lastReview) / 86400000;
  return Math.pow(TARGET_RETENTION, daysSince / card.interval);
}

// quality: 0-5 rating of recall (Again=1, Hard=3, Good=4, Easy=5)
export function review(card, quality) {
  const today = new Date();
  const next = { ...card };

  // easeFactor still tracks this word's personal difficulty (same update
  // rule as before) and now scales the stability growth below, so a word
  // that's proven easy for you keeps growing faster than the base rate.
  const personalFactor = (card.easeFactor ?? 2.5) / 2.5;

  if (quality < 3) {
    // A failed recall means real retention had already fallen below the
    // curve's prediction — rebuild from the steep early part instead of
    // continuing to grow the old (apparently wrong) stability estimate.
    next.repetition = 0;
    next.interval = 1;
  } else {
    const growth = quality === 3 ? GROWTH.hard : quality === 4 ? GROWTH.good : GROWTH.easy;
    const base = next.interval > 0 ? next.interval : 1;
    next.interval = Math.max(1, Math.round(base * growth * personalFactor));
    next.repetition += 1;
  }

  next.easeFactor = Math.max(
    1.3,
    (card.easeFactor ?? 2.5) + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  const due = new Date(today);
  due.setDate(due.getDate() + next.interval);
  next.dueDate = due.toISOString().slice(0, 10);

  next.reviewHistory = [
    ...(card.reviewHistory || []),
    { date: today.toISOString().slice(0, 10), quality },
  ];

  return next;
}

export function isDue(card) {
  if (!card) return false;
  const today = new Date().toISOString().slice(0, 10);
  return card.dueDate <= today;
}

export function daysUntilDue(card) {
  const today = new Date();
  const due = new Date(card.dueDate);
  return Math.round((due - today) / 86400000);
}

// Priority score for picking which due words fill today's capped review
// slots — higher = more urgent. Directly uses the forgetting-curve math:
// the more predicted retention has already decayed below the 90% target,
// the more urgent. Past lapses add extra weight since a word that's been
// gotten wrong before is more likely to be forgotten again.
export function priorityScore(card) {
  if (!card) return 0;
  const r = retention(card);
  const forgottenRisk = r === null ? 0 : Math.max(0, 1 - r) * 100;
  const lapses = (card.reviewHistory || []).filter((h) => h.quality < 3).length;
  return forgottenRisk + lapses * 2;
}

// Forecast how many cards become due over the next `days` days (for stats view)
export function forecast(words, days = 7) {
  const buckets = Array.from({ length: days }, () => 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const w of words) {
    if (!w.srs) continue;
    const due = new Date(w.srs.dueDate);
    due.setHours(0, 0, 0, 0);
    const diff = Math.round((due - today) / 86400000);
    if (diff >= 0 && diff < days) {
      buckets[diff] += 1;
    }
  }
  return buckets;
}
