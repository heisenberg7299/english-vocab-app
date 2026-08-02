import {
  lookupWord,
  lookupWordFallback,
  lookupWordWiktionary,
  fetchSimilarWords,
  fetchRelatedWords,
  buildManualWordData,
  phraseDeinflectionAttempts,
  WordNotFoundError,
} from "./dictionary.js?v=50";
import { generateMnemonic } from "./mnemonic.js?v=50";
import { translateToChinese } from "./translate.js?v=50";
import * as store from "./storage.js?v=50";
import * as srs from "./srs.js?v=50";
import * as quiz from "./quiz.js?v=50";
import * as cloud from "./cloud-sync.js?v=50";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------- Tabs ----------
let activeTab = "search";

function initTabs() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
      $("#tabs-menu").classList.remove("open");
    });
  });

  $("#menu-toggle-btn").addEventListener("click", () => {
    $("#tabs-menu").classList.toggle("open");
  });

  document.addEventListener("click", (e) => {
    const menu = $("#tabs-menu");
    const toggle = $("#menu-toggle-btn");
    if (!menu.classList.contains("open")) return;
    if (menu.contains(e.target) || toggle.contains(e.target)) return;
    menu.classList.remove("open");
  });
}

function switchTab(name) {
  activeTab = name;
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "search") randomizeSearchPlaceholder();
  if (name === "list") renderWordList();
  if (name === "review") renderReview();
  if (name === "flashcards") renderFlashcards();
  if (name === "calendar") renderCalendar();
  if (name === "stats") renderStats();
  if (name === "achievements") renderAchievements();
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
  if (activeTab === "calendar") renderCalendar();
  if (activeTab === "achievements") renderAchievements();
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

// Nothing in the lookup/save/quiz pipeline actually requires a single
// token — the dictionary lookups, Datamuse fallback, manual entry, and
// bulk import (which only splits on commas/顿號/newlines, never spaces)
// all already work fine on a full phrase. This just flags multi-word
// entries visually so it's clear phrases are supported.
const isPhrase = (word) => word.trim().includes(" ");

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
      : data.source === "wiktionary"
      ? `<span class="source-badge">來源：維基詞典</span>`
      : data.source === "manual"
      ? `<span class="source-badge">來源：自行輸入</span>`
      : "";

  const chineseHtml = data.chineseMeaning
    ? `<div class="chinese-meaning">
         <span class="def-label">中文意思</span> ${escapeHtml(data.chineseMeaning)}<span class="mt-note">（機器翻譯，僅供參考）</span>
         ${saved ? `<button type="button" class="edit-zh-btn" data-action="edit-chinese" data-word="${escapeHtml(data.word)}" title="編輯中文意思">✏️</button>` : ""}
       </div>`
    : saved
    ? `<button class="translate-btn" data-action="translate" data-word="${escapeHtml(data.word)}">翻譯成中文</button>`
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
        ${isPhrase(data.word) ? `<span class="phrase-badge">片語</span>` : ""}
        ${data.phonetic ? `<span class="phonetic">${escapeHtml(data.phonetic)}</span>` : ""}
        <button class="audio-btn" data-action="play-audio" data-word="${escapeHtml(data.word)}" data-src="${escapeHtml(data.audio || "")}">🔊</button>
        ${sourceLabel}
      </div>
      ${chineseHtml}
      ${meaningsHtml}
      ${synHtml}
      ${antHtml}
      <div class="mnemonic-box" data-mnemonic-box>
        <span class="label">💡 好背誦的方法${saved ? `<button type="button" class="edit-mnemonic-btn" data-action="edit-mnemonic" data-word="${escapeHtml(data.word)}" title="編輯好背的方法">✏️</button>` : ""}</span>${escapeHtml(mnemonic)}
      </div>
      ${familiarityHtml}
      ${actionsHtml}
    </div>`;
}

// ---------- Search tab ----------
let lastSearchResult = null;
let wordDetailReturnTab = "list";

// Rotating placeholder example — picks a fresh GRE-level word (and
// occasionally a phrase/idiom, to signal those work too) each visit to
// the search tab instead of always showing the same "ubiquitous".
const PLACEHOLDER_EXAMPLE_WORDS = [
  "ubiquitous", "ephemeral", "cacophony", "conundrum", "sycophant",
  "pernicious", "laconic", "voracious", "obfuscate", "panacea",
  "quixotic", "gregarious", "ineffable", "serendipity", "mellifluous",
  "surreptitious", "vicissitude", "assiduous", "perfunctory", "capricious",
  "equanimity", "recalcitrant", "insidious", "ostentatious", "ubiety",
  "kick the bucket", "beat around the bush", "break the ice", "once in a blue moon",
];

function randomizeSearchPlaceholder() {
  const word = PLACEHOLDER_EXAMPLE_WORDS[Math.floor(Math.random() * PLACEHOLDER_EXAMPLE_WORDS.length)];
  $("#search-input").placeholder = `輸入你不會的英文單字或片語，例如 ${word}`;
}

function initSearch() {
  randomizeSearchPlaceholder();
  const form = $("#search-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#search-input");
    const word = input.value.trim();
    if (!word) return;
    await doSearch(word);
  });
}

function firstDefinitionText(data) {
  for (const m of data.meanings || []) {
    for (const d of m.definitions || []) {
      if (d.definition) return d.definition;
    }
  }
  return "";
}

// Best-effort Chinese gloss; silently omitted if the translation API has
// nothing (attachChineseMeaning never throws, see translateToChinese).
// MyMemory just echoes obscure GRE words back untranslated rather than
// erroring (sycophant, mellifluous, vicissitude, ubiety all do this) —
// translateToChinese already filters those no-op echoes out, so falling
// back to translating the definition instead catches real Chinese text
// for words it doesn't have a direct translation for.
async function attachChineseMeaning(data) {
  let chineseMeaning = await translateToChinese(data.word);
  if (!chineseMeaning) {
    const def = firstDefinitionText(data);
    if (def) chineseMeaning = await translateToChinese(def);
  }
  return chineseMeaning ? { ...data, chineseMeaning } : data;
}

async function doSearch(word) {
  const status = $("#search-status");
  const result = $("#search-result");
  status.textContent = "查詢中...";
  status.classList.remove("error");
  result.innerHTML = "";
  inWordDetailView = false; // a fresh search always leaves detail-view mode

  try {
    const data = await attachChineseMeaning(await lookupWord(word));
    lastSearchResult = data;
    status.textContent = "";
    renderSearchResult(data);
  } catch (err) {
    // Whatever went wrong with the primary source — a clean "not found",
    // or the request failing outright — always try the other sources
    // before giving up. A generic fetch failure looks identical whether
    // it's a real network outage or just that one specific domain being
    // unreachable (blocked by a network/extension, having an outage,
    // etc.) while everything else is fine; Datamuse and Wiktionary are
    // different domains, so it's worth trying them regardless of why the
    // primary dictionary failed, not only on a clean 404.
    await handleWordNotFound(word);
  }
}

// Whether the search tab is currently showing a word opened from
// elsewhere (單字本/今日複習) rather than a fresh search — controls
// whether the "← 返回" button is included. This has to live in
// renderSearchResult itself (not just viewWordDetail's own HTML) since
// every other function that refreshes #search-result after an in-place
// edit (familiarity, translation) goes through here too, and previously
// stomped the back button because it didn't know it needed to keep it.
let inWordDetailView = false;

function renderSearchResult(data) {
  const saved = !!store.getWord(data.word);
  const backLabel = wordDetailReturnTab === "review" ? "← 返回今日複習預告" : "← 返回單字本";
  const backHtml = inWordDetailView
    ? `<button type="button" class="back-btn" data-action="back-to-list">${backLabel}</button>`
    : "";
  $("#search-result").innerHTML = backHtml + renderWordCard(data, { saved });
}

// Tries all three dictionary sources in order for one query string;
// returns the raw (not-yet-translated) word data, or null if none have it.
async function lookupAllSources(word) {
  try {
    return await lookupWord(word);
  } catch (err) {
    if (!(err instanceof WordNotFoundError)) throw err;
  }
  const fromDatamuse = await lookupWordFallback(word);
  if (fromDatamuse) return fromDatamuse;
  return await lookupWordWiktionary(word);
}

// Primary dictionary has nothing: try Datamuse, then Wiktionary directly
// (broader phrase coverage than Datamuse's own older Wiktionary snapshot),
// then a de-inflected retry, and only then offer manual entry.
async function handleWordNotFound(word) {
  const status = $("#search-status");
  status.textContent = "主要字典查詢失敗，嘗試備援來源...";

  const fallback = await lookupWordFallback(word);
  if (fallback) {
    const withZh = await attachChineseMeaning(fallback);
    lastSearchResult = withZh;
    status.textContent = "";
    renderSearchResult(withZh);
    return;
  }

  const wiktionary = await lookupWordWiktionary(word);
  if (wiktionary) {
    const withZh = await attachChineseMeaning(wiktionary);
    lastSearchResult = withZh;
    status.textContent = "";
    renderSearchResult(withZh);
    return;
  }

  // Dictionaries only store phrases in their base form ("beat around the
  // bush"), so a conjugated phrase ("beating around the bush") fails an
  // exact match even though the idiom itself is well documented — retry
  // with the phrase's first word de-inflected before giving up.
  for (const candidate of phraseDeinflectionAttempts(word)) {
    let data = null;
    try {
      data = await lookupAllSources(candidate);
    } catch {
      // network hiccup on this candidate — just move on to the next one
    }
    if (data) {
      const withZh = await attachChineseMeaning(data);
      lastSearchResult = withZh;
      status.textContent = `找不到「${word.trim().toLowerCase()}」，已自動改用基本型「${candidate}」查詢`;
      status.classList.remove("error");
      renderSearchResult(withZh);
      return;
    }
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
      <p>所有字典來源都查不到「${escapeHtml(word)}」。</p>
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
  checkMilestones();
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
          ${isPhrase(w.word) ? `<span class="phrase-badge">片語</span>` : ""}
          ${w.chineseMeaning ? `<div class="chip-zh">${escapeHtml(w.chineseMeaning)}</div>` : ""}
          <div class="meta ${lowRetention ? "due-today" : ""}">記憶保留率 ${retentionPct ?? "—"}% · 已複習 ${w.srs?.reviews || 0} 次</div>
        </div>`;
    })
    .join("");
}

// Re-renders whichever view(s) currently show this word's card after an
// in-place edit (familiarity, Chinese meaning, translation) — shared by
// every function below that mutates a saved word without a full re-search.
function refreshWordViews(word, updated) {
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

// Backfills a Chinese gloss for a word already saved before this feature
// existed (or whose translation lookup failed the first time).
async function translateWord(word) {
  const data = store.getWord(word);
  if (!data) return;

  const chineseMeaning = await translateToChinese(data.word);
  if (!chineseMeaning) return;

  const updated = { ...data, chineseMeaning };
  store.upsertWord(updated);
  refreshWordViews(word, updated);
}

// Machine translation sometimes gets it wrong (or picks an odd sense of an
// ambiguous word) — this lets the user overwrite it with their own wording
// instead of being stuck with whatever the API returned.
function startEditChinese(container, word) {
  const data = store.getWord(word);
  if (!data || !container) return;
  container.innerHTML = `
    <span class="def-label">中文意思</span>
    <textarea class="zh-edit-input" rows="2">${escapeHtml(data.chineseMeaning || "")}</textarea>
    <div class="zh-edit-actions">
      <button type="button" class="primary" data-action="save-chinese" data-word="${escapeHtml(word)}">儲存</button>
      <button type="button" data-action="cancel-edit-chinese" data-word="${escapeHtml(word)}">取消</button>
    </div>`;
  container.querySelector(".zh-edit-input")?.focus();
}

function saveChineseEdit(container, word) {
  const data = store.getWord(word);
  const textarea = container?.querySelector(".zh-edit-input");
  if (!data || !textarea) return;

  const updated = { ...data, chineseMeaning: textarea.value.trim() };
  store.upsertWord(updated);
  refreshWordViews(word, updated);
}

function cancelEditChinese(word) {
  const data = store.getWord(word);
  if (!data) return;
  refreshWordViews(word, data);
}

// Lets the user write their own memory trick instead of (or editing) the
// auto-generated one. An empty save just falls back to the auto-generated
// mnemonic again, since renderWordCard already does `data.mnemonic ||
// generateMnemonic(...)` — no separate "reset" affordance needed.
function startEditMnemonic(container, word) {
  const data = store.getWord(word);
  if (!data || !container) return;
  const current = data.mnemonic || generateMnemonic(
    data.word,
    data.meanings[0]?.definitions[0]?.definition || ""
  );
  container.innerHTML = `
    <span class="label">💡 好背誦的方法</span>
    <textarea class="mnemonic-edit-input" rows="2">${escapeHtml(current)}</textarea>
    <div class="mnemonic-edit-actions">
      <button type="button" class="primary" data-action="save-mnemonic" data-word="${escapeHtml(word)}">儲存</button>
      <button type="button" data-action="cancel-edit-mnemonic" data-word="${escapeHtml(word)}">取消</button>
    </div>`;
  container.querySelector(".mnemonic-edit-input")?.focus();
}

function saveMnemonicEdit(container, word) {
  const data = store.getWord(word);
  const textarea = container?.querySelector(".mnemonic-edit-input");
  if (!data || !textarea) return;

  const updated = { ...data, mnemonic: textarea.value.trim() };
  store.upsertWord(updated);
  refreshWordViews(word, updated);
}

function cancelEditMnemonic(word) {
  const data = store.getWord(word);
  if (!data) return;
  refreshWordViews(word, data);
}

// Self-rated familiarity (不熟/普通/熟悉), separate from the SRS ease
// factor — shown as a colored highlight on the word's card in 我的單字本.
function setFamiliarity(word, level) {
  const data = store.getWord(word);
  if (!data) return;

  const updated = { ...data, familiarity: level };
  store.upsertWord(updated);
  refreshWordViews(word, updated);
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
    let chineseMeaning = await translateToChinese(w.word);
    if (!chineseMeaning) {
      const def = firstDefinitionText(w);
      if (def) chineseMeaning = await translateToChinese(def);
    }
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

// Remembers which word chip to scroll back to when returning to 我的單字本
// — switching tabs collapses the list's height while its (much shorter)
// detail card is showing, so the scroll position itself doesn't survive
// the round trip; scrolling the specific chip back into view does.
let lastViewedListWord = null;

function viewWordDetail(word, returnTab = "list") {
  const data = store.getWord(word);
  if (!data) return;
  wordDetailReturnTab = returnTab;
  if (returnTab === "list") lastViewedListWord = word;
  inWordDetailView = true;
  switchTab("search");
  lastSearchResult = data;
  $("#search-input").value = data.word;
  $("#search-status").textContent = "";
  renderSearchResult(data);
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

// ---------- Word suggestions ----------
// Seeds a handful of random words already in the library and asks Datamuse
// for semantically related words (its ml= "means like" param) for each —
// in practice this surfaces genuine GRE-level synonyms/near-synonyms when
// seeded from GRE-level words, since it's just following the same register
// the seed word is already in. Words suggested by more than one seed are
// ranked higher, on the theory that cross-seed agreement means it's more
// central to the vocabulary the user is already building.
const SUGGEST_SEED_COUNT = 5;
const SUGGEST_RESULT_COUNT = 12;

function pickRandomSeeds(words, count) {
  const pool = [...words];
  const picked = [];
  while (pool.length && picked.length < count) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

async function generateWordSuggestions() {
  const words = store.loadWords();
  if (!words.length) return [];

  const existing = new Set(words.map((w) => w.word.toLowerCase()));
  const seeds = pickRandomSeeds(words, SUGGEST_SEED_COUNT);
  const scores = new Map();

  const results = await Promise.all(seeds.map((w) => fetchRelatedWords(w.word)));
  for (const related of results) {
    for (const candidate of related) {
      const key = candidate.toLowerCase();
      if (existing.has(key)) continue;
      scores.set(key, (scores.get(key) || 0) + 1);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SUGGEST_RESULT_COUNT)
    .map(([word]) => word);
}

async function refreshSuggestions() {
  const btn = $("#suggest-refresh-btn");
  const progress = $("#suggest-progress");
  const result = $("#suggest-result");

  if (!store.loadWords().length) {
    result.innerHTML = `<p class="status">單字本裡還沒有字，先加幾個單字，才能根據它們推薦相關的字。</p>`;
    return;
  }

  btn.disabled = true;
  progress.textContent = "推薦中...";
  result.innerHTML = "";

  const suggestions = await generateWordSuggestions();

  progress.textContent = "";
  btn.disabled = false;

  result.innerHTML = suggestions.length
    ? suggestions
        .map(
          (w) =>
            `<span class="suggestion-chip" data-action="search-suggestion" data-word="${escapeHtml(w)}">${escapeHtml(w)}</span>`
        )
        .join("")
    : `<p class="status">目前沒有找到新的推薦字，換一批試試看。</p>`;
}

function initSuggest() {
  $("#suggest-toggle-btn").addEventListener("click", () => {
    const panel = $("#suggest-panel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden") && !$("#suggest-result").children.length) {
      refreshSuggestions();
    }
  });
  $("#suggest-refresh-btn").addEventListener("click", refreshSuggestions);
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
      let data = null;
      try {
        data = await lookupAllSources(word);
      } catch {
        data = null;
      }
      if (!data) {
        // same de-inflection retry as single-word search, so a phrase
        // pasted in its conjugated form ("kicked the bucket") still lands
        for (const candidate of phraseDeinflectionAttempts(word)) {
          try {
            data = await lookupAllSources(candidate);
          } catch {
            data = null;
          }
          if (data) break;
        }
      }
      if (data) {
        const withZh = await attachChineseMeaning(data);
        saveWordRecord(withZh);
        added.push(withZh.word);
      } else {
        failed.push(word);
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
        ? `<div class="import-fail">❌ 所有字典來源都查不到 ${failed.length} 個：
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
const REVIEW_ROUND_SIZE = 15;
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

// Every word touched at least once since Monday — the Sunday wrap-up.
// Capped to WEEKLY_REVIEW_CAP, favoring the ones most likely to be
// forgotten (low retention, high difficulty, more lapses) rather than
// dumping the whole week's words in uncapped, which got overwhelming.
const WEEKLY_REVIEW_CAP = 40;

function weeklyReviewedWords(allWords, today = new Date()) {
  const start = weekStartDate(today);
  const todayStr = today.toISOString().slice(0, 10);
  const touched = allWords.filter((w) => {
    const history = w.srs?.reviewHistory || [];
    return history.some((h) => h.date >= start && h.date <= todayStr);
  });
  if (touched.length <= WEEKLY_REVIEW_CAP) return touched;
  return [...touched]
    .sort((a, b) => srs.priorityScore(b.srs, today) - srs.priorityScore(a.srs, today))
    .slice(0, WEEKLY_REVIEW_CAP);
}

// No fixed due date anymore — every word has a priority score (forgetting
// risk + difficulty + lapse history, see srs.js) and each round the top
// REVIEW_ROUND_SIZE across the whole library get selected (mostly the
// highest-priority ones, plus a couple of weighted-random picks so
// mid-priority words don't get starved forever). There's no cap on how
// many rounds you can do in one day — finishing a round grades those
// words, which puts them on cooldown (see srs.js), so the next round's
// selectDailyWords call naturally surfaces a fresh set instead of
// repeating what was just answered (see extendReviewQueue below). On
// Sundays, review everything touched since Monday instead, uncapped, as
// a weekly wrap-up. Which words are in play today is pinned to a
// date-stamped list in localStorage, so re-opening the tab doesn't hand
// out a fresh round on top of ones already reviewed.
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
      : srs.selectDailyWords(allWords.filter((w) => w.srs), REVIEW_ROUND_SIZE);

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

// How many of today's pinned words have already been graded — persisted so
// closing the tab or reloading mid-session resumes instead of restarting,
// and so today's batch can't be replayed from question 1 once it's done.
function getTodayReviewProgress() {
  try {
    const session = JSON.parse(localStorage.getItem(REVIEW_SESSION_KEY) || "null");
    const today = new Date().toISOString().slice(0, 10);
    if (session && session.date === today) {
      return Math.min(session.progress || 0, session.words.length);
    }
  } catch {
    // fall through
  }
  return 0;
}

function saveReviewProgress(progress) {
  try {
    const session = JSON.parse(localStorage.getItem(REVIEW_SESSION_KEY) || "null");
    const today = new Date().toISOString().slice(0, 10);
    if (session && session.date === today) {
      session.progress = progress;
      localStorage.setItem(REVIEW_SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore — worst case progress isn't persisted this time
  }
}

function buildReviewQueue() {
  reviewQueue = getTodayReviewQueue(store.loadWords());
  reviewIndex = getTodayReviewProgress();
}

// Words already reviewed today are on cooldown (see srs.js), so this
// naturally returns a fresh set rather than repeating today's round(s) —
// no need to explicitly track/exclude what's already in the session.
function nextRoundCandidates(allWords) {
  return srs.selectDailyWords(allWords.filter((w) => w.srs), REVIEW_ROUND_SIZE);
}

// Whether starting another round today would actually turn up anything —
// used to decide whether to offer a "continue" button after finishing a
// round, without committing to a new round just to check.
function moreWordsAvailableToday() {
  if (isTodayWeeklyReview()) return false; // weekly mode is already uncapped in one go
  return nextRoundCandidates(store.loadWords()).length > 0;
}

// Appends another round's worth of words to today's pinned session
// instead of replacing it, so finishing a round doesn't lock you out for
// the day if you want to keep going.
function extendReviewQueue() {
  const allWords = store.loadWords();
  const nextBatch = nextRoundCandidates(allWords);
  if (!nextBatch.length) return false;

  const today = new Date().toISOString().slice(0, 10);
  let session;
  try {
    session = JSON.parse(localStorage.getItem(REVIEW_SESSION_KEY) || "null");
  } catch {
    session = null;
  }
  if (!session || session.date !== today) return false;

  const existing = new Set(session.words);
  const newWords = nextBatch.map((w) => w.word).filter((w) => !existing.has(w));
  if (!newWords.length) return false;

  session.words = [...session.words, ...newWords];
  localStorage.setItem(REVIEW_SESSION_KEY, JSON.stringify(session));
  reviewQueue = getTodayReviewQueue(allWords);
  return true;
}

function continueReviewSession() {
  if (!extendReviewQueue()) return;
  reviewStarted = false;
  renderReviewPreview();
}

// Entering the review tab shows a preview of what's coming up first — but
// only the first time today. If today's batch is already in progress (or
// finished), jump straight back into it instead, so leaving and reopening
// the tab — or reloading the page — can't be used to replay questions
// that were already answered today.
function renderReview() {
  buildReviewQueue();
  if (reviewQueue.length && reviewIndex > 0) {
    reviewStarted = true;
    renderCurrentReviewCard();
    return;
  }
  reviewStarted = false;
  renderReviewPreview();
}

// Previews whatever in reviewQueue hasn't been reviewed yet — for the
// first round that's the whole queue (reviewIndex is 0), and for a round
// started via continueReviewSession() it's just the newly appended words
// (reviewIndex already sits at the boundary from the previous round), so
// "再複習 15 個" gets its own preview screen the same as the first round
// does, instead of jumping straight into questions.
function renderReviewPreview() {
  const area = $("#review-area");
  const upcoming = reviewQueue.slice(reviewIndex);

  if (!upcoming.length) {
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
        ${weekly ? "這禮拜複習過的" : "接下來會複習這"} ${upcoming.length} 個單字：
      </p>
      <div class="preview-word-list">
        ${upcoming
          .map((w) => {
            const pos = w.meanings?.[0]?.partOfSpeech || "";
            return `
              <div class="preview-word-item" data-action="view" data-word="${escapeHtml(w.word)}" data-return="review">
                <span class="preview-word-text">${escapeHtml(w.word)}</span>
                ${pos ? `<span class="pos-label">詞性：${escapeHtml(pos)}</span>` : ""}
                <span class="preview-word-zh">${escapeHtml(w.chineseMeaning || "（尚無中文翻譯）")}</span>
              </div>`;
          })
          .join("")}
      </div>
      <button class="reveal-btn" data-action="start-review">開始複習</button>
    </div>`;
}

function startReviewSession() {
  reviewStarted = true;
  renderCurrentReviewCard();
}

function goToNextReviewCard() {
  reviewIndex += 1;
  saveReviewProgress(reviewIndex);
  updateDueBadge();
  renderCurrentReviewCard();
}

function renderCurrentReviewCard() {
  const area = $("#review-area");
  currentQuestion = null;

  if (reviewIndex >= reviewQueue.length) {
    const canContinue = reviewQueue.length > 0 && moreWordsAvailableToday();
    area.innerHTML = `
      <div class="review-empty">
        <div class="big">${reviewQueue.length ? "🎉" : "📭"}</div>
        <p>${
          reviewQueue.length
            ? canContinue
              ? "這一輪複習完成了！"
              : "今天的複習都完成了，明天再來！"
            : "目前沒有到期需要複習的單字。"
        }</p>
        ${canContinue ? `<button class="reveal-btn" data-action="continue-review">再複習 ${REVIEW_ROUND_SIZE} 個</button>` : ""}
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

// A little variety so it's not the same "答對了！" every single time.
const CORRECT_FEEDBACK_PHRASES = ["✅ 答對了！", "🎉 太強了，就是這個！", "👍 沒錯，記住了！", "✨ 答對，繼續保持！", "🙌 完全正確！"];
const WRONG_FEEDBACK_PHRASES = ["❌ 答錯了", "😅 差一點，再接再厲", "🤔 不是這個，再想想", "📌 先記一下，下次就會了"];

function randomFeedbackPhrase(correct) {
  const list = correct ? CORRECT_FEEDBACK_PHRASES : WRONG_FEEDBACK_PHRASES;
  return list[Math.floor(Math.random() * list.length)];
}

// Builds an explanation appropriate to how the question was actually
// asked, not just a generic word definition: a cloze question gets the
// whole example sentence translated (so the context makes sense), a
// synonym question spells out why the two words match, and a definition
// question falls back to the word's own Chinese gloss + definition.
async function buildQuizExplanation(q, word) {
  if (q.type === "cloze" && q.fullSentence) {
    const zhSentence = await translateToChinese(q.fullSentence);
    if (zhSentence) return `整句翻譯：${zhSentence}`;
    if (word.chineseMeaning) return `「${word.word}」意思：${word.chineseMeaning}`;
    return "";
  }

  if (q.type === "synonym") {
    const base = `「${word.word}」與「${q.correctAnswer}」互為同義字`;
    return word.chineseMeaning ? `${base}，都是「${word.chineseMeaning}」的意思` : base;
  }

  const firstDefinition = word.meanings?.[0]?.definitions?.[0]?.definition || "";
  return [word.chineseMeaning, firstDefinition].filter(Boolean).join("　·　");
}

async function handleQuizAnswer(index) {
  if (!currentQuestion || currentQuestion.answered) return;
  currentQuestion.answered = true;
  const q = currentQuestion;

  const chosen = q.options[index];
  const correct = chosen === q.correctAnswer;

  $$(".quiz-option").forEach((btn, i) => {
    btn.disabled = true;
    if (q.options[i] === q.correctAnswer) {
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
  checkMilestones();

  const feedbackPhrase = randomFeedbackPhrase(correct);

  $("#quiz-feedback").innerHTML = `
    <div class="quiz-result ${correct ? "quiz-correct" : "quiz-wrong"}">
      ${correct ? feedbackPhrase : `${feedbackPhrase}，正確答案：${escapeHtml(q.correctAnswer)}`}
      <div class="quiz-explanation" id="quiz-explanation">解釋載入中…</div>
    </div>
    ${renderWordCard(updated, { showAddButton: false, showFamiliarity: false })}
    <button class="reveal-btn" data-action="next-question">下一題</button>`;

  // Fill the explanation in once it resolves — the element may already be
  // gone if the user moved on to the next question before this settled.
  const explanation = await buildQuizExplanation(q, updated);
  const explanationEl = $("#quiz-explanation");
  if (explanationEl) {
    if (explanation) explanationEl.textContent = explanation;
    else explanationEl.remove();
  }
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
  checkMilestones();
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

// Don't hand back a word shown in the last few draws — with a small
// library, uniform random draws collide on the same word way too often.
const FLASHCARD_NO_REPEAT_WINDOW = 8;

// Weighted random draw biased toward low-retention (at-risk) words,
// rather than picking uniformly — a word about to be forgotten should
// show up more often than one just reviewed. Words never reviewed yet
// (no retention estimate) get a neutral mid-weight so they still surface
// regularly without either dominating or being crowded out.
function pickWeightedFlashcard(words) {
  const recentlyShown = new Set(flashcardHistory.slice(-FLASHCARD_NO_REPEAT_WINDOW));
  let pool = words.filter((w) => !recentlyShown.has(w.word));
  if (!pool.length) pool = words; // exclusion emptied the pool (tiny library) — fall back to everyone

  const weights = pool.map((w) => {
    const r = srs.retention(w.srs);
    return r === null ? 0.5 : Math.max(0.05, 1 - r);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i].word;
  }
  return pool[pool.length - 1].word;
}

function drawRandomFlashcard() {
  const words = store.loadWords();
  if (!words.length) return;
  const pick = pickWeightedFlashcard(words);
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
  answer.innerHTML = renderWordCard(word, { showAddButton: false, saved: true });
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

// ---------- Calendar tab ----------
// A month view of learning history: which days had a review session, how
// many words got added, and how many review events happened, so the whole
// journey is visible at a glance instead of just a streak number.
let calendarViewDate = new Date();

function pad2(n) {
  return String(n).padStart(2, "0");
}

function renderCalendar() {
  const year = calendarViewDate.getFullYear();
  const month = calendarViewDate.getMonth();
  const words = store.loadWords();
  const reviewedDates = new Set(store.loadStats().reviewedDates || []);

  const addedByDate = new Map();
  const reviewCountByDate = new Map();
  for (const w of words) {
    if (w.addedDate) addedByDate.set(w.addedDate, (addedByDate.get(w.addedDate) || 0) + 1);
    for (const h of w.srs?.reviewHistory || []) {
      reviewCountByDate.set(h.date, (reviewCountByDate.get(h.date) || 0) + 1);
    }
  }

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateStr = (d) => `${year}-${pad2(month + 1)}-${pad2(d)}`;

  const cells = Array.from({ length: firstWeekday }, () => null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  const cellsHtml = cells
    .map((d) => {
      if (!d) return `<div class="cal-cell cal-empty"></div>`;
      const ds = dateStr(d);
      const reviewCount = reviewCountByDate.get(ds) || 0;
      const addedCount = addedByDate.get(ds) || 0;
      return `
        <button type="button" class="cal-cell ${ds === todayStr ? "cal-today" : ""} ${reviewedDates.has(ds) ? "cal-reviewed" : ""}" data-action="view-cal-day" data-date="${ds}">
          <span class="cal-day-num">${d}</span>
          ${addedCount ? `<span class="cal-badge cal-added">+${addedCount}</span>` : ""}
          ${reviewCount ? `<span class="cal-badge cal-review-count">✓${reviewCount}</span>` : ""}
        </button>`;
    })
    .join("");

  $("#calendar-area").innerHTML = `
    <div class="cal-header">
      <button type="button" data-action="cal-prev-month">←</button>
      <h3>${year} 年 ${month + 1} 月</h3>
      <button type="button" data-action="cal-next-month">→</button>
    </div>
    <div class="cal-weekdays">${["日", "一", "二", "三", "四", "五", "六"].map((d) => `<div>${d}</div>`).join("")}</div>
    <div class="cal-grid">${cellsHtml}</div>
    <div class="cal-legend">
      <span class="cal-legend-item"><span class="cal-dot"></span>有複習</span>
      <span class="cal-legend-item"><span class="cal-badge cal-added">+N</span>新增單字</span>
      <span class="cal-legend-item"><span class="cal-badge cal-review-count">✓N</span>複習次數</span>
    </div>
    <div id="cal-day-detail"></div>`;
}

function changeCalendarMonth(delta) {
  calendarViewDate.setMonth(calendarViewDate.getMonth() + delta);
  renderCalendar();
}

function viewCalendarDay(dateStr) {
  const words = store.loadWords();
  const added = words.filter((w) => w.addedDate === dateStr).map((w) => w.word);
  const reviewed = words
    .filter((w) => (w.srs?.reviewHistory || []).some((h) => h.date === dateStr))
    .map((w) => w.word);

  const detail = $("#cal-day-detail");
  if (!added.length && !reviewed.length) {
    detail.innerHTML = `<p class="status">${dateStr}：這天沒有記錄</p>`;
    return;
  }
  detail.innerHTML = `
    <div class="cal-detail-card">
      <h4>${dateStr}</h4>
      ${added.length ? `<p><strong>新增單字：</strong>${added.map((w) => escapeHtml(w)).join("、")}</p>` : ""}
      ${reviewed.length ? `<p><strong>複習過：</strong>${reviewed.map((w) => escapeHtml(w)).join("、")}</p>` : ""}
    </div>`;
}

// Last 30 days of review activity, split into correct/wrong per day —
// quality < 3 means "again"/forgot in both the quiz flow (correct=5,
// wrong=2) and the flashcard self-grade flow (again=1), so it's a
// consistent "did this go well" threshold across both review modes.
function reviewActivityLast30Days(words) {
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const byDate = new Map(days.map((d) => [d, { correct: 0, wrong: 0 }]));
  for (const w of words) {
    for (const h of w.srs?.reviewHistory || []) {
      const bucket = byDate.get(h.date);
      if (!bucket) continue;
      if (h.quality < 3) bucket.wrong += 1;
      else bucket.correct += 1;
    }
  }
  return days.map((d) => ({ date: d, ...byDate.get(d) }));
}

function renderReviewActivityChart(words) {
  const days = reviewActivityLast30Days(words);
  const max = Math.max(1, ...days.map((d) => d.correct + d.wrong));

  const bars = days
    .map((d, i) => {
      const total = d.correct + d.wrong;
      const correctPct = (d.correct / max) * 100;
      const wrongPct = (d.wrong / max) * 100;
      const [, m, day] = d.date.split("-");
      const showLabel = i % 5 === 0 || i === days.length - 1;
      return `
        <div class="bar-col" title="${d.date}：答對 ${d.correct}、答錯 ${d.wrong}">
          <div class="bar-stack">
            ${total ? `<div class="bar-seg bar-wrong" style="height:${wrongPct}%"></div><div class="bar-seg bar-correct" style="height:${correctPct}%"></div>` : ""}
          </div>
          <div class="bar-label">${showLabel ? `${Number(m)}/${Number(day)}` : ""}</div>
        </div>`;
    })
    .join("");

  return `
    <div class="chart-section">
      <h3>近 30 天複習活動</h3>
      <div class="bar-chart">${bars}</div>
      <div class="chart-legend">
        <span class="chart-legend-item"><span class="chart-dot" style="background:#22c55e"></span>答對/記得</span>
        <span class="chart-legend-item"><span class="chart-dot" style="background:#ef4444"></span>答錯/忘記</span>
      </div>
    </div>`;
}

function renderRetentionHistogram(words) {
  const labels = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
  const buckets = [0, 0, 0, 0, 0];
  for (const w of words) {
    const r = srs.retention(w.srs);
    if (r === null) continue;
    const pct = Math.max(0, Math.min(100, r * 100));
    buckets[Math.min(4, Math.floor(pct / 20))] += 1;
  }
  const max = Math.max(1, ...buckets);

  const bars = buckets
    .map(
      (count, i) => `
        <div class="bar-col" title="${labels[i]}：${count} 個單字">
          <div class="bar-stack">
            ${count ? `<div class="bar-seg bar-retention" style="height:${(count / max) * 100}%"></div>` : ""}
          </div>
          <div class="bar-label">${labels[i]}</div>
        </div>`
    )
    .join("");

  return `
    <div class="chart-section">
      <h3>記憶保留率分布</h3>
      <div class="bar-chart bar-chart-wide">${bars}</div>
    </div>`;
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
  const atRisk = retentions.filter((r) => r < 0.5).length;

  const totalReviews = words.reduce((sum, w) => sum + (w.srs?.reviews || 0), 0);

  const weekStart = weekStartDate();
  const addedThisWeek = words.filter((w) => w.addedDate && w.addedDate >= weekStart).length;
  const reviewsThisWeek = words.reduce((sum, w) => {
    const history = w.srs?.reviewHistory || [];
    return sum + history.filter((h) => h.date >= weekStart).length;
  }, 0);

  const famCounts = { red: 0, yellow: 0, green: 0, none: 0 };
  words.forEach((w) => {
    famCounts[w.familiarity && famCounts[w.familiarity] !== undefined ? w.familiarity : "none"]++;
  });

  $("#stats-area").innerHTML = `
    <div class="stat-tile"><div class="num">${words.length}</div><div class="label">總收藏單字</div></div>
    <div class="stat-tile"><div class="num">${todayBatch}</div><div class="label">今日複習批次</div></div>
    <div class="stat-tile"><div class="num">${streak}</div><div class="label">連續複習天數</div></div>
    <div class="stat-tile"><div class="num">${avgRetention === null ? "—" : avgRetention + "%"}</div><div class="label">平均記憶保留率</div></div>
    <div class="stat-tile"><div class="num">${totalReviews}</div><div class="label">累積複習次數</div></div>
    <div class="stat-tile"><div class="num">${addedThisWeek}</div><div class="label">本週新增單字</div></div>
    <div class="stat-tile"><div class="num">${reviewsThisWeek}</div><div class="label">本週複習次數</div></div>
    <div class="stat-tile"><div class="num">${atRisk}</div><div class="label">保留率低於 50% 的單字</div></div>
    <div class="stat-tile stat-tile-wide">
      <div class="fam-breakdown">
        <div class="fam-breakdown-item"><span class="fam-num" style="color:#ef4444">${famCounts.red}</span><span class="label">不熟</span></div>
        <div class="fam-breakdown-item"><span class="fam-num" style="color:#eab308">${famCounts.yellow}</span><span class="label">普通</span></div>
        <div class="fam-breakdown-item"><span class="fam-num" style="color:#22c55e">${famCounts.green}</span><span class="label">熟悉</span></div>
        <div class="fam-breakdown-item"><span class="fam-num" style="color:var(--muted)">${famCounts.none}</span><span class="label">未標記</span></div>
      </div>
      <div class="label" style="margin-top:10px;">熟悉度分布</div>
    </div>
    ${renderReviewActivityChart(words)}
    ${renderRetentionHistogram(words)}`;
}

// ---------- Milestones ----------
// Small celebratory toasts for streak / word-count / review-count
// thresholds — purely for fun, doesn't feed back into the SRS model.
// Each milestone key is recorded once shown so it never repeats.
const MILESTONES_SHOWN_KEY = "milestones_shown_v1";
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365];
const WORD_COUNT_MILESTONES = [10, 25, 50, 100, 200, 500, 1000];
const REVIEW_COUNT_MILESTONES = [50, 100, 250, 500, 1000, 2500];

function getShownMilestones() {
  try {
    return new Set(JSON.parse(localStorage.getItem(MILESTONES_SHOWN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function markMilestoneShown(key) {
  const shown = getShownMilestones();
  shown.add(key);
  localStorage.setItem(MILESTONES_SHOWN_KEY, JSON.stringify([...shown]));
}

function showMilestoneToast(text) {
  const toast = document.createElement("div");
  toast.className = "milestone-toast";
  toast.textContent = text;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 3800);
}

// Only ever shows one toast per call, even if multiple thresholds were
// crossed at once (e.g. reopening the app after a few days away) — the
// rest surface on the next call instead of stacking up.
function checkMilestones() {
  const shown = getShownMilestones();
  const words = store.loadWords();
  const streak = store.getStreak();
  const totalReviews = words.reduce((sum, w) => sum + (w.srs?.reviews || 0), 0);

  const candidates = [
    ...STREAK_MILESTONES.filter((m) => streak >= m).map((m) => ({ key: `streak-${m}`, text: `🔥 連續複習 ${m} 天了，太猛了！` })),
    ...WORD_COUNT_MILESTONES.filter((m) => words.length >= m).map((m) => ({ key: `words-${m}`, text: `📚 單字本累積到 ${m} 個單字了！` })),
    ...REVIEW_COUNT_MILESTONES.filter((m) => totalReviews >= m).map((m) => ({ key: `reviews-${m}`, text: `🎯 累積複習次數達到 ${m} 次！` })),
  ];

  const next = candidates.find((c) => !shown.has(c.key));
  if (next) {
    showMilestoneToast(next.text);
    markMilestoneShown(next.key);
  }
}

// ---------- Achievements tab ----------
// Unlock status is computed live from current stats, not from
// getShownMilestones() — that set only tracks "has the toast fired yet"
// (deliberately throttled to one at a time), which would make a returning
// user's already-passed milestones look locked here just because the
// celebratory toast for them hasn't caught up yet. This page always
// reflects the true current state.
function renderAchievements() {
  const words = store.loadWords();
  const streak = store.getStreak();
  const totalReviews = words.reduce((sum, w) => sum + (w.srs?.reviews || 0), 0);

  const groups = [
    { icon: "🔥", label: "連續複習天數", current: streak, unit: "天", thresholds: STREAK_MILESTONES },
    { icon: "📚", label: "單字本累積數量", current: words.length, unit: "個", thresholds: WORD_COUNT_MILESTONES },
    { icon: "🎯", label: "累積複習次數", current: totalReviews, unit: "次", thresholds: REVIEW_COUNT_MILESTONES },
  ];

  const unlockedCount = groups.reduce((sum, g) => sum + g.thresholds.filter((t) => g.current >= t).length, 0);
  const totalCount = groups.reduce((sum, g) => sum + g.thresholds.length, 0);

  $("#achievements-area").innerHTML = `
    <p class="status">已解鎖 ${unlockedCount} / ${totalCount} 個成就</p>
    ${groups
      .map(
        (g) => `
      <div class="achv-group">
        <h3>${g.icon} ${escapeHtml(g.label)}（目前：${g.current}${g.unit}）</h3>
        <div class="achv-grid">
          ${g.thresholds
            .map((t) => {
              const unlocked = g.current >= t;
              return `
                <div class="achv-badge ${unlocked ? "achv-unlocked" : "achv-locked"}">
                  <div class="achv-icon">${unlocked ? g.icon : "🔒"}</div>
                  <div class="achv-num">${t}${g.unit}</div>
                </div>`;
            })
            .join("")}
        </div>
      </div>`
      )
      .join("")}`;
}

// ---------- Badge ----------
// Remaining count in today's pinned batch, not the batch's total size —
// otherwise this stayed at (e.g.) 15 even after finishing all of them.
function updateDueBadge() {
  const queueLength = getTodayReviewQueue(store.loadWords()).length;
  const remaining = Math.max(0, queueLength - getTodayReviewProgress());
  const badge = $("#due-badge");
  badge.textContent = remaining;
  badge.classList.toggle("hidden", remaining === 0);
}

// Words looked up via the Datamuse/Wiktionary fallback sources never have
// a recorded pronunciation clip (only the primary dictionary provides
// one), and even when a clip exists, playback can fail silently for
// reasons outside our control (autoplay policy, a blocked CDN, a flaky
// network) — the old code just swallowed that with .catch(() => {}), so
// the speaker button looked "broken" with zero feedback either way. Now
// it always tries the real clip first when there is one, and falls back
// to the browser's own text-to-speech either way, so the button always
// does *something* audible.
function speakWord(word) {
  if (!word || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function playWordAudio(word, src) {
  if (!src) {
    speakWord(word);
    return;
  }
  const audio = new Audio(src);
  audio.addEventListener("error", () => speakWord(word), { once: true });
  audio.play().catch(() => speakWord(word));
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
    if (action === "view") viewWordDetail(target.dataset.word, target.dataset.return || "list");
    if (action === "play-audio") playWordAudio(target.dataset.word, target.dataset.src);
    if (action === "grade") gradeCurrentWord(Number(target.dataset.grade));
    if (action === "answer") handleQuizAnswer(Number(target.dataset.index));
    if (action === "next-question") goToNextReviewCard();
    if (action === "start-review") startReviewSession();
    if (action === "continue-review") continueReviewSession();
    if (action === "cal-prev-month") changeCalendarMonth(-1);
    if (action === "cal-next-month") changeCalendarMonth(1);
    if (action === "view-cal-day") viewCalendarDay(target.dataset.date);
    if (action === "back-to-list") {
      switchTab(wordDetailReturnTab);
      if (wordDetailReturnTab === "list" && lastViewedListWord) {
        $(`#word-list [data-word="${lastViewedListWord}"]`)?.scrollIntoView({ block: "center" });
      }
    }
    if (action === "search-word") {
      $("#search-input").value = target.dataset.word;
      doSearch(target.dataset.word);
    }
    if (action === "search-suggestion") {
      switchTab("search");
      $("#search-input").value = target.dataset.word;
      doSearch(target.dataset.word);
    }
    if (action === "manual-entry") renderManualEntryForm(target.dataset.word);
    if (action === "save-manual") saveManualWord(target.dataset.word);
    if (action === "manual-entry-jump") jumpToManualEntry(target.dataset.word);
    if (action === "translate") translateWord(target.dataset.word);
    if (action === "edit-chinese") startEditChinese(target.closest(".chinese-meaning"), target.dataset.word);
    if (action === "save-chinese") saveChineseEdit(target.closest(".chinese-meaning"), target.dataset.word);
    if (action === "cancel-edit-chinese") cancelEditChinese(target.dataset.word);
    if (action === "edit-mnemonic") startEditMnemonic(target.closest("[data-mnemonic-box]"), target.dataset.word);
    if (action === "save-mnemonic") saveMnemonicEdit(target.closest("[data-mnemonic-box]"), target.dataset.word);
    if (action === "cancel-edit-mnemonic") cancelEditMnemonic(target.dataset.word);
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
initSuggest();
initAuth();
initGlobalEvents();
updateDueBadge();
