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
