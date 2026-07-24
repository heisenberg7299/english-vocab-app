// Spaced-repetition scheduling using the SM-2 algorithm (the method behind
// Anki), so words resurface on a schedule that matches the forgetting curve:
// 1 day -> 6 days -> then growing intervals scaled by an ease factor.

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

// quality: 0-5 rating of recall (Again=1, Hard=3, Good=4, Easy=5)
export function review(card, quality) {
  const today = new Date();
  const next = { ...card };

  if (quality < 3) {
    next.repetition = 0;
    next.interval = 1;
  } else {
    if (next.repetition === 0) {
      next.interval = 1;
    } else if (next.repetition === 1) {
      next.interval = 6;
    } else {
      next.interval = Math.round(next.interval * next.easeFactor);
    }
    next.repetition += 1;
  }

  next.easeFactor = Math.max(
    1.3,
    next.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
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
