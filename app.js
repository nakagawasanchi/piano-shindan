/* 中川さん家のピアノ講座プレゼンツ ピアノスキル診断 */
(() => {
  'use strict';

  // ---------- 定数 ----------

  // 各レーンの直鎖（二分探索の対象）と、鎖の確定後に聞く独立項目
  const FLOW = [
    { lane: 'score',   chain: ['S1', 'S2', 'S3', 'S5'],             after: ['S4'] },
    { lane: 'chord',   chain: ['C1', 'C2', 'C3', 'C4', 'C5'],       after: [] },
    { lane: 'arrange', chain: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], after: ['A7'] },
    { lane: 'session', chain: ['J1', 'J2', 'J3'],                   after: ['J4'] },
    { lane: 'other',   chain: [],                                   after: ['O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8', 'O9', 'O10'] },
  ];

  const MARK_DIGIT = { no: 0, partial: 1, yes: 2 };
  const DIGIT_MARK = ['no', 'partial', 'yes'];

  const SHARE_TEXT = '私の今のピアノスキルはこちら! #中川さん家のピアノ講座';
  const TOP_URL = 'https://nakagawasanchi.github.io/piano-shindan/';

  // gtagが未読み込み（開発環境・広告ブロッカー等）でも本体動作に影響しないようにガードする
  function trackEvent(name, params) {
    if (typeof gtag === 'function') {
      gtag('event', name, params || {});
    }
  }

  // ---------- 状態 ----------

  let DATA = null;          // items.json の中身
  let BY_ID = {};           // id -> item
  let ORDER = [];           // 全項目IDの正規順（URLエンコードに使用）
  let PARENTS = {};         // id -> 直接依存(下位)ID配列
  let CHILDREN = {};        // id -> 直接依存される(上位)ID配列
  let answers = [];         // [{id, mark}] 回答履歴（戻る・リプレイ用）
  let baseImage = null;     // ロードマップ画像（遅延ロード）

  // ---------- 依存グラフ ----------

  function transitive(startId, edges) {
    const seen = new Set();
    const stack = [...(edges[startId] || [])];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(edges[id] || []));
    }
    return seen;
  }

  const ancestorsOf = (id) => transitive(id, PARENTS);    // 推移的な下位（前提）項目
  const descendantsOf = (id) => transitive(id, CHILDREN); // 推移的な上位項目

  // 回答履歴から全項目の確定状態を再計算する。
  // ルール（決定事項7）: 下位❌→上位を自動❌、上位⭕️→下位を自動⭕️。△は伝播しない。
  // 自動確定は未確定項目のみを埋め、明示回答を上書きしない。
  function computeMarks(answerList) {
    const marks = {};
    for (const { id, mark } of answerList) {
      marks[id] = { mark, source: 'answer' };
      if (mark === 'no') {
        for (const d of descendantsOf(id)) {
          if (!marks[d]) marks[d] = { mark: 'no', source: 'auto' };
        }
      } else if (mark === 'yes') {
        for (const a of ancestorsOf(id)) {
          if (!marks[a]) marks[a] = { mark: 'yes', source: 'auto' };
        }
      }
    }
    return marks;
  }

  // 次に出す質問（二分探索: 未確定の鎖の中央、偶数個なら下側を選ぶ）。全確定なら null。
  function nextQuestionId(marks) {
    for (const flow of FLOW) {
      const und = flow.chain.filter((id) => !marks[id]);
      if (und.length) return und[Math.floor((und.length - 1) / 2)];
      for (const id of flow.after) {
        if (!marks[id]) return id;
      }
    }
    return null;
  }

  // 残り質問数の目安（鎖は二分探索の理想値、独立項目は1問ずつ）
  function estimateRemaining(marks) {
    let est = 0;
    for (const flow of FLOW) {
      const k = flow.chain.filter((id) => !marks[id]).length;
      if (k) est += Math.ceil(Math.log2(k + 1));
      est += flow.after.filter((id) => !marks[id]).length;
    }
    return est;
  }

  // ---------- 結果のURLエンコード ----------
  // 31項目の mark を正規順で3進数として詰め、base36 文字列にする（10文字程度）

  function encodeResult(marks) {
    let n = 0n;
    for (const id of ORDER) {
      n = n * 3n + BigInt(MARK_DIGIT[marks[id].mark]);
    }
    return n.toString(36);
  }

  function decodeResult(str) {
    if (!/^[0-9a-z]{1,14}$/.test(str)) return null;
    let n = 0n;
    for (const ch of str) {
      n = n * 36n + BigInt(parseInt(ch, 36));
    }
    if (n >= 3n ** BigInt(ORDER.length)) return null;
    const marks = {};
    for (let i = ORDER.length - 1; i >= 0; i--) {
      marks[ORDER[i]] = { mark: DIGIT_MARK[Number(n % 3n)], source: 'restored' };
      n /= 3n;
    }
    return marks;
  }

  // ---------- 画像合成 ----------

  function loadImage() {
    if (baseImage) return Promise.resolve(baseImage);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { baseImage = img; resolve(img); };
      img.onerror = reject;
      img.src = DATA.image.src;
    });
  }

  function drawMark(ctx, mark, x, y, R) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = R * 0.3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (mark === 'yes') {
      ctx.strokeStyle = '#2f9e55';
      ctx.beginPath();
      ctx.arc(x, y, R * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    } else if (mark === 'partial') {
      ctx.strokeStyle = '#e5a400';
      const r = R * 0.95;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (-90 + i * 120) * Math.PI / 180;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#d9404f';
      const k = R * 0.65;
      ctx.beginPath();
      ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k);
      ctx.moveTo(x - k, y + k); ctx.lineTo(x + k, y - k);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawDiagnosisDate(ctx, W, H) {
    const now = new Date();
    const text = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
    const fontSize = Math.round(W * 0.016);
    const padX = fontSize * 0.7;
    const padY = fontSize * 0.5;
    ctx.save();
    ctx.font = `700 ${fontSize}px "Hiragino Kaku Gothic ProN", "Hiragino Sans", sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    const x = W - fontSize * 0.9;
    const y = H - fontSize * 0.9;
    const metrics = ctx.measureText(text);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.fillRect(x - metrics.width - padX, y - fontSize - padY * 0.3, metrics.width + padX * 2, fontSize + padY);
    ctx.fillStyle = '#43314c';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  async function renderResultCanvas(canvas, marks) {
    const img = await loadImage();
    const W = DATA.image.width;
    const H = DATA.image.height;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    const R = DATA.nodeRadius * W;
    for (const item of DATA.items) {
      const m = marks[item.id];
      if (!m) continue;
      drawMark(ctx, m.mark, item.pos.x * W, item.pos.y * H, R);
    }
    drawDiagnosisDate(ctx, W, H);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
    });
  }

  // ---------- 画面制御 ----------

  const $ = (id) => document.getElementById(id);
  const views = { top: null, quiz: null, result: null };

  function show(name) {
    for (const [key, el] of Object.entries(views)) {
      el.hidden = key !== name;
    }
    window.scrollTo(0, 0);
  }

  function showTop() {
    answers = [];
    history.replaceState(null, '', location.pathname);
    show('top');
  }

  function startQuiz() {
    answers = [];
    show('quiz');
    renderQuestion();
  }

  function renderQuestion() {
    const marks = computeMarks(answers);
    const qid = nextQuestionId(marks);
    if (!qid) {
      showResult(marks, 'complete');
      return;
    }
    const item = BY_ID[qid];
    const lane = DATA.lanes.find((l) => l.id === item.lane);
    $('q-lane').textContent = lane ? lane.label : '';
    $('q-text').textContent = item.question;

    const decided = Object.keys(marks).length;
    const total = ORDER.length;
    const remain = estimateRemaining(marks);
    $('progress-bar').style.width = `${Math.round(decided / total * 100)}%`;
    $('progress-text').textContent = `質問 ${answers.length + 1} 問目（残り目安 あと${remain}問）`;
    $('btn-back').textContent = answers.length ? '1つ戻る' : 'トップに戻る';
  }

  function answer(mark) {
    const marks = computeMarks(answers);
    const qid = nextQuestionId(marks);
    if (!qid) return;
    answers.push({ id: qid, mark });
    renderQuestion();
  }

  function goBack() {
    if (!answers.length) {
      showTop();
      return;
    }
    answers.pop();
    show('quiz');
    renderQuestion();
  }

  async function showResult(marks, source) {
    show('result');
    $('share-note').hidden = true;
    history.replaceState(null, '', '?r=' + encodeResult(marks));
    if (source === 'complete') {
      trackEvent('quiz_complete', { question_count: answers.length });
    } else if (source === 'restore') {
      trackEvent('result_restore');
    }
    try {
      await renderResultCanvas($('result-canvas'), marks);
    } catch (e) {
      $('share-note').hidden = false;
      $('share-note').textContent = '画像の読み込みに失敗しました。通信環境をご確認のうえ再読み込みしてください。';
    }
  }

  function triggerDownload(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'piano-skill-shindan.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function downloadImage() {
    trackEvent('image_download');
    const blob = await canvasToBlob($('result-canvas'));
    triggerDownload(blob);
  }

  function xIntentUrl() {
    return 'https://twitter.com/intent/tweet?text=' +
      encodeURIComponent(SHARE_TEXT) + '&url=' + encodeURIComponent(TOP_URL);
  }

  // X Web Intentは画像を直接添付できないため、結果画像をクリップボードにコピーしてから
  // 投稿画面を開き、貼り付けを案内する（実質「画像添付」にする）。
  // Safari は clipboard.write() をユーザー操作から同期的に呼ばないと失敗するため、
  // blobの取得（canvasToBlobのPromise）を待たずに ClipboardItem に渡してすぐ write() する。
  async function shareViaXWithImageAttach() {
    const canvas = $('result-canvas');
    let attach = 'clipboard';
    let copied = false;

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': canvasToBlob(canvas) }),
        ]);
        copied = true;
      } catch (e) {
        copied = false;
      }
    }

    const note = $('share-note');
    note.hidden = false;

    if (copied) {
      trackEvent('share_click', { method: 'x_intent', attach: 'clipboard' });
      window.open(xIntentUrl(), '_blank', 'noopener');
      note.textContent = '画像をコピーしました。投稿画面で貼り付け（長押し→ペースト / Ctrl+V）してください。';
    } else {
      attach = 'download';
      try {
        const blob = await canvasToBlob(canvas);
        triggerDownload(blob);
      } catch (e) {
        // 画像取得に失敗しても投稿画面自体は開く
      }
      trackEvent('share_click', { method: 'x_intent', attach });
      window.open(xIntentUrl(), '_blank', 'noopener');
      note.textContent = '保存した画像を投稿画面に添付してください。';
    }
  }

  async function share() {
    // モバイル等: Web Share API で画像ファイルごと共有
    // 注意: url を files と同時に渡すと、iOSが共有シートの「コピー」時にURLのリンクプレビュー
    // （今表示中の結果画面＝ほぼ同じ画像のスナップショット）を追加の画像として同梱してしまい、
    // 画像が2枚貼り付いたように見える不具合があった。そのため画像共有はfilesとtextのみにする。
    try {
      const blob = await canvasToBlob($('result-canvas'));
      const file = new File([blob], 'piano-skill-shindan.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        trackEvent('share_click', { method: 'web_share' });
        await navigator.share({ files: [file], text: SHARE_TEXT });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // ユーザーがキャンセル
      // 失敗時はフォールバックへ
    }
    // フォールバック: X 投稿画面を画像添付案内つきで開く
    await shareViaXWithImageAttach();
  }

  // ---------- 初期化 ----------

  async function init() {
    const res = await fetch('data/items.json');
    DATA = await res.json();
    for (const item of DATA.items) {
      BY_ID[item.id] = item;
      ORDER.push(item.id);
      PARENTS[item.id] = item.requires;
    }
    CHILDREN = Object.fromEntries(ORDER.map((id) => [id, []]));
    for (const item of DATA.items) {
      for (const p of item.requires) CHILDREN[p].push(item.id);
    }

    views.top = $('view-top');
    views.quiz = $('view-quiz');
    views.result = $('view-result');

    $('btn-start').addEventListener('click', () => { trackEvent('quiz_start'); startQuiz(); });
    $('btn-yes').addEventListener('click', () => answer('yes'));
    $('btn-partial').addEventListener('click', () => answer('partial'));
    $('btn-no').addEventListener('click', () => answer('no'));
    $('btn-back').addEventListener('click', goBack);
    $('btn-download').addEventListener('click', downloadImage);
    $('btn-share').addEventListener('click', share);
    $('btn-share-x').addEventListener('click', shareViaXWithImageAttach);
    $('btn-retry').addEventListener('click', () => { showTop(); startQuiz(); });

    // 結果復元URL（?r=...）で開かれた場合は結果画面を直接表示
    const r = new URLSearchParams(location.search).get('r');
    const restored = r ? decodeResult(r) : null;
    if (restored) {
      showResult(restored, 'restore');
    } else {
      showTop();
    }
  }

  init().catch((e) => {
    document.body.insertAdjacentHTML('afterbegin',
      '<p style="padding:16px;color:#d9404f">読み込みに失敗しました。ページを再読み込みしてください。</p>');
    console.error(e);
  });
})();
