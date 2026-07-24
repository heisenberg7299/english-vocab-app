import { lookupWord, WordNotFoundError } from "./dictionary.js";
import { generateMnemonic } from "./mnemonic.js";
import * as store from "./storage.js";
import * as srs from "./srs.js";
import * as quiz from "./quiz.js";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------- Tabs ----------
function initTabs() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "list") renderWordList();
  if (name === "review") renderReview();
  if (name === "stats") renderStats();
}

// ---------- Rendering helpers ----------
function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderWordCard(data, opts = {}) {
  const { saved = false, showAddButton = true } = opts;

  const meaningsHtml = data.meanings
    .map(
      (m) => `
      <div class="pos-block">
        <span class="pos-label">${escapeHtml(m.partOfSpeech || "")}</span>
        ${m.definitions
          .map(
            (d) => `
            <div class="def-item">
              ${escapeHtml(d.definition)}
              ${d.example ? `<div class="def-example">"${escapeHtml(d.example)}"</div>` : ""}
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
      </div>
      ${meaningsHtml}
      ${synHtml}
      ${antHtml}
      <div class="mnemonic-box">
        <span class="label">💡 好背誦的方法</span>${escapeHtml(mnemonic)}
      </div>
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

async function doSearch(word) {
  const status = $("#search-status");
  const result = $("#search-result");
  status.textContent = "查詢中...";
  status.classList.remove("error");
  result.innerHTML = "";

  try {
    const data = await lookupWord(word);
    lastSearchResult = data;
    status.textContent = "";
    const saved = !!store.getWord(data.word);
    result.innerHTML = renderWordCard(data, { saved });
  } catch (err) {
    lastSearchResult = null;
    status.textContent = err instanceof WordNotFoundError ? err.message : err.message || "查詢時發生錯誤";
    status.classList.add("error");
  }
}

function addWordToList(wordKey) {
  const data = lastSearchResult && lastSearchResult.word === wordKey.toLowerCase()
    ? lastSearchResult
    : null;
  if (!data) return;

  const mnemonic = generateMnemonic(data.word, data.meanings[0]?.definitions[0]?.definition || "");
  store.upsertWord({
    ...data,
    mnemonic,
    addedDate: new Date().toISOString().slice(0, 10),
    srs: srs.newCard(),
  });
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
      const due = srs.isDue(w.srs);
      const daysLeft = w.srs ? srs.daysUntilDue(w.srs) : 0;
      const dueLabel = due ? "今天複習" : `${daysLeft} 天後複習`;
      return `
        <div class="word-chip" data-action="view" data-word="${escapeHtml(w.word)}">
          <h3>${escapeHtml(w.word)}</h3>
          <div class="meta ${due ? "due-today" : ""}">${dueLabel} · 已複習 ${w.srs?.repetition || 0} 次</div>
        </div>`;
    })
    .join("");
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
        const data = await lookupWord(word);
        const mnemonic = generateMnemonic(data.word, data.meanings[0]?.definitions[0]?.definition || "");
        store.upsertWord({
          ...data,
          mnemonic,
          addedDate: new Date().toISOString().slice(0, 10),
          srs: srs.newCard(),
        });
        added.push(data.word);
      } catch {
        failed.push(word);
      }
    }

    // be polite to the free public API
    if (i < words.length - 1) await new Promise((r) => setTimeout(r, 200));
  }

  progress.textContent = "";
  startBtn.disabled = false;
  textarea.value = "";
  resultBox.innerHTML = `
    ${added.length ? `<div class="import-ok">✅ 已加入 ${added.length} 個：${escapeHtml(added.join(", "))}</div>` : ""}
    ${skipped.length ? `<div>⏭️ 已存在，略過 ${skipped.length} 個：${escapeHtml(skipped.join(", "))}</div>` : ""}
    ${failed.length ? `<div class="import-fail">❌ 查詢失敗 ${failed.length} 個：${escapeHtml(failed.join(", "))}</div>` : ""}`;

  updateDueBadge();
  renderWordList();
}

// ---------- Review tab ----------
let reviewQueue = [];
let reviewIndex = 0;
let currentQuestion = null;

function buildReviewQueue() {
  reviewQueue = store.loadWords().filter((w) => srs.isDue(w.srs));
  reviewIndex = 0;
}

function renderReview() {
  buildReviewQueue();
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

// GRE-style multiple-choice question (cloze / definition / synonym)
function renderQuizCard(w, allWords) {
  const area = $("#review-area");
  currentQuestion = { ...quiz.buildQuestion(w, allWords), answered: false };
  const q = currentQuestion;
  const longOptions = q.type === "definition";

  area.innerHTML = `
    <div class="review-card">
      <div class="review-progress">複習進度 ${reviewIndex + 1} / ${reviewQueue.length}</div>
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
    ${renderWordCard(updated, { showAddButton: false })}
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
      <div class="review-word">${escapeHtml(w.word)}</div>
      <div class="phonetic">${escapeHtml(w.phonetic || "")}</div>
      <button class="reveal-btn" data-action="reveal">看看你記得嗎？</button>
      <div class="review-answer hidden" id="review-answer"></div>
    </div>`;

  $("[data-action='reveal']").addEventListener("click", () => {
    $("#review-answer").classList.remove("hidden");
    $("#review-answer").innerHTML = `
      ${renderWordCard(w, { showAddButton: false })}
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

// ---------- Stats tab ----------
function renderStats() {
  const words = store.loadWords();
  const dueToday = words.filter((w) => srs.isDue(w.srs)).length;
  const streak = store.getStreak();
  const forecastData = srs.forecast(words, 7);
  const maxCount = Math.max(1, ...forecastData);

  const dayLabels = Array.from({ length: 7 }, (_, i) => {
    if (i === 0) return "今天";
    if (i === 1) return "明天";
    return `+${i}天`;
  });

  $("#stats-area").innerHTML = `
    <div class="stat-tile"><div class="num">${words.length}</div><div class="label">總收藏單字</div></div>
    <div class="stat-tile"><div class="num">${dueToday}</div><div class="label">今日待複習</div></div>
    <div class="stat-tile"><div class="num">${streak}</div><div class="label">連續複習天數</div></div>
    <div class="forecast" style="grid-column: 1 / -1">
      <h3>未來 7 天複習量預測</h3>
      <div class="forecast-bars">
        ${forecastData
          .map(
            (count, i) => `
            <div class="forecast-bar-wrap">
              <div class="forecast-count">${count}</div>
              <div class="forecast-bar" style="height:${(count / maxCount) * 100}%"></div>
              <div class="forecast-day">${dayLabels[i]}</div>
            </div>`
          )
          .join("")}
      </div>
    </div>`;
}

// ---------- Badge ----------
function updateDueBadge() {
  const dueCount = store.loadWords().filter((w) => srs.isDue(w.srs)).length;
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
  });

  $("#list-filter").addEventListener("input", renderWordList);
}

// ---------- Init ----------
initTabs();
initSearch();
initImport();
initGlobalEvents();
updateDueBadge();
