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
        } else if (opts.dotStyle === 'ringstyle') {
          // 「太阳码风格」但仍走**原始模块网格**：每个模块画成一个圆点，
          // 且**按到图像中心的距离决定点的大小**（越外圈越大），形成放射感。
          //
          // 系数是实测出来的（用 Python 端真解码器回环验证，不是估的）：
          //   最内圈半径 < 0.62r 时扫不出（我第一版就用了 0.62，失败）；
          //   扫参数得：最内圈 ≥ 0.65r、最外圈 ≤ 1.45r 时可扫。
          // 这里取 0.75r .. 1.20r，留出安全余量，同时保留明显的由内向外变化。
          const gx = (col + margin) * px + r;
          const gy = (row + margin) * px + r;
          const dx = gx - side / 2, dy = gy - side / 2;
          const t = Math.min(1, Math.hypot(dx, dy) / (side / 2));
          const rad = r * (0.75 + 0.45 * t);           // 0.75r .. 1.20r
          ctx.beginPath();
          ctx.arc(gx, gy, rad, 0, Math.PI * 2);
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

  /**
   * 绘制一朵"放射/圆环"装饰图（**不是真太阳码**，见下方说明）。
   *
   * 为什么不能生成真太阳码：微信小程序码的编码路径、32 个 mask 模板、元信息坐标、
   * 纠错多项式**全无公开文档**（官方原话"完全私有协议，只有微信可以生成，也只有微信可以解码"），
   * 本地无法编码。GitHub 上 20+ 个"生成器"项目也都是调微信官方接口或生成普通二维码。
   *
   * 所以这里做的是**装饰图案**：外观模仿太阳码（3 个圆环定位点 + 放射状数据带 + 中心圆），
   * 但它**不承载任何可解码数据**，任何扫码器都扫不出内容。
   * UI 里必须明确标注为「装饰图案」，不能让人误以为它是可用的码。
   */
  function renderSunDeco(opts) {
    const side = opts.size;
    const cv = document.createElement('canvas');
    cv.width = side; cv.height = side;
    const ctx = cv.getContext('2d');
    const cx = side / 2, cy = side / 2;
    const R = side * 0.46;                       // 码盘半径

    ctx.fillStyle = opts.light;
    ctx.fillRect(0, 0, side, side);

    // 码盘（浅色圆底）
    ctx.fillStyle = opts.softLight || '#f2f4f8';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = opts.dark;

    // 3 个圆环定位点（位于圆周上，间隔 120°）—— 模仿太阳码/小程序码的牛眼
    const eyeR = R * 0.17;
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + k * (2 * Math.PI / 3);
      const ex = cx + Math.cos(a) * (R - eyeR - side * 0.01);
      const ey = cy + Math.sin(a) * (R - eyeR - side * 0.01);
      // 外环
      ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = opts.light;
      ctx.beginPath(); ctx.arc(ex, ey, eyeR * 0.66, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = opts.dark;
      ctx.beginPath(); ctx.arc(ex, ey, eyeR * 0.34, 0, Math.PI * 2); ctx.fill();
    }

    // 放射状数据带：一圈圈圆点，角向密度随半径变化（观感接近太阳码的"花瓣"）
    const rnd = (function (seed) {                   // 固定序列的伪随机，保证每次生成一致
      let s = seed >>> 0;
      return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    })(opts.seed || 12345);

    const r0 = eyeR * 1.6, r1 = R * 0.86;
    const rows = 22;
    for (let i = 0; i < rows; i++) {
      const rr = r0 + (r1 - r0) * (i / (rows - 1));
      const cells = Math.max(8, Math.round(28 + i * 2.2));   // 越外圈分度越多
      const dotR = Math.max(1.1, (side / 260) * (0.55 + 0.5 * (i / rows)));
      for (let c = 0; c < cells; c++) {
        // 跳过会压到定位点的格子
        const a = (c / cells) * Math.PI * 2 + i * 0.07;
        const px2 = cx + Math.cos(a) * rr, py2 = cy + Math.sin(a) * rr;
        let hitEye = false;
        for (let k = 0; k < 3; k++) {
          const ak = -Math.PI / 2 + k * (2 * Math.PI / 3);
          const ex = cx + Math.cos(ak) * (R - eyeR - side * 0.01);
          const ey = cy + Math.sin(ak) * (R - eyeR - side * 0.01);
          if (Math.hypot(px2 - ex, py2 - ey) < eyeR * 1.25) { hitEye = true; break; }
        }
        if (hitEye) continue;
        if (rnd() < 0.46) continue;                  // 疏密
        ctx.beginPath(); ctx.arc(px2, py2, dotR, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 中心圆（头像区）
    ctx.fillStyle = opts.light;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.2, 0, Math.PI * 2); ctx.fill();
    if (opts.logoText) {
      ctx.fillStyle = opts.dark;
      ctx.font = `bold ${Math.floor(R * 0.2)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.logoText.slice(0, 2), cx, cy + R * 0.01);
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
            <option value="ringstyle" data-i18n="gen.styleRing">太阳码风格（放射圆点，仍可扫）</option>
          </select></label>
      </div>
      <div class="gen-row">
        <label data-i18n-title="gen.decoTip" title="生成一张外观模仿太阳码/菊花码的**装饰图案**。注意：它不是真太阳码（微信私有协议无法本地编码），不承载数据，扫不出内容。">
          <input id="genDeco" type="checkbox"> <span data-i18n="gen.deco">生成太阳码式装饰图案（不可扫，仅外观）</span></label>
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
      deco: !!($('#genDeco') || {}).checked,
    };
  }

  function doGenerate() {
    const o = gather();
    const info = $('#genInfo');
    const btnDl = $('#genDl');
    const warn = $('#genWarn');
    if (!o.text.trim()) {
      if (info) info.textContent = T('gen.needText');
      if (btnDl) btnDl.disabled = true;
      return;
    }
    try {
      let cv;
      if (o.deco) {
        // 装饰图案：外观像太阳码，但**不承载数据、扫不出**——必须显式提示
        cv = renderSunDeco({ size: o.size, dark: o.dark, light: o.light, logoText: o.logoText, seed: 20261006 });
        if (info) info.textContent = T('gen.decoInfo', { n: o.size });
        if (warn) { warn.textContent = T('gen.decoWarn'); warn.className = 'hint warn'; }
        $('#genCanvas').setAttribute('data-deco', '1');
      } else {
        const qr = buildMatrix(o.text, o.ec);
        const n = qr.getModuleCount();
        cv = render(qr, o);
        if (info) info.textContent = T('gen.info', { v: ((n - 17) / 4 + 1), n: n, ec: o.ec });
        if (warn) {
          warn.textContent = (o.dotStyle === 'ringstyle') ? T('gen.ringWarn') : T('gen.scanWarn');
          warn.className = 'hint';
        }
        $('#genCanvas').removeAttribute('data-deco');
      }
      const target = $('#genCanvas');
      target.width = cv.width; target.height = cv.height;
      target.getContext('2d').drawImage(cv, 0, 0);
      lastCanvas = cv;
      if (btnDl) btnDl.disabled = false;
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
    ['#genText', '#genEc', '#genSize', '#genStyle', '#genDark', '#genLight', '#genMargin', '#genLogo', '#genDeco']
      .forEach((s) => { const el = $(s); if (el) el.addEventListener('change', go); });
    const t = $('#genText');
    if (t) t.addEventListener('input', () => { if (t.value.length > 1) go(); });
    const gb = $('#genGo'); if (gb) gb.addEventListener('click', go);
    const db = $('#genDl'); if (db) db.addEventListener('click', doDownload);
    panel.setAttribute('data-ready', '1');
  }

  window.QRGen = { init, generate: doGenerate, buildMatrix, _render: render };
})();
