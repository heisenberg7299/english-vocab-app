# 單字背起來

一個給自己用的英文（GRE 程度）背單字網站，查單字/片語自動抓解釋和例句，並用數學化的遺忘曲線模型排每天的複習進度。

**線上使用：** https://heisenberg7299.github.io/english-vocab-app/

## 功能

- **查單字／片語**：輸入英文單字或片語，自動查詢解釋、詞性、例句、同義字、反義字，並附上中文翻譯（繁體）與自動產生的記憶技巧
- **今日複習**：不用固定的到期日排程，而是每天用一個優先分數（記憶保留率、難度、答錯次數、複習次數綜合計算）從整個單字本裡選出當天最該複習的單字，一天只能複習一次
- **GRE 風格測驗**：複習用選擇題（例句填空、字義選擇、同義字選擇），而不是單純的記不記得
- **字卡模式**：隨時可以抽字卡複習，不限於當天批次
- **熟悉度標記**：可以手動把單字標成不熟／普通／熟悉，會影響複習排程的優先順序
- **學習歷程日曆**：記錄哪天新增了哪些字、複習了哪些字
- **統計**：單字總數、連續複習天數、平均記憶保留率、熟悉度分布等
- **雲端同步**：登入後單字本會同步到 Firestore，不同裝置登入同一帳號可以看到同一份資料
- **PWA**：可以加到手機主畫面或桌面，當成獨立 App 使用

## 技術

純前端網站，沒有建置流程（no build step），直接用瀏覽器原生 ES modules：

- `index.html` / `style.css` / `js/app.js` — 頁面結構、樣式、主要邏輯
- `js/dictionary.js` — 查單字/片語，依序嘗試 [Free Dictionary API](https://dictionaryapi.dev/)、[Datamuse](https://www.datamuse.com/api/)、[Wiktionary](https://en.wiktionary.org/) 三個免費來源
- `js/translate.js` — 用 [MyMemory](https://mymemory.translated.net/) 翻譯中文，並用 [opencc-js](https://github.com/nk2028/opencc-js) 確保輸出一定是繁體
- `js/srs.js` — 間隔複習排程演算法（基於記憶穩定度與遺忘曲線的優先分數模型）
- `js/quiz.js` — GRE 風格選擇題產生邏輯
- `js/mnemonic.js` — 規則式記憶技巧產生器（字首字根字尾拆解）
- `js/storage.js` / `js/cloud-sync.js` — 本機快取（localStorage）與 Firebase（Firestore + Authentication）雲端同步
- `sw.js` / `manifest.json` — PWA 設定，network-first 的 service worker

託管在 GitHub Pages，`?v=N` 版本號手動管理快取更新。
