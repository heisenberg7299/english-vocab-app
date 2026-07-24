import { lookupWord, WordNotFoundError } from "./dictionary.js";
import { generateMnemonic } from "./mnemonic.js";
import * as store from "./storage.js";
import * as srs from "./srs.js";

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

// ---------- Review tab ----------
let reviewQueue = [];
let reviewIndex = 0;

function buildReviewQueue() {
  reviewQueue = store.loadWords().filter((w) => srs.isDue(w.srs));
  reviewIndex = 0;
}

function renderReview() {
  buildReviewQueue();
  renderCurrentReviewCard();
}

function renderCurrentReviewCard() {
  const area = $("#review-area");

  if (reviewIndex >= reviewQueue.length) {
    area.innerHTML = `
      <div class="review-empty">
        <div class="big">${reviewQueue.length ? "🎉" : "📭"}</div>
        <p>${reviewQueue.length ? "今天的複習都完成了，明天再來！" : "目前沒有到期需要複習的單字。"}</p>
      </div>`;
    return;
  }

  const w = reviewQueue[reviewIndex];
  area.innerHTML = `
    <div class="review-card">
      <div class="review-progress">複習進度 ${reviewIndex + 1} / ${reviewQueue.length}</div>
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
  reviewIndex += 1;
  updateDueBadge();
  renderCurrentReviewCard();
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
  });

  $("#list-filter").addEventListener("input", renderWordList);
}

// ---------- Init ----------
initTabs();
initSearch();
initGlobalEvents();
updateDueBadge();
