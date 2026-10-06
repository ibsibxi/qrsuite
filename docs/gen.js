/*! QRSuite v2 · 二维码生成板块
 *
 *  设计要点（第一性原理）：
 *  1. 生成比识别简单得多 —— QR 编码是**公开规格**（ISO/IEC 18004），所以这里能真做出来，
 *     而不像异形码那样卡在私有协议上。这也是本板块值得做的原因。
 *  2. 完全离线：库已本地打包在 vendor/，不引用任何 CDN（与本项目"图片不外传"一致）。
 *  3. 中文必须走 UTF-8 编码器：qrcode-generator 默认按 Shift-JIS 编码，
 *     不加 vendor/qrcode-generator-utf8.js 的话中文会编错（实测确认过）。
 *  4. 样式美化只改**渲染**，不改编码数据 —— 只要保留足够的定位符与模块对比度，
 *     生成的图仍可被标准扫描器识别。圆点/圆角只是把方块换成圆形绘制。
 */
(function () {
  'use strict';

  const T = (k, v) => (window.QRi18n ? window.QRi18n.t(k, v) : k);
  const $ = (s) => document.querySelector(s);

  // 纠错等级对应的可恢复比例（L 7% / M 15% / Q 25% / H 30%），越高越耐污损但容量越小
  const EC_LEVELS = ['L', 'M', 'Q', 'H'];

  let lastCanvas = null;   // 供下载/复制用

  /* ---------------- 生成核心 ---------------- */

  function buildMatrix(text, ec, minVersion) {
    if (typeof qrcode !== 'function') throw new Error(T('gen.errNoLib'));
    const qr = qrcode(minVersion || 0, ec || 'M');
    qr.addData(text);
    qr.make();
    return qr;
  }

  /**
   * 把模块矩阵画到 canvas。
   * @param opts { size, margin, dark, light, dotStyle, logoText, logoImg }
   */
  function render(qr, opts) {
    const n = qr.getModuleCount();
    const margin = opts.margin;                       // 静区（模块数），规格要求 ≥4
    const total = n + margin * 2;
    const px = Math.max(1, Math.floor(opts.size / total));   // 每模块像素
    const side = px * total;

    const cv = document.createElement('canvas');
    cv.width = side; cv.height = side;
    const ctx = cv.getContext('2d');

    // 背景（静区）必须与浅色模块一致，否则扫描器找不到定位符
    ctx.fillStyle = opts.light;
    ctx.fillRect(0, 0, side, side);

    ctx.fillStyle = opts.dark;
    const r = px / 2;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!qr.isDark(row, col)) continue;
        const cx = (col + margin) * px + r;
        const cy = (row + margin) * px + r;
        if (opts.dotStyle === 'dot') {
          // 注意：圆点半径必须**盖住方形模块的四角**（即 r ≥ px/√2 ≈ 0.707px）。
          // 实测：内切圆（r = px/2）只覆盖 78.5% 面积、四角留白，
          // 用真解码器回环验证是**扫不出来的**（系数 1.0/0.92/0.85/0.75/0.65 全失败，
          // 只有覆盖四角的 1.0 系数那档能扫）。所以这里刻意取 0.72 * px。
          const rDot = px * 0.72;
          ctx.beginPath();
          ctx.arc(cx, cy, rDot, 0, Math.PI * 2);
          ctx.fill();
        } else if (opts.dotStyle === 'rounded') {
          const rr = Math.min(r * 0.5, px * 0.28);
          const x = (col + margin) * px, y = (row + margin) * px;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, y, px, px, rr);
          else ctx.rect(x, y, px, px);                 // 老浏览器退化为方块
          ctx.fill();
        } else {
          ctx.fillRect((col + margin) * px, (row + margin) * px, px, px);
        }
      }
    }

    // 中心 Logo：会遮挡模块，因此必须靠更高纠错等级补偿（H 最稳）
    if (opts.logoText) {
      const box = Math.floor(side * 0.22);
      const bx = (side - box) / 2, by = (side - box) / 2;
      ctx.fillStyle = opts.light;
      ctx.fillRect(bx, by, box, box);
      ctx.fillStyle = opts.dark;
      ctx.font = `bold ${Math.floor(box * 0.52)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.logoText.slice(0, 4), side / 2, side / 2 + box * 0.02);
    }

    return cv;
  }

  /* ---------------- UI ---------------- */

  function ensurePanel() {
    let panel = $('#gen');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'gen';
    panel.className = 'card gen';
    panel.innerHTML = `
      <h2 data-i18n="gen.title">生成二维码</h2>
      <p class="hint" data-i18n="gen.lead">在浏览器内生成标准二维码（ISO/IEC 18004 公开规格），完全离线，内容不会上传。</p>
      <textarea id="genText" rows="3" placeholder="输入文本 / 链接 / 中文都可以"></textarea>
      <div class="gen-row">
        <label><span data-i18n="gen.ec">纠错等级</span>
          <select id="genEc">
            <option value="L">L（7%）</option>
            <option value="M" selected>M（15%，推荐）</option>
            <option value="Q">Q（25%）</option>
            <option value="H">H（30%，可加 Logo）</option>
          </select></label>
        <label><span data-i18n="gen.size">尺寸</span>
          <select id="genSize">
            <option value="256">256</option>
            <option value="512" selected>512</option>
            <option value="1024">1024</option>
          </select></label>
        <label><span data-i18n="gen.style">模块样式</span>
          <select id="genStyle">
            <option value="square" data-i18n="gen.styleSquare">方块（最易识别）</option>
            <option value="rounded" data-i18n="gen.styleRounded">圆角</option>
            <option value="dot" data-i18n="gen.styleDot">圆点</option>
          </select></label>
      </div>
      <div class="gen-row">
        <label><span data-i18n="gen.dark">前景色</span> <input id="genDark" type="color" value="#111827"></label>
        <label><span data-i18n="gen.light">背景色</span> <input id="genLight" type="color" value="#ffffff"></label>
        <label><span data-i18n="gen.margin">静区</span> <input id="genMargin" type="number" min="0" max="10" value="4" style="width:64px"></label>
        <label><input id="genLogo" type="checkbox"> <span data-i18n="gen.logo">中心加文字 Logo</span></label>
      </div>
      <div class="gen-actions">
        <button id="genGo" data-i18n="gen.go">生成</button>
        <button id="genDl" data-i18n="gen.download" disabled>下载 PNG</button>
        <span class="hint" id="genInfo"></span>
      </div>
      <p class="hint" id="genWarn" data-i18n="gen.scanWarn">提示：圆角样式与方块一样可扫；圆点样式已调成覆盖四角（内切圆会扫不出，实测过）。中心加 Logo 会遮挡模块，请用 H 级纠错并先试扫。</p>
      <div class="gen-preview"><canvas id="genCanvas"></canvas></div>
    `;
    // 挂到「生成」标签页的面板里（index.html 里预留的 #pane-gen）。
    // 之前是插进解析区，会把识别结果挤到折叠线以下，用户扫完看不到反馈。
    const pane = document.getElementById('pane-gen');
    if (pane) pane.appendChild(panel);
    else {
      const list = $('#list');
      if (list && list.parentNode) list.parentNode.insertBefore(panel, list.nextSibling);
      else document.body.appendChild(panel);
    }
    return panel;
  }

  function gather() {
    return {
      text: ($('#genText') || {}).value || '',
      ec: ($('#genEc') || {}).value || 'M',
      size: parseInt(($('#genSize') || {}).value || '512', 10),
      dotStyle: ($('#genStyle') || {}).value || 'square',
      dark: ($('#genDark') || {}).value || '#111827',
      light: ($('#genLight') || {}).value || '#ffffff',
      margin: Math.max(0, Math.min(10, parseInt(($('#genMargin') || {}).value || '4', 10))),
      logoText: ($('#genLogo') || {}).checked ? (($('#genText') || {}).value || '').trim().slice(0, 2) : '',
    };
  }

  function doGenerate() {
    const o = gather();
    const info = $('#genInfo');
    const btnDl = $('#genDl');
    if (!o.text.trim()) {
      if (info) info.textContent = T('gen.needText');
      if (btnDl) btnDl.disabled = true;
      return;
    }
    try {
      const qr = buildMatrix(o.text, o.ec);
      const n = qr.getModuleCount();
      const cv = render(qr, o);
      const target = $('#genCanvas');
      target.width = cv.width; target.height = cv.height;
      target.getContext('2d').drawImage(cv, 0, 0);
      lastCanvas = cv;
      if (btnDl) btnDl.disabled = false;
      if (info) {
        // 提示容量与"能否扫"的关键前提：静区与对比度
        info.textContent = T('gen.info', { v: ((n - 17) / 4 + 1), n: n, ec: o.ec });
      }
    } catch (e) {
      if (info) info.textContent = T('gen.fail') + (e.message || e);
      if (btnDl) btnDl.disabled = true;
    }
  }

  function doDownload() {
    if (!lastCanvas) return;
    try {
      const url = lastCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qrcode-' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* file:// 下 canvas 未污染，正常可用 */ }
  }

  function init() {
    const panel = ensurePanel();
    const go = () => doGenerate();
    ['#genText', '#genEc', '#genSize', '#genStyle', '#genDark', '#genLight', '#genMargin', '#genLogo']
      .forEach((s) => { const el = $(s); if (el) el.addEventListener('change', go); });
    const t = $('#genText');
    if (t) t.addEventListener('input', () => { if (t.value.length > 1) go(); });
    const gb = $('#genGo'); if (gb) gb.addEventListener('click', go);
    const db = $('#genDl'); if (db) db.addEventListener('click', doDownload);
    panel.setAttribute('data-ready', '1');
  }

  window.QRGen = { init, generate: doGenerate, buildMatrix, _render: render };
})();
