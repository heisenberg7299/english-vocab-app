// Rule-based memorization-tip generator. None of the dictionary APIs provide
// mnemonics, so this builds one from common English prefixes/roots/suffixes
// plus a naive syllable split, giving the learner building blocks to make
// their own memory hook instead of a canned AI-generated sentence.
import { GRE_PREFIXES, GRE_ROOTS } from "./gre-roots.js?v=66";

const PREFIXES = [
  ["un", "不、相反"], ["re", "再次、往回"], ["dis", "不、相反、分開"],
  ["pre", "在...之前"], ["post", "在...之後"], ["mis", "錯誤地"],
  ["over", "過度、超過"], ["under", "不足、在...之下"], ["sub", "在...之下"],
  ["super", "超級、在...之上"], ["inter", "在...之間"], ["trans", "橫越、轉換"],
  ["auto", "自己、自動"], ["bio", "生命、生物"], ["geo", "地球、地理"],
  ["tele", "遠距"], ["micro", "微小"], ["macro", "巨大"],
  ["multi", "多個"], ["mono", "單一"], ["bi", "兩個"], ["tri", "三個"],
  ["anti", "反對、抵抗"], ["co", "共同"], ["ex", "向外、之前的"],
  ["in", "在...裡面、不"], ["im", "不、在...裡面"], ["non", "非、不"],
  ["semi", "一半"], ["de", "去除、往下"],
];

const SUFFIXES = [
  ["tion", "名詞，表示動作或狀態"], ["sion", "名詞，表示動作或狀態"],
  ["ment", "名詞，表示結果或狀態"], ["ness", "名詞，表示性質"],
  ["ity", "名詞，表示性質、狀態"], ["able", "形容詞，表示可以...的"],
  ["ible", "形容詞，表示可以...的"], ["ful", "形容詞，充滿...的"],
  ["less", "形容詞，缺少...的"], ["ous", "形容詞，具有...性質的"],
  ["ive", "形容詞，具有...傾向的"], ["al", "形容詞，與...有關的"],
  ["ology", "...學（學科）"], ["ist", "從事...的人"],
  ["er", "從事...的人、比較級"], ["or", "從事...的人"],
  ["ize", "動詞，使成為..."], ["ise", "動詞，使成為..."],
  ["fy", "動詞，使變成..."], ["ly", "副詞"],
];

// Naive syllable split: each chunk is a run of consonants followed by a
// run of vowels (roughly matching how English syllables break). Not
// linguistically exact, but good enough as a memorization aid.
function splitSyllables(word) {
  const w = word.toLowerCase();
  const chunks = w.match(/[^aeiouy]*[aeiouy]+/g);
  if (!chunks) return [w];

  const covered = chunks.join("").length;
  if (covered < w.length) {
    chunks[chunks.length - 1] += w.slice(covered);
  }

  // merge a trailing 1-letter leftover chunk into the previous one
  if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) {
    const last = chunks.pop();
    chunks[chunks.length - 1] += last;
  }

  return chunks;
}

// Looks for a GRE-course prefix at the start of the word, or a GRE-course
// root anywhere inside it — longest matching form wins (so e.g. "cess"
// beats a coincidental shorter match). Roots require length >= 3 to cut
// down on noise from 2-letter forms matching all over the place as a
// coincidental substring (e.g. "ac" inside unrelated words).
function findGrePrefix(word) {
  const w = word.toLowerCase();
  let best = null;
  for (const entry of GRE_PREFIXES) {
    for (const form of entry.forms) {
      if (form.length < 2) continue;
      if (w.startsWith(form) && w.length > form.length + 2) {
        if (!best || form.length > best.form.length) best = { form, entry };
      }
    }
  }
  return best;
}

function findGreRoot(word) {
  const w = word.toLowerCase();
  let best = null;
  for (const entry of GRE_ROOTS) {
    for (const form of entry.forms) {
      if (form.length < 3) continue;
      if (w.includes(form)) {
        if (!best || form.length > best.form.length) best = { form, entry };
      }
    }
  }
  return best;
}

// Builds the mnemonic line(s), if any, for whichever GRE prefix/root this
// word contains. Shared by generateMnemonic() (for words being looked up
// for the first time) and app.js's one-time retroactive pass over already
// -saved words, so both stay in sync with exactly the same matching logic.
export function buildGreRootHintLines(word) {
  const lines = [];
  const prefix = findGrePrefix(word);
  if (prefix) {
    lines.push(`字首「${prefix.form}-」：${prefix.entry.meaning}（如 ${prefix.entry.examples.slice(0, 3).join("、")}）`);
  }
  const root = findGreRoot(word);
  if (root) {
    lines.push(`字根「${root.form}」：${root.entry.meaning}${root.entry.hint ? `（提示字：${root.entry.hint}）` : ""}`);
  }
  return lines;
}

function findMorphemes(word) {
  const w = word.toLowerCase();
  const found = { prefix: null, suffix: null };

  for (const [p, meaning] of PREFIXES.sort((a, b) => b[0].length - a[0].length)) {
    if (w.startsWith(p) && w.length > p.length + 2) {
      found.prefix = { text: p, meaning };
      break;
    }
  }
  for (const [s, meaning] of SUFFIXES.sort((a, b) => b[0].length - a[0].length)) {
    if (w.endsWith(s) && w.length > s.length + 2) {
      found.suffix = { text: s, meaning };
      break;
    }
  }
  return found;
}

export function generateMnemonic(word, firstDefinition = "") {
  const syllables = splitSyllables(word);
  const greHints = buildGreRootHintLines(word);
  // Only fall back to the generic (non-GRE-specific) prefix/suffix guesses
  // for whichever of the two the GRE list didn't already cover, so a word
  // never gets two competing "字首" lines.
  const { prefix, suffix } = findMorphemes(word);
  const hasGrePrefix = greHints.some((l) => l.startsWith("字首"));
  const lines = [];

  lines.push(`拆音節記憶：${syllables.join(" · ")}`);
  lines.push(...greHints);

  if (prefix && !hasGrePrefix) {
    lines.push(`字首「${prefix.text}-」通常表示：${prefix.meaning}`);
  }
  if (suffix) {
    lines.push(`字尾「-${suffix.text}」通常表示：${suffix.meaning}`);
  }
  if (!greHints.length && !prefix && !suffix) {
    lines.push("這個字沒有明顯常見字首/字尾，建議用「諧音聯想」：找一個發音相近的中文詞或畫面來連結字義。");
  }

  if (firstDefinition) {
    lines.push(`小技巧：試著用「${syllables.join("")}」造一個和「${firstDefinition}」有關的畫面或短句，印象會更深刻。`);
  }

  return lines.join("\n");
}
