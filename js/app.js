import {
  lookupWord,
  lookupWordFallback,
  fetchSimilarWords,
  buildManualWordData,
  WordNotFoundError,
} from "./dictionary.js?v=13";
import { generateMnemonic } from "./mnemonic.js?v=13";
import { translateToChinese } from "./translate.js?v=13";
import * as store from "./storage.js?v=13";
import * as srs from "./srs.js?v=13";
import * as quiz from "./quiz.js?v=13";
import * as cloud from "./cloud-sync.js?v=13";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------- Tabs ----------
let activeTab = "search";

function initTabs() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  activeTab = name;
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "list") renderWordList();
  if (name === "review") renderReview();
  if (name === "flashcards") renderFlashcards();
  if (name === "stats") renderStats();
}

// Re-renders whichever tab is currently visible — used when data changes
// underneath the UI (a Firestore snapshot arriving from another device, or
// just the echo of a write this same tab made). Deliberately excludes
// review/flashcards: both hold local, in-progress state (the current
// question, its answered/flipped status) that a snapshot firing mid-answer
// would otherwise wipe out — every graded review writes to Firestore, and
// that write's own echo was resetting the review tab back to word #1 before
// the user could even see whether they got it right. Switching into those
// tabs already re-syncs via buildReviewQueue()/renderFlashcards().
function refreshCurrentTab() {
  if (activeTab === "list") renderWordList();
  if (activeTab === "stats") renderStats();
  // Self-heal from the "tab opened before Firestore's initial sync landed"
  // race — but only when there's nothing in progress yet, so this can't
  // clobber an active question/flipped card like the bug above did.
  if (activeTab === "review" && reviewQueue.length === 0) renderReview();
  if (activeTab === "flashcards" && (flashcardHistoryPos < 0 || !store.getWord(flashcardHistory[flashcardHistoryPos]))) renderFlashcards();
  updateDueBadge();
}

// ---------- Rendering helpers ----------
function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const FAMILIARITY_LEVELS = [
  ["red", "不熟"],
  ["yellow", "普通"],
  ["green", "熟悉"],
];

function renderWordCard(data, opts = {}) {
  const { saved = false, showAddButton = true, showFamiliarity = true } = opts;

  const meaningsHtml = data.meanings
    .map(
      (m) => `
      <div class="pos-block">
        <span class="pos-label">詞性：${escapeHtml(m.partOfSpeech || "不明")}</span>
        ${m.definitions
          .map(
            (d) => `
            <div class="def-item">
              <span class="def-label">解釋</span> ${escapeHtml(d.definition)}
              ${d.example ? `<div class="def-example"><span class="def-label">例句</span> "${escapeHtml(d.example)}"</div>` : ""}
            </div>`
          )
          .join("")}
      </div>`
    )
    .join("");

  const synHtml = data.synonyms.length
    ? `<div class="tag-row"><span class="label">同義字</span>${data.synonyms
        .map((s) => `<span class="tag syn">${escapeHtml(s)}</span>`)
        .join("")}</div>`
    : "";
  const antHtml = data.antonyms.length
    ? `<div class="tag-row"><span class="label">反義字</span>${data.antonyms
        .map((a) => `<span class="tag ant">${escapeHtml(a)}</span>`)
        .join("")}</div>`
    : "";

  const mnemonic = data.mnemonic || generateMnemonic(
    data.word,
    data.meanings[0]?.definitions[0]?.definition || ""
  );

  const sourceLabel =
    data.source === "datamuse"
      ? `<span class="source-badge">來源：備援字典（Wiktionary）</span>`
      : data.source === "manual"
      ? `<span class="source-badge">來源：自行輸入</span>`
      : "";

  const chineseHtml = data.chineseMeaning
    ? `<div class="chinese-meaning"><span class="def-label">中文意思</span> ${escapeHtml(data.chineseMeaning)}<span class="mt-note">（機器翻譯，僅供參考）</span></div>`
    : saved
    ? `<button class="translate-btn" data-action="translate" data-word="${escapeHtml(data.word)}">🈶 翻譯成中文</button>`
    : "";

  const familiarityHtml =
    saved && showFamiliarity
      ? `<div class="familiarity-row">
           <span class="label">熟悉度</span>
           ${FAMILIARITY_LEVELS.map(
             ([level, label]) =>
               `<button class="fam-btn fam-${level} ${data.familiarity === level ? "active" : ""}" data-action="set-familiarity" data-word="${escapeHtml(data.word)}" data-level="${level}">${label}</button>`
           ).join("")}
         </div>`
      : "";

  const actionsHtml = showAddButton
    ? saved
      ? `<div class="actions">
           <button class="danger" data-action="remove" data-word="${escapeHtml(data.word)}">從單字本移除</button>
         </div>`
      : `<div class="actions">
           <button class="primary" data-action="add" data-word="${escapeHtml(data.word)}">＋ 加入單字本</button>
         </div>`
    : "";

  return `
    <div class="card" data-word-card="${escapeHtml(data.word)}">
      <div class="word-head">
        <h2>${escapeHtml(data.word)}</h2>
        ${data.phonetic ? `<span class="phonetic">${escapeHtml(data.phonetic)}</span>` : ""}
        ${data.audio ? `<button class="audio-btn" data-action="play-audio" data-src="${escapeHtml(data.audio)}">🔊</button>` : ""}
        ${sourceLabel}
      </div>
      ${chineseHtml}
      ${meaningsHtml}
      ${synHtml}
      ${antHtml}
      <div class="mnemonic-box">
        <span class="label">💡 好背誦的方法</span>${escapeHtml(mnemonic)}
      </div>
      ${familiarityHtml}
      ${actionsHtml}
    </div>`;
}

// ---------- Search tab ----------
let lastSearchResult = null;

function initSearch() {
  const form = $("#search-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#search-input");
    const word = input.value.trim();
    if (!word) return;
    await doSearch(word);
  });
}

// Best-effort Chinese gloss; silently omitted if the translation API has
// nothing (attachChineseMeaning never throws, see translateToChinese).
async function attachChineseMeaning(data) {
  const chineseMeaning = await translateToChinese(data.word);
  return chineseMeaning ? { ...data, chineseMeaning } : data;
}

async function doSearch(word) {
  const status = $("#search-status");
  const result = $("#search-result");
  status.textContent = "查詢中...";
  status.classList.remove("error");
  result.innerHTML = "";

  try {
    const data = await attachChineseMeaning(await lookupWord(word));
    lastSearchResult = data;
    status.textContent = "";
    renderSearchResult(data);
  } catch (err) {
    if (err instanceof WordNotFoundError) {
      await handleWordNotFound(word);
    } else {
      lastSearchResult = null;
      status.textContent = err.message || "查詢時發生錯誤";
      status.classList.add("error");
    }
  }
}

function renderSearchResult(data) {
  const saved = !!store.getWord(data.word);
  $("#search-result").innerHTML = renderWordCard(data, { saved });
}

// Primary dictionary has nothing: try the Datamuse fallback definition, and
// if that's empty too, offer spelling suggestions plus a manual-entry form.
async function handleWordNotFound(word) {
  const status = $("#search-status");
  status.textContent = "主要字典查無此字，嘗試備援來源...";

  const fallback = await lookupWordFallback(word);
  if (fallback) {
    const withZh = await attachChineseMeaning(fallback);
    lastSearchResult = withZh;
    status.textContent = "";
    renderSearchResult(withZh);
    return;
  }

  const clean = word.trim().toLowerCase();
  lastSearchResult = null;
  status.textContent = `找不到「${clean}」`;
  status.classList.add("error");

  const suggestions = await fetchSimilarWords(clean);
  $("#search-result").innerHTML = renderNotFoundPanel(clean, suggestions);
}

function renderNotFoundPanel(word, suggestions) {
  const suggestionsHtml = suggestions.length
    ? `<div class="suggestion-row">
         <span class="label">你是不是要找：</span>
         ${suggestions
           .map(
             (s) =>
               `<button class="suggestion-chip" data-action="search-word" data-word="${escapeHtml(s)}">${escapeHtml(s)}</button>`
           )
           .join("")}
       </div>`
    : "";

  return `
    <div class="card notfound-card">
      <p>兩個字典來源都查不到「${escapeHtml(word)}」。</p>
      ${suggestionsHtml}
      <button class="manual-toggle-btn" data-action="manual-entry" data-word="${escapeHtml(word)}">✍️ 自行輸入意思</button>
      <div id="manual-entry-area"></div>
    </div>`;
}

function renderManualEntryForm(word) {
  const area = $("#manual-entry-area");
  if (!area) return;
  area.innerHTML = `
    <div class="manual-form">
      <label>詞性（選填）<input id="manual-pos" type="text" placeholder="例如 adj. / n. / v." /></label>
      <label>意思 / 定義<textarea id="manual-def" rows="2" placeholder="用中文或英文寫下這個字的意思"></textarea></label>
      <label>例句（選填）<textarea id="manual-example" rows="2" placeholder="例句，選填"></textarea></label>
      <div class="manual-form-actions">
        <button class="primary" data-action="save-manual" data-word="${escapeHtml(word)}">加入單字本</button>
      </div>
      <div id="manual-form-status" class="status"></div>
    </div>`;
}

async function saveManualWord(word) {
  const def = $("#manual-def").value.trim();
  const statusEl = $("#manual-form-status");
  if (!def) {
    statusEl.textContent = "請先輸入意思才能加入";
    statusEl.classList.add("error");
    return;
  }

  const data = await attachChineseMeaning(
    buildManualWordData(word, {
      partOfSpeech: $("#manual-pos").value,
      definition: def,
      example: $("#manual-example").value,
    })
  );
  const fullData = saveWordRecord(data);

  updateDueBadge();
  lastSearchResult = fullData;
  $("#search-status").textContent = "";
  $("#search-status").classList.remove("error");
  renderSearchResult(fullData);
}

// Jump straight to the manual-entry form for a word that failed bulk import
function jumpToManualEntry(word) {
  switchTab("search");
  $("#search-input").value = word;
  $("#search-status").textContent = `找不到「${word}」`;
  $("#search-status").classList.add("error");
  $("#search-result").innerHTML = renderNotFoundPanel(word, []);
  renderManualEntryForm(word);
}

// Saves a normalized word record (from the API, the Datamuse fallback, or
// manual entry) with a fresh mnemonic and SRS card.
function saveWordRecord(data) {
  const mnemonic = data.mnemonic || generateMnemonic(
    data.word,
    data.meanings[0]?.definitions[0]?.definition || ""
  );
  const full = {
    ...data,
    mnemonic,
    addedDate: new Date().toISOString().slice(0, 10),
    srs: srs.newCard(),
  };
  store.upsertWord(full);
  return full;
}

function addWordToList(wordKey) {
  const data = lastSearchResult && lastSearchResult.word === wordKey.toLowerCase()
    ? lastSearchResult
    : null;
  if (!data) return;

  saveWordRecord(data);
  updateDueBadge();
  // refresh whichever card is currently displayed
  doSearch(data.word);
}

// ---------- Word list tab ----------
function renderWordList() {
  const grid = $("#word-list");
  const emptyHint = $("#list-empty");
  const filterVal = ($("#list-filter").value || "").toLowerCase();

  const words = store.loadWords()
    .filter((w) => w.word.toLowerCase().includes(filterVal))
    .sort((a, b) => a.word.localeCompare(b.word));

  emptyHint.classList.toggle("hidden", store.loadWords().length > 0);

  grid.innerHTML = words
    .map((w) => {
      const retentionPct = w.srs ? Math.round(Math.max(0, Math.min(1, srs.retention(w.srs))) * 100) : null;
      const lowRetention = retentionPct !== null && retentionPct < 90;
      const famClass = w.familiarity ? `fam-${w.familiarity}` : "";
      const dotsHtml = FAMILIARITY_LEVELS.map(
        ([level, label]) =>
          `<button class="fam-dot fam-${level} ${w.familiarity === level ? "active" : ""}" title="${label}" data-action="set-familiarity" data-word="${escapeHtml(w.word)}" data-level="${level}"></button>`
      ).join("");
      return `
        <div class="word-chip ${famClass}" data-action="view" data-word="${escapeHtml(w.word)}">
          <div class="fam-dots">${dotsHtml}</div>
          <h3>${escapeHtml(w.word)}</h3>
          ${w.chineseMeaning ? `<div class="chip-zh">${escapeHtml(w.chineseMeaning)}</div>` : ""}
          <div class="meta ${lowRetention ? "due-today" : ""}">記憶保留率 ${retentionPct ?? "—"}% · 已複習 ${w.srs?.reviews || 0} 次</div>
        </div>`;
    })
    .join("");
}

// Backfills a Chinese gloss for a word already saved before this feature
// existed (or whose translation lookup failed the first time).
async function translateWord(word) {
  const data = store.getWord(word);
  if (!data) return;

  const chineseMeaning = await translateToChinese(data.word);
  if (!chineseMeaning) return;

  const updated = { ...data, chineseMeaning };
  store.upsertWord(updated);

  if (lastSearchResult?.word === updated.word) lastSearchResult = updated;
  const shownCard = $("#search-result [data-word-card]");
  if (shownCard && shownCard.dataset.wordCard.toLowerCase() === updated.word) {
    renderSearchResult(updated);
  }
}

// Self-rated familiarity (不熟/普通/熟悉), separate from the SRS ease
// factor — shown as a colored highlight on the word's card in 我的單字本.
function setFamiliarity(word, level) {
  const data = store.getWord(word);
  if (!data) return;

  const updated = { ...data, familiarity: level };
  store.upsertWord(updated);
  if (lastSearchResult?.word === updated.word) lastSearchResult = updated;

  const searchCard = $("#search-result [data-word-card]");
  if (searchCard && searchCard.dataset.wordCard.toLowerCase() === word) {
    renderSearchResult(updated);
  }
  const flashCard = $("#flashcard-answer [data-word-card]");
  if (flashCard && flashCard.dataset.wordCard.toLowerCase() === word) {
    flipCurrentFlashcard();
  }
  if (activeTab === "list") renderWordList();
}

// Backfills Chinese glosses for every saved word that doesn't have one yet
// (words added before this feature existed, or whose translation failed).
async function backfillChineseTranslations() {
  const btn = $("#backfill-zh-btn");
  const status = $("#backfill-status");
  const targets = store.loadWords().filter((w) => !w.chineseMeaning);

  if (!targets.length) {
    status.textContent = "所有單字都已經有中文了";
    status.classList.remove("error");
    return;
  }

  btn.disabled = true;
  let done = 0;
  let filled = 0;

  for (const w of targets) {
    status.textContent = `補上中文中... ${done + 1} / ${targets.length}`;
    const chineseMeaning = await translateToChinese(w.word);
    if (chineseMeaning) {
      store.upsertWord({ ...w, chineseMeaning });
      filled += 1;
    }
    done += 1;
    if (done < targets.length) await new Promise((r) => setTimeout(r, 200));
  }

  btn.disabled = false;
  status.textContent = `完成，${filled} / ${targets.length} 個單字補上了中文`;
  renderWordList();
}

function viewWordDetail(word) {
  const data = store.getWord(word);
  if (!data) return;
  switchTab("search");
  lastSearchResult = data;
  $("#search-input").value = data.word;
  $("#search-status").textContent = "";
  $("#search-result").innerHTML = renderWordCard(data, { saved: true });
}

// ---------- Bulk import ----------
function initImport() {
  $("#import-toggle-btn").addEventListener("click", () => {
    $("#import-panel").classList.toggle("hidden");
  });
  $("#import-start-btn").addEventListener("click", runBulkImport);
  $("#backfill-zh-btn").addEventListener("click", backfillChineseTranslations);
}

function parseImportInput(raw) {
  const seen = new Set();
  const words = [];
  for (const piece of raw.split(/[,，、\n]+/)) {
    const w = piece.trim().toLowerCase();
    if (!w || seen.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return words;
}

async function runBulkImport() {
  const textarea = $("#import-textarea");
  const words = parseImportInput(textarea.value);
  const startBtn = $("#import-start-btn");
  const progress = $("#import-progress");
  const resultBox = $("#import-result");

  if (!words.length) {
    resultBox.innerHTML = `<span class="import-fail">請先貼上至少一個單字</span>`;
    return;
  }

  startBtn.disabled = true;
  resultBox.innerHTML = "";
  const added = [];
  const skipped = [];
  const failed = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    progress.textContent = `匯入中... ${i + 1} / ${words.length}`;

    if (store.getWord(word)) {
      skipped.push(word);
    } else {
      try {
        const data = await attachChineseMeaning(await lookupWord(word));
        saveWordRecord(data);
        added.push(data.word);
      } catch {
        // primary dictionary doesn't have it — try the fallback before giving up
        const fallback = await lookupWordFallback(word);
        if (fallback) {
          saveWordRecord(await attachChineseMeaning(fallback));
          added.push(fallback.word);
        } else {
          failed.push(word);
        }
      }
    }

    // be polite to the free public APIs
    if (i < words.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  progress.textContent = "";
  startBtn.disabled = false;
  textarea.value = "";
  resultBox.innerHTML = `
    ${added.length ? `<div class="import-ok">✅ 已加入 ${added.length} 個：${escapeHtml(added.join(", "))}</div>` : ""}
    ${skipped.length ? `<div>⏭️ 已存在，略過 ${skipped.length} 個：${escapeHtml(skipped.join(", "))}</div>` : ""}
    ${
      failed.length
        ? `<div class="import-fail">❌ 兩個字典來源都查不到 ${failed.length} 個：
            ${failed
              .map(
                (w) =>
                  `<button class="suggestion-chip" data-action="manual-entry-jump" data-word="${escapeHtml(w)}">${escapeHtml(w)} ✍️</button>`
              )
              .join(" ")}
            <br />點單字可跳到查單字頁面自行輸入意思</div>`
        : ""
    }`;

  updateDueBadge();
  renderWordList();
}

// ---------- Review tab ----------
const DAILY_REVIEW_LIMIT = 15;
// Bump this key's suffix whenever the selection algorithm changes underneath
// it — otherwise a session pinned under the old logic keeps being reused
// (same date = same day) instead of being recomputed with the new one.
const REVIEW_SESSION_KEY = "review_session_v3";

let reviewQueue = [];
let reviewIndex = 0;
let currentQuestion = null;
let reviewStarted = false;

function isSunday(date = new Date()) {
  return date.getDay() === 0;
}

// Monday of the calendar week containing `date`, as an ISO date string.
function weekStartDate(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

// Every word touched at least once since Monday — the Sunday wrap-up,
// deliberately uncapped since the point is covering the whole week.
function weeklyReviewedWords(allWords, today = new Date()) {
  const start = weekStartDate(today);
  const todayStr = today.toISOString().slice(0, 10);
  return allWords.filter((w) => {
    const history = w.srs?.reviewHistory || [];
    return history.some((h) => h.date >= start && h.date <= todayStr);
  });
}

// No fixed due date anymore — every word has a priority score (forgetting
// risk + difficulty + lapse history, see srs.js) and each day the top
// DAILY_REVIEW_LIMIT across the whole library get selected (mostly the
// highest-priority ones, plus a couple of weighted-random picks so
// mid-priority words don't get starved forever). On Sundays, review
// everything touched since Monday instead, with no cap, as a weekly
// wrap-up. Which words count as "today's batch" is pinned to a
// date-stamped list in localStorage, so re-opening the tab doesn't hand
// out a fresh batch on top of ones already reviewed.
function getTodayReviewQueue(allWords) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  let session;
  try {
    session = JSON.parse(localStorage.getItem(REVIEW_SESSION_KEY) || "null");
  } catch {
    session = null;
  }

  if (!session || session.date !== today) {
    // No word data yet is not the same as "nothing to review" — right
    // after login, Firestore's initial sync can still be in flight when
    // this runs. Don't lock in an empty batch for the whole day just
    // because we asked too early; leave it unpinned so the next call (once
    // data has actually loaded) gets a real chance to pick a batch.
    if (!allWords.length) return [];

    const weekly = isSunday(now) ? weeklyReviewedWords(allWords, now) : [];
    const picked = weekly.length
      ? weekly
      : srs.selectDailyWords(allWords.filter((w) => w.srs), DAILY_REVIEW_LIMIT);

    session = { date: today, words: picked.map((w) => w.word), weekly: weekly.length > 0 };
    localStorage.setItem(REVIEW_SESSION_KEY, JSON.stringify(session));
  }

  const byWord = new Map(allWords.map((w) => [w.word, w]));
  return session.words.map((key) => byWord.get(key)).filter(Boolean);
}

function isTodayWeeklyReview() {
  try {
    const session = JSON.parse(localStorage.getItem(REVIEW_SESSION_KEY) || "null");
    const today = new Date().toISOString().slice(0, 10);
    return !!(session && session.date === today && session.weekly);
  } catch {
    return false;
  }
}

function buildReviewQueue() {
  reviewQueue = getTodayReviewQueue(store.loadWords());
  reviewIndex = 0;
}

// Entering the review tab always shows a preview of what's coming up first
// — the actual question flow only starts once the user clicks through it.
function renderReview() {
  buildReviewQueue();
  reviewStarted = false;
  renderReviewPreview();
}

function renderReviewPreview() {
  const area = $("#review-area");

  if (!reviewQueue.length) {
    area.innerHTML = `
      <div class="review-empty">
        <div class="big">📭</div>
        <p>目前沒有需要複習的單字。</p>
      </div>`;
    return;
  }

  const weekly = isTodayWeeklyReview();
  area.innerHTML = `
    <div class="review-card">
      <h3>${weekly ? "📅 本週總複習" : "📋 今日複習預告"}</h3>
      <p class="status">
        ${weekly ? "這禮拜複習過的" : "今天會複習這"} ${reviewQueue.length} 個單字：
      </p>
      <div class="preview-words">
        ${reviewQueue.map((w) => `<span class="tag">${escapeHtml(w.word)}</span>`).join("")}
      </div>
      <button class="reveal-btn" data-action="start-review">開始複習</button>
    </div>`;
}

function startReviewSession() {
  reviewStarted = true;
  reviewIndex = 0;
  renderCurrentReviewCard();
}

function goToNextReviewCard() {
  reviewIndex += 1;
  renderCurrentReviewCard();
}

function renderCurrentReviewCard() {
  const area = $("#review-area");
  currentQuestion = null;

  if (reviewIndex >= reviewQueue.length) {
    area.innerHTML = `
      <div class="review-empty">
        <div class="big">${reviewQueue.length ? "🎉" : "📭"}</div>
        <p>${reviewQueue.length ? "今天的複習都完成了，明天再來！" : "目前沒有到期需要複習的單字。"}</p>
      </div>`;
    return;
  }

  const w = reviewQueue[reviewIndex];
  const allWords = store.loadWords();

  if (quiz.isQuizReady(allWords)) {
    renderQuizCard(w, allWords);
  } else {
    renderFlashcardReview(w);
  }
}

// Predicted recall probability right now, per the Ebbinghaus forgetting-
// curve formula (srs.retention) — shown during review/flashcards so the
// schedule isn't just an opaque date, but a number grounded in the theory.
function retentionBadge(card) {
  const r = srs.retention(card);
  if (r === null) return "";
  const pct = Math.round(Math.max(0, Math.min(1, r)) * 100);
  return `<div class="retention-badge">📉 遺忘曲線預測記憶保留率：<strong>${pct}%</strong></div>`;
}

// GRE-style multiple-choice question (cloze / definition / synonym)
function renderQuizCard(w, allWords) {
  const area = $("#review-area");
  currentQuestion = { ...quiz.buildQuestion(w, allWords), answered: false };
  const q = currentQuestion;
  const longOptions = q.type === "definition";

  area.innerHTML = `
    <div class="review-card">
      <div class="review-progress">複習進度 ${reviewIndex + 1} / ${reviewQueue.length}</div>
      ${retentionBadge(w.srs)}
      ${q.sentence ? `<div class="cloze-sentence">${escapeHtml(q.sentence)}</div>` : ""}
      <div class="quiz-prompt">${escapeHtml(q.prompt)}</div>
      <div class="quiz-options ${longOptions ? "quiz-options-long" : ""}">
        ${q.options
          .map(
            (opt, i) =>
              `<button class="quiz-option" data-action="answer" data-index="${i}">${escapeHtml(opt)}</button>`
          )
          .join("")}
      </div>
      <div id="quiz-feedback"></div>
    </div>`;
}

function handleQuizAnswer(index) {
  if (!currentQuestion || currentQuestion.answered) return;
  currentQuestion.answered = true;

  const chosen = currentQuestion.options[index];
  const correct = chosen === currentQuestion.correctAnswer;

  $$(".quiz-option").forEach((btn, i) => {
    btn.disabled = true;
    if (currentQuestion.options[i] === currentQuestion.correctAnswer) {
      btn.classList.add("correct");
    } else if (i === index) {
      btn.classList.add("wrong");
    }
  });

  const w = reviewQueue[reviewIndex];
  const quality = correct ? 5 : 2;
  const updated = { ...w, srs: srs.review(w.srs, quality) };
  store.upsertWord(updated);
  store.recordReviewToday();
  updateDueBadge();

  $("#quiz-feedback").innerHTML = `
    <div class="quiz-result ${correct ? "quiz-correct" : "quiz-wrong"}">
      ${correct ? "✅ 答對了！" : `❌ 答錯了，正確答案：${escapeHtml(currentQuestion.correctAnswer)}`}
    </div>
    ${renderWordCard(updated, { showAddButton: false, showFamiliarity: false })}
    <button class="reveal-btn" data-action="next-question">下一題</button>`;
}

// Simple flashcard self-grading fallback (used until you've saved at least
// 4 words, since the quiz modes need other words to build wrong answers from)
function renderFlashcardReview(w) {
  const area = $("#review-area");
  area.innerHTML = `
    <div class="review-card">
      <div class="review-progress">複習進度 ${reviewIndex + 1} / ${reviewQueue.length}</div>
      <p class="status">再收藏 ${Math.max(0, 4 - store.loadWords().length)} 個單字即可解鎖選擇題複習模式</p>
      ${retentionBadge(w.srs)}
      <div class="review-word">${escapeHtml(w.word)}</div>
      <div class="phonetic">${escapeHtml(w.phonetic || "")}</div>
      <button class="reveal-btn" data-action="reveal">看看你記得嗎？</button>
      <div class="review-answer hidden" id="review-answer"></div>
    </div>`;

  $("[data-action='reveal']").addEventListener("click", () => {
    $("#review-answer").classList.remove("hidden");
    $("#review-answer").innerHTML = `
      ${renderWordCard(w, { showAddButton: false, showFamiliarity: false })}
      <div class="grade-row">
        <button class="grade-btn grade-again" data-action="grade" data-grade="1">忘記了<small>1 天後再複習</small></button>
        <button class="grade-btn grade-hard" data-action="grade" data-grade="3">有點難<small>間隔較短</small></button>
        <button class="grade-btn grade-good" data-action="grade" data-grade="4">記得<small>正常間隔</small></button>
        <button class="grade-btn grade-easy" data-action="grade" data-grade="5">很簡單<small>間隔拉長</small></button>
      </div>`;
    $(".reveal-btn").remove();
  });
}

function gradeCurrentWord(quality) {
  const w = reviewQueue[reviewIndex];
  const updated = { ...w, srs: srs.review(w.srs, quality) };
  store.upsertWord(updated);
  store.recordReviewToday();
  goToNextReviewCard();
}

// ---------- Flashcards tab ----------
// Free browsing through every saved word, any time — no daily cap, no
// grading, unlike the SRS-scheduled review tab. An endless random stream:
// every "next" draws a fresh random word (with replacement) instead of
// working through a fixed deck, so there's no "X / Y" count that implies
// an end. A small history lets "prev" step back through what you've seen
// this session.
let flashcardHistory = [];
let flashcardHistoryPos = -1;

function renderFlashcards() {
  const words = store.loadWords();
  if (!words.length) {
    $("#flashcard-area").innerHTML = `
      <div class="review-empty">
        <div class="big">🈳</div>
        <p>還沒有收藏的單字，先去查單字加幾個吧！</p>
      </div>`;
    return;
  }

  const current = flashcardHistory[flashcardHistoryPos];
  if (!current || !store.getWord(current)) {
    drawRandomFlashcard();
  } else {
    renderCurrentFlashcard();
  }
}

function drawRandomFlashcard() {
  const words = store.loadWords();
  if (!words.length) return;
  const pick = words[Math.floor(Math.random() * words.length)].word;
  flashcardHistory = flashcardHistory.slice(0, flashcardHistoryPos + 1);
  flashcardHistory.push(pick);
  flashcardHistoryPos = flashcardHistory.length - 1;
  renderCurrentFlashcard();
}

function renderCurrentFlashcard() {
  const area = $("#flashcard-area");
  const word = store.getWord(flashcardHistory[flashcardHistoryPos]);
  if (!word) {
    drawRandomFlashcard();
    return;
  }

  area.innerHTML = `
    <div class="review-card">
      ${retentionBadge(word.srs)}
      <div class="review-word">${escapeHtml(word.word)}</div>
      <div class="phonetic">${escapeHtml(word.phonetic || "")}</div>
      <button class="reveal-btn" data-action="flip-card">翻面看意思</button>
      <div class="review-answer hidden" id="flashcard-answer"></div>
      <div class="flashcard-nav">
        <button type="button" data-action="prev-card" ${flashcardHistoryPos <= 0 ? "disabled" : ""}>⬅️ 上一個</button>
        <button type="button" data-action="next-card">下一個 ➡️</button>
      </div>
    </div>`;
}

function flipCurrentFlashcard() {
  const word = store.getWord(flashcardHistory[flashcardHistoryPos]);
  if (!word) return;
  const answer = $("#flashcard-answer");
  answer.classList.remove("hidden");
  answer.innerHTML = renderWordCard(word, { showAddButton: false });
  $("[data-action='flip-card']")?.remove();
}

function goToFlashcard(delta) {
  if (delta < 0) {
    if (flashcardHistoryPos > 0) {
      flashcardHistoryPos -= 1;
      renderCurrentFlashcard();
    }
    return;
  }
  drawRandomFlashcard();
}

// ---------- Stats tab ----------
function renderStats() {
  const words = store.loadWords();
  const todayBatch = getTodayReviewQueue(words).length;
  const streak = store.getStreak();

  const retentions = words.map((w) => srs.retention(w.srs)).filter((r) => r !== null);
  const avgRetention = retentions.length
    ? Math.round((retentions.reduce((a, b) => a + b, 0) / retentions.length) * 100)
    : null;

  $("#stats-area").innerHTML = `
    <div class="stat-tile"><div class="num">${words.length}</div><div class="label">總收藏單字</div></div>
    <div class="stat-tile"><div class="num">${todayBatch}</div><div class="label">今日複習批次</div></div>
    <div class="stat-tile"><div class="num">${streak}</div><div class="label">連續複習天數</div></div>
    <div class="stat-tile"><div class="num">${avgRetention === null ? "—" : avgRetention + "%"}</div><div class="label">平均記憶保留率</div></div>`;
}

// ---------- Badge ----------
function updateDueBadge() {
  const dueCount = getTodayReviewQueue(store.loadWords()).length;
  const badge = $("#due-badge");
  badge.textContent = dueCount;
  badge.classList.toggle("hidden", dueCount === 0);
}

// ---------- Global event delegation ----------
function initGlobalEvents() {
  document.body.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "add") addWordToList(target.dataset.word);
    if (action === "remove") {
      store.deleteWord(target.dataset.word);
      updateDueBadge();
      if (lastSearchResult) doSearch(lastSearchResult.word);
      renderWordList();
    }
    if (action === "view") viewWordDetail(target.dataset.word);
    if (action === "play-audio") {
      const audio = new Audio(target.dataset.src);
      audio.play().catch(() => {});
    }
    if (action === "grade") gradeCurrentWord(Number(target.dataset.grade));
    if (action === "answer") handleQuizAnswer(Number(target.dataset.index));
    if (action === "next-question") goToNextReviewCard();
    if (action === "start-review") startReviewSession();
    if (action === "search-word") {
      $("#search-input").value = target.dataset.word;
      doSearch(target.dataset.word);
    }
    if (action === "manual-entry") renderManualEntryForm(target.dataset.word);
    if (action === "save-manual") saveManualWord(target.dataset.word);
    if (action === "manual-entry-jump") jumpToManualEntry(target.dataset.word);
    if (action === "translate") translateWord(target.dataset.word);
    if (action === "logout") cloud.logOut();
    if (action === "flip-card") flipCurrentFlashcard();
    if (action === "prev-card") goToFlashcard(-1);
    if (action === "next-card") goToFlashcard(1);
    if (action === "set-familiarity") setFamiliarity(target.dataset.word, target.dataset.level);
  });

  $("#list-filter").addEventListener("input", renderWordList);
}

// ---------- Auth / cloud sync ----------
function initAuth() {
  $("#auth-toggle-btn").addEventListener("click", () => {
    $("#auth-panel").classList.toggle("hidden");
  });

  $("#auth-login-btn").addEventListener("click", () => submitAuth("login"));
  $("#auth-signup-btn").addEventListener("click", () => submitAuth("signup"));

  cloud.onAuthChange(async (user) => {
    renderAuthArea(user);
    if (user) {
      await cloud.startSync(user.uid);
    } else {
      cloud.stopSync();
    }
    refreshCurrentTab();
  });

  cloud.onRemoteChange(refreshCurrentTab);
}

async function submitAuth(mode) {
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const status = $("#auth-status");

  if (!email || !password) {
    status.textContent = "請輸入 Email 和密碼";
    status.classList.add("error");
    return;
  }

  status.textContent = mode === "signup" ? "註冊中..." : "登入中...";
  status.classList.remove("error");

  try {
    if (mode === "signup") {
      await cloud.signUp(email, password);
    } else {
      await cloud.logIn(email, password);
    }
    status.textContent = "";
    $("#auth-password").value = "";
    $("#auth-panel").classList.add("hidden");
  } catch (err) {
    status.textContent = authErrorMessage(err);
    status.classList.add("error");
  }
}

function authErrorMessage(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "這個 Email 已經註冊過了，改用登入";
  if (code.includes("invalid-credential") || code.includes("wrong-password")) return "Email 或密碼不對";
  if (code.includes("weak-password")) return "密碼至少要 6 碼";
  if (code.includes("invalid-email")) return "Email 格式不對";
  if (code.includes("user-not-found")) return "找不到這個帳號，改用註冊";
  return "發生錯誤，請再試一次";
}

function renderAuthArea(user) {
  const area = $("#auth-area");
  if (user) {
    area.innerHTML = `
      <span class="auth-btn">☁️ ${escapeHtml(user.email)}</span>
      <button id="auth-logout-btn" type="button" class="auth-btn" data-action="logout">登出</button>`;
  } else {
    area.innerHTML = `<button id="auth-toggle-btn" type="button" class="auth-btn">🔒 登入以同步</button>`;
    $("#auth-toggle-btn").addEventListener("click", () => {
      $("#auth-panel").classList.toggle("hidden");
    });
  }
}

// ---------- Init ----------
initTabs();
initSearch();
initImport();
initAuth();
initGlobalEvents();
updateDueBadge();
