# Vocab App (單字背起來)

A personal English (GRE-level) vocabulary trainer. Look up words or phrases and get instant definitions and examples, then review on a schedule driven by a real spaced-repetition / forgetting-curve model.

**Live site:** https://heisenberg7299.github.io/english-vocab-app/

## Features

- **Word/phrase lookup** — enter an English word or phrase and get its definitions, part of speech, examples, synonyms, and antonyms, plus a Traditional Chinese translation and an auto-generated mnemonic
- **Daily review** — instead of a fixed due-date schedule, each day picks the words most worth reviewing across the whole library by a priority score (predicted retention, difficulty, past mistakes, review count); locked to once per day
- **GRE-style quizzes** — review via multiple choice (cloze/fill-in-the-blank, definition matching, synonym matching), not just "did I remember it"
- **Flashcards** — draw random cards any time, not limited to the day's review batch
- **Familiarity tags** — mark words as unfamiliar/so-so/familiar; feeds back into review priority
- **Learning history calendar** — tracks which words were added or reviewed on which day
- **Stats** — total words, review streak, average retention, familiarity breakdown, and more
- **Cloud sync** — log in and your word list syncs to Firestore, so any device signed into the same account sees the same data
- **PWA** — installable to a phone home screen or desktop as a standalone app

## The scheduling algorithm

The core of this app isn't the dictionary lookup — plenty of tools do that. It's how it decides what to review each day.

Most spaced-repetition apps (Anki, SM-2, etc.) give each card a fixed due date, and the deck just gets more overdue the longer you skip it. This app doesn't have due dates at all. Every word gets a **priority score** computed fresh each day, and the top 15 across the whole library get reviewed — so it degrades gracefully no matter how big the library gets, instead of piling up a backlog.

For each word `i`, the app tracks:

- `S_i` — memory stability (grows with successful reviews, shrinks on mistakes)
- `D_i` — difficulty, 0–1
- `t_i` — days since last review
- `L_i` — number of past lapses (wrong answers)
- `N_i` — total number of reviews

**Predicted retention** right now, from an Ebbinghaus-style exponential forgetting curve:

```
R_i = 2^(-t_i / S_i)
```

**Priority score** — how urgently it's worth reviewing, combining forgetting risk, difficulty, lapse history, and a small bonus for under-reviewed words so nothing gets starved forever:

```
P_i = 0.65·(1 - R_i) + 0.20·D_i + 0.10·(L_i / (L_i + 2)) + 0.05·(1 / (N_i + 1))
```

Each day's batch of 15 isn't purely the top 15 by score, either — it's 13 highest-priority words (exploit) plus 2 picked by weighted-random sampling over the rest (explore, softmax temperature 0.15), so mid-priority words still surface occasionally instead of being permanently crowded out by whatever's currently worst.

Grading a review (again / hard / good / easy) updates `S_i` and `D_i` — a big jump in stability on "easy", a sharp drop plus a difficulty bump on "again" — and each grade carries its own cooldown (1–3 days) before that word can be selected again, so you can't just re-answer the same word repeatedly to game the schedule.

Self-rated familiarity (unfamiliar/so-so/familiar) sits on top of this as a manual adjustment to the priority score, letting a "this one's easy for me" judgment call override the math when it disagrees.

## Tech

A plain frontend site with no build step — native browser ES modules throughout:

- `index.html` / `style.css` / `js/app.js` — page structure, styling, and main UI logic
- `js/dictionary.js` — word/phrase lookup, trying three free sources in order: [Free Dictionary API](https://dictionaryapi.dev/), [Datamuse](https://www.datamuse.com/api/), and [Wiktionary](https://en.wiktionary.org/) directly
- `js/translate.js` — Chinese translation via [MyMemory](https://mymemory.translated.net/), converted to guaranteed Traditional Chinese with [opencc-js](https://github.com/nk2028/opencc-js)
- `js/srs.js` — the spaced-repetition scheduling algorithm (a priority score built from memory stability and a forgetting-curve model)
- `js/quiz.js` — GRE-style multiple-choice question generation
- `js/mnemonic.js` — rule-based mnemonic generator (prefix/root/suffix breakdown)
- `js/storage.js` / `js/cloud-sync.js` — local cache (localStorage) and Firebase (Firestore + Authentication) cloud sync
- `sw.js` / `manifest.json` — PWA setup, with a network-first service worker

Hosted on GitHub Pages; cache-busting is handled manually via `?v=N` query strings.
