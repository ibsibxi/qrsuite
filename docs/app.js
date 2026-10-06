/*! QRSuite v2 · 前端逻辑
 *  健壮性设计（v2.0.1 修复）：
 *   1) 先绑定 UI 事件，再做任何可能抛异常的初始化 —— 避免一处失败导致"拖拽/选择全失效"
 *   2) Worker 不可用（file:// 下 origin 'null' 会抛 SecurityError）时自动回退主线程解码
 *   3) 顶部状态条明示运行环境，失败不再静默
 */
'use strict';
const $ = s => document.querySelector(s);
const listEl = $('#list'), dropEl = $('#drop'), fileEl = $('#file'), statEl = $('#stats'), envEl = $('#env');

/* 多语言：i18n.js 先于本文件加载；缺失时退化为原中文（不影响功能） */
const T = (k, v) => (window.QRi18n ? window.QRi18n.t(k, v) : k);

/* 内置自检二维码：data URI 形式，file:// 下也不会污染 canvas，可安全 getImageData */
const SELFTEST_QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAK4AAACuCAAAAACKZ2kyAAACEklEQVR4nO3cwY6jMBAA0XJp/v+XvYe5IEVEJjvRTJm8EwLHiVqiaRqcMSmRFEmRFEmRFEmRFEmRFEmRFEmRFEmRFEmRFEmRFEmRFEmRlK+zA2N5inkYf9w+Ott/Zu4RXUmRFEmRPTLDt+f9yfF05HwYc3XOfHQlRVIkRXbKDCyf3ev1AC9ljGR0JUVSJEX2ywwr5nItcaPoSoqkSIrcMzM85oTxhvwQi66kSIqkyH6ZYS6MuZoHJjeIrqRIiqTITplhXJzu7DnF/I85w9GVFEmRFEkZP9sHeF+HIRldSZEUSZE9MsN4et0/jmGhKpgnM69/VzK6kiIpkiI71Qxj4R5hvU4YD3uuzhCLrqRIiqTITjUDC9f39TchX8sG4ehKiqRIiuzRgZyH8/fsLF5553lePPq5m/g9kiIpsutTy3Gx/zBPto9z8nR/PrqSIimSIvd8NjGW+4rj4bOfu4m/QVIkRe651vJopZbgpA7ZKrqSIimSIndeazlOPjUfxp/N9rmb+D2SIilyz7WWr3UU52HMhtGVFEmRFEn5+tnpzvoJ42T7e+Snz/A3SIqkyD0zw7j43uNrNUksupIiKZIi91xrOZ92FOfJ/rNOxSbRlRRJkRS551rLcfG/nsbT96k2ia6kSIqkyJ3XWr6bpEiKpEiKpEiKpEiKpEiKpEiKpEiKpEiKpEiKpEiKpEiKv/0DrvkHvhNbb+6MR/YAAAAASUVORK5CYII=';
const MODES = { fast: 2, balanced: 7, deep: 99 };
let MODE = 'balanced';
let workerPool = null;      // null = 不可用，走主线程
let backendOK = false;      // 本机 Python 后端可用？
let ready = false;          // UI 是否已绑定

/* ============================ 状态提示 ============================ */
function banner(msg, kind = 'warn') {
  if (!envEl) { console.warn('[QRSuite]', msg); return; }
  const cls = kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : 'warn';
  const old = envEl.dataset.keep === '1' ? envEl.innerHTML + '<br>' : '';
  envEl.innerHTML = old + `<span class="${cls}">${msg}</span>`;
}
function envInfo() {
  const proto = location.protocol;
  const parts = [T('env.proto', { p: proto })];
  parts.push(workerPool ? T('env.workerOk', { n: workerPool.length }) : T('env.workerNo'));
  parts.push(T('env.engines', { e: (window.QRCascade ? 'jsQR+ZXing-js' : T('env.notLoaded')) }));
  if (proto === 'file:') parts.push(T('env.fileHint'));
  if (backendOK) parts.push(T('env.backendOk'));
  return parts.join(' · ');
}
function refreshEnv() { if (envEl) envEl.innerHTML = envInfo(); }

/* ============================ 1. 先绑定 UI（绝不依赖后续初始化） ============================ */
function handleFiles(files) {
  const imgs = [...files].filter(f => (f.type && f.type.startsWith('image/')) || /\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(f.name || ''));
  if (!imgs.length) { banner(T('err.noImages'), 'err'); return; }
  banner(T('msg.received', { n: imgs.length }), 'ok');
  imgs.forEach(decodeFile);
}

function bindUI() {
  if (ready) return;
  ready = true;

  ['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropEl.classList.add('hot');
  }, false));
  ['dragleave', 'dragend'].forEach(ev => document.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragleave' && e.relatedTarget) return;
    dropEl.classList.remove('hot');
  }, false));
  document.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    dropEl.classList.remove('hot');
    const dt = e.dataTransfer;
    if (!dt) return;
    let files = [...(dt.files || [])];
    if (!files.length && dt.items) files = [...dt.items].map(i => i.getAsFile()).filter(Boolean);
    handleFiles(files);
  }, false);

  dropEl.addEventListener('click', () => fileEl.click());
  dropEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileEl.click(); });
  fileEl.addEventListener('change', () => { handleFiles([...fileEl.files]); fileEl.value = ''; });

  document.addEventListener('paste', e => {
    const items = [...((e.clipboardData || {}).items || [])].filter(i => i.type && i.type.startsWith('image/'));
    if (items.length) handleFiles(items.map(i => i.getAsFile()).filter(Boolean));
  });

  $('#mode').addEventListener('change', () => { MODE = $('#mode').value; });
  $('#selftest').addEventListener('click', () => runSelfTest(true));
  $('#exp-json').addEventListener('click', () => download('qrsuite-history.json', JSON.stringify(hist(), null, 2)));
  $('#exp-csv').addEventListener('click', () => {
    const rows = [['time', 'file', 'format', 'text', 'engines']].concat(hist().map(r =>
      [new Date(r.t).toLocaleString(), r.name, r.format, r.text, (r.engines || []).join('|')]));
    download('qrsuite-history.csv', '\ufeff' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
  });
  $('#clear').addEventListener('click', () => { if (confirm(T('hist.confirmClear'))) { localStorage.removeItem(HKEY); renderHistory(); } });
  window.addEventListener('error', e => banner(T('err.script', { msg: (e.message || e.error) }), 'err'));
}

/* ============================ 2. 解码执行器（Worker 优先，主线程兜底） ============================ */
const pending = new Map();
let seq = 0, rr = 0;

function initWorkers() {
  if (typeof Worker === 'undefined') throw new Error(T('err.noWorker'));
  if (location.protocol === 'file:') throw new Error(T('err.fileWorker'));
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const pool = [];
  for (let i = 0; i < n; i++) {
    const w = new Worker('decode.worker.js');
    w.onmessage = e => { const t = pending.get(e.data.id); if (t) { pending.delete(e.data.id); t(e.data); } };
    w.onerror = e => banner(T('err.worker', { msg: (e.message || '') }), 'err');
    pool.push(w);
  }
  return pool;
}

function decodeViaWorker(rgba, w, h, mode, verify) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const worker = workerPool[rr++ % workerPool.length];
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(T('err.workerTimeout'))); }, 60000);
    pending.set(id, r => { clearTimeout(timer); r.ok ? resolve(r) : reject(new Error(r.error)); });
    worker.postMessage({ id, buf: rgba.buffer.slice(0), w, h, mode, verify });
  });
}

function decodeViaMainThread(rgba, w, h, mode, verify) {
  if (!window.QRCascade) return Promise.reject(new Error(T('err.cascadeMissing')));
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { const r = window.QRCascade.decode(new Uint8ClampedArray(rgba.buffer), w, h, mode, verify); r.ok = true; resolve(r); }
      catch (e) { reject(e); }
    }, 0);
  });
}

/* ============================ 3. 取像素 ============================ */

/**
 * 分辨率归一化档位。
 *
 * 为什么需要：以前是 `drawImage(src,0,0)` 直接按原尺寸解码 ——
 *  · 手机 48MP 照片会以全分辨率跑 18 种变体级联，内存与耗时都爆炸（低端机可能白屏）；
 *  · 而小图（远景二维码、缩略图）又太小，模块只剩两三个像素，任何引擎都判不出。
 * 所以这里做**双向**归一化：小图放大到下限、超大图压到上限。
 *
 * minSide 的取值依据（实测）：微信族牛眼细环在小于 ~700px 长边时会被打碎，
 * 普通二维码模块需要 ≥3px 才稳；放大到 1100~1600 能救回相当一部分远景码。
 */
const RES_PROFILE = {
  fast:     { maxSide: 2000, minSide: 900,  deepUpscale: false },
  balanced: { maxSide: 2400, minSide: 1100, deepUpscale: false },
  deep:     { maxSide: 3200, minSide: 1600, deepUpscale: true },
};

/**
 * 由「模式 + 高清开关」决定分辨率档位。
 *
 * 设计意图：普通扫描路径**默认完全不变**（fast/balanced 保持原档位），
 * 只有用户显式打开"深度扫描"才走高分辨率档，这样不会为了极少数难图拖慢日常使用。
 */
function resolveProfile(mode, hd) {
  const base = RES_PROFILE[mode] || RES_PROFILE.balanced;
  if (!hd) return base;
  return {
    maxSide: Math.max(base.maxSide, RES_PROFILE.deep.maxSide),   // 3200
    minSide: Math.max(base.minSide, RES_PROFILE.deep.minSide),   // 1600
    deepUpscale: true,
  };
}

function normalizeCanvas(srcW, srcH, profile) {  const long0 = Math.max(srcW, srcH);
  let scale = 1;
  if (long0 > profile.maxSide) scale = profile.maxSide / long0;            // 压上限
  else if (profile.deepUpscale && long0 < profile.minSide) {               // 无损放大（深扫）
    scale = Math.min(profile.minSide / long0, 3);                         // 最多放 3 倍，避免糊
  }
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  return { w, h, scale, changed: scale !== 1 };
}

async function fileToRGBA(file, mode, hd) {
  let bitmap = null, img = null;
  try {
    if (typeof createImageBitmap === 'function') bitmap = await createImageBitmap(file);
  } catch (e) { bitmap = null; }
  if (!bitmap) {
    img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error(T('err.imgDecode')));
      i.src = URL.createObjectURL(file);
    });
  }
  const src = bitmap || img, sw = src.width, sh = src.height;
  const profile = resolveProfile(mode, hd);
  const norm = normalizeCanvas(sw, sh, profile);
  const w = norm.w, h = norm.h;

  let ctx;
  if (typeof OffscreenCanvas !== 'undefined') {
    ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  } else {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    ctx = cv.getContext('2d', { willReadFrequently: true });
  }
  if (norm.changed) {
    // 压上限用高质量降采样；放大用双线性即可（二维码是硬边，过度插值反而糊）
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = norm.scale < 1 ? 'high' : 'low';
  }
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  if (bitmap && bitmap.close) try { bitmap.close(); } catch (e) { }
  if (img) URL.revokeObjectURL(img.src);
  return { rgba: data, w, h, srcW: sw, srcH: sh, scale: norm.scale };
}

/* ============================ 4. 主流程 ============================ */
async function decodeFile(file) {
  // 结果只出现在「解析」页，所以先切回去，否则用户会以为没反应
  if (window.__qrShowDecodeTab) window.__qrShowDecodeTab();
  const card = makeCard(file);
  const t0 = performance.now();
  try {
    const hd = !!(document.getElementById('hdscan') || {}).checked;
    const { rgba, w, h, srcW, srcH, scale } = await fileToRGBA(file, MODE, hd);
    const useWorker = !!workerPool;
    let res = useWorker
      ? await decodeViaWorker(rgba, w, h, MODE, $('#verify').checked)
      : await decodeViaMainThread(rgba, w, h, MODE, $('#verify').checked);

    // 客户端异形码判定：只在**标准解码全部失败**时才跑（与后端同一策略）。
    // 这样普通二维码的快速路径完全不受影响；而异形码本来就是"解不出"的，
    // 用户此时最需要的就是"这是哪一家的码、该用哪个 App 扫"。
    if (window.QRStylized && window.QRStylized.classify) {
      try {
        const st = window.QRStylized.classify(rgba, w, h);
        res.stylized = st;
      } catch (e) {
        console.warn('[QRSuite] 异形码判定失败', e);
      }
    }

    if (backendOK && $('#backend').checked) {
      const br = await fetch('/api/decode', {
        method: 'POST', body: file, headers: {
          'X-Filename': encodeURIComponent(file.name || 'clipboard.png'),
          'X-Mode': MODE, 'X-Verify': $('#verify').checked ? '1' : '0'
        }
      }).then(r => r.json()).catch(() => null);
      if (br && br.ok) res = mergeBackend(res, br);
    }
    res.width = w; res.height = h; res.viaWorker = useWorker;
    render(card, res, (performance.now() - t0) / 1000, file);
  } catch (err) {
    card.querySelector('.meta').className = 'meta err';
    card.querySelector('.meta').textContent = '❌ ' + (err && err.message || err);
    banner(T('err.decode', { msg: (err && err.message || err) }), 'err');
  }
}

function mergeBackend(js, py) {
  const hits = new Map();
  for (const h of js.hits) hits.set(h.text, { text: h.text, format: h.format, engines: new Set(h.engines), variants: new Set(h.variants), is_binary: !!h.is_binary });
  for (const h of py.results) {
    const cur = hits.get(h.text) || { text: h.text, format: h.format, engines: new Set(), variants: new Set(), is_binary: !!h.is_binary };
    // 后端 (Python) 会给出权威的二进制判定：任一来源判为二进制即标记为二进制
    if (h.is_binary) cur.is_binary = true;
    h.engines.forEach(e => cur.engines.add('py:' + e));
    h.variants.forEach(v => cur.variants.add(v));
    hits.set(h.text, cur);
  }
  return Object.assign({}, js, {
    hits: [...hits.values()].map(v => ({ text: v.text, format: v.format, engines: [...v.engines], variants: [...v.variants], is_binary: v.is_binary })),
    backend: true
  });
}

/**
 * 前端二进制判定（后端不可用时的兜底）。
 *
 * 与 Python 侧 qrsuite/binary.py 的判据保持一致：
 *   · 含 NUL → 二进制
 *   · zxing-cpp 的转义文本形态（"<SOH>"/"<U+81>"）→ 二进制
 *   · 控制字符占比 > 10% → 二进制
 *   · U+0080..U+00FF（字节被单字节直译的痕迹）占比 > 3% 且无 CJK → 二进制
 * 目的：乘车码这类 payload 直接按文本渲染就是乱码，会被误认为"解析失败"。
 */
function isBinaryText(s) {
  if (!s) return false;
  if (s.indexOf('\u0000') >= 0) return true;
  if (/<(?:U\+[0-9A-Fa-f]{2,6}|NUL|SOH|STX|ETX|EOT|ENQ|ACK|BEL|BS|HT|LF|VT|FF|CR|SO|SI|DLE|DC[1-4]|NAK|SYN|ETB|CAN|EM|SUB|ESC|FS|GS|RS|US|DEL)>/.test(s)) return true;
  let ctrl = 0, nonAscii = 0, latin1 = 0, cjk = 0;
  for (let i = 0; i < s.length; i++) {
    const o = s.charCodeAt(i);
    const c = s[i];
    if (c === '\t' || c === '\n' || c === '\r') continue;
    if (o === 0xFFFD) return true;
    if (o >= 0x4E00 && o <= 0x9FFF) { cjk++; nonAscii++; }
    else if (o >= 0x3040 && o <= 0x30FF) { cjk++; nonAscii++; }
    else if (o >= 0x80 && o <= 0xFF) { latin1++; nonAscii++; }
    else if (o < 32 || o === 127 || (o >= 0xDC80 && o <= 0xDCFF)) ctrl++;
    else if (o > 127) nonAscii++;
  }
  const n = s.length;
  if (ctrl / n > 0.10) return true;
  if (latin1 / n > 0.03 && cjk === 0) return true;
  if ((nonAscii + ctrl) / n > 0.05 && ctrl > 0 && cjk === 0) return true;
  if (nonAscii / n > 0.80 && cjk === 0) return true;
  return false;
}

/** 把二进制 payload 还原成**真正可读**的片段。
 *
 *  过滤很重要：二进制里随便一段字母数字混合的短串（如 "We~?z%?5"）没有信息量，
 *  直接展示只会让用户觉得还是乱码。只保留两类高置信片段：
 *    ① 长度 ≥ 8 的纯数字串（凭证 ID、票号）
 *    ② 长度 ≥ 12 且字母数字占比 ≥ 85% 的串（订单号、编码）
 *  另外剔除含转义记号（<SOH>/<U+81>）与问号占位的片段。
 */
function binaryRuns(s, limit) {
  const out = [];
  const seen = new Set();
  let bytes = '';
  for (let i = 0; i < s.length; i++) {
    const o = s.charCodeAt(i);
    if (o >= 0xDC80 && o <= 0xDCFF) bytes += String.fromCharCode(o - 0xDC00);
    else if (o <= 0xFF) bytes += String.fromCharCode(o);
    else bytes += '?';
  }
  const re = /[\x20-\x7e]{6,}/g;
  let m;
  while ((m = re.exec(bytes)) !== null) {
    const r = m[0];
    if (seen.has(r)) continue;
    if (/[?]/.test(r)) continue;                                  // 含占位符，说明有非 ASCII 混杂
    if (/<[A-Z][A-Z0-9]{1,5}>/.test(r) || /<U\+[0-9A-Fa-f]{2,6}>/.test(r)) continue;
    const digits = (r.match(/\d/g) || []).length;
    const alnum = (r.match(/[A-Za-z0-9]/g) || []).length;
    // ① 从片段里优先抽出纯数字子串（最可能是凭证 ID / 票号），
    //    这样 "2088732564945072j" 这种带尾巴的也能规整成干净 ID
    const num = r.match(/\d{8,}/);
    if (num) {
      if (seen.has(num[0])) continue;
      seen.add(num[0]);
      out.push(num[0]);
      if (out.length >= (limit || 4)) break;
      continue;
    }
    if (r.length >= 12 && alnum / r.length >= 0.85) {     // ② 长字母数字串（订单号之类）
      seen.add(r);
      out.push(r);
      if (out.length >= (limit || 4)) break;
    }
  }
  return out;
}

/** 计算 payload 的字节数与可打印占比（用于展示"这是二进制"的证据）。 */
function binaryStats(s) {
  let n = 0, printable = 0;
  for (let i = 0; i < s.length; i++) {
    const o = s.charCodeAt(i);
    if (o >= 0xDC80 && o <= 0xDCFF) { n++; continue; }
    if (o <= 0xFF) { n++; if (o >= 32 && o < 127) printable++; }
    else { n += 3; }                       // CJK 等按 UTF-8 3 字节粗估
  }
  return { bytes: n, printableRatio: n ? printable / n : 0 };
}

/* ============================ 5. 渲染 ============================ */
function makeCard(file) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<img class="thumb" alt=""><div class="cnt">
      <div class="fname"></div><div class="meta spin"></div><div class="body"></div></div>`;
  el.querySelector('.meta').textContent = T('msg.decoding');
  el.querySelector('.fname').textContent = file.name || 'clipboard.png';
  el.querySelector('.thumb').src = URL.createObjectURL(file);
  listEl.prepend(el);
  return el;
}

function render(card, res, total, file) {
  const meta = card.querySelector('.meta'), body = card.querySelector('.body');
  const tag = (res.backend ? T('tag.backend') : '') + (res.viaWorker === false ? T('tag.mainThread') : '');
  if (!res.ok) { meta.className = 'meta err'; meta.textContent = '❌ ' + (res.error || T('err.decodeShort')); return; }
  if (!res.hits.length) {
    meta.className = 'meta err';
    meta.textContent = T('meta.notDecoded', { w: res.width, h: res.height, stages: res.stages, ms: (total * 1000).toFixed(0), tag: tag });
    // 后端附带的"样式化私有码"结构判定（微信小程序码/赞赏码、抖音主页码）：
    // 这类码是平台私有格式，无法离线解出内容，只能告诉用户用对应 App 扫。
    //
    // 注意：只在判定**可用**时才渲染。classify() 对绝大多数图返回 kind='unknown'
    // （label 是"未识别的样式化码"、hint 为空），若不加这个条件，普通二维码解不出时
    // 会多出一个"0% 置信度、无提示"的空块，纯属噪音。
    const st = res.stylized;
    if (st && st.kind && st.kind !== 'unknown' && st.hint && st.confidence >= 0.5) {
      const g = st.geometry || {};
      const bits = [];
      if (g.n_eyes) bits.push(T('stylized.eyes', { n: g.n_eyes }));
      if (g.center) bits.push(T('stylized.center', { x: g.center[0], y: g.center[1] }));
      if (g.est_lines) bits.push(T('stylized.lines', { n: Math.round(g.est_lines) }));
      if (g.angular_div && g.angular_div.div) bits.push(T('stylized.div', { n: g.angular_div.div }));
      const d = document.createElement('div');
      d.className = 'res stylized';
      d.innerHTML = `<div><span class="badge f"></span><span class="badge g"></span>` +
        `<span class="badge cat"></span></div>` +
        `<div class="val"></div>` + (bits.length ? `<div class="dim"></div>` : '');
      d.querySelector('.badge.f').textContent = st.label;
      d.querySelector('.badge.g').textContent = (st.confidence * 100).toFixed(0) + '%';
      // 单独分类标记：让"异形码识别"与普通解码结果在视觉上分开
      d.querySelector('.badge.cat').textContent = T('stylized.cat');
      d.querySelector('.val').textContent = st.hint || '';
      if (bits.length) d.querySelector('.dim').textContent = bits.join(' · ');
      body.appendChild(d);
    }
    return;
  }
  stat.n++; stat.ok++; stat.ms += total * 1000; bumpStats();
  meta.textContent = T('meta.decoded', {
    w: res.width, h: res.height, n: res.hits.length, ms: (total * 1000).toFixed(0),
    stages: res.stages, early: res.early ? T('meta.early') : '', tag: tag
  });
  res.hits.forEach(h => {
    // 二进制 payload（乘车码/令牌这类）：直接按文本渲染就是满屏控制字符，
    // 用户会误以为"没解析出来"。这里改为明确标注 + 给出可读片段。
    const isBin = (h.is_binary !== undefined) ? !!h.is_binary : isBinaryText(h.text);
    const d = document.createElement('div');
    d.className = 'res' + (isBin ? ' binary' : '');
    d.innerHTML = `<div><span class="badge f"></span>${h.engines.map(e => `<span class="badge g">${e}</span>`).join('')}` +
      `${h.variants.slice(0, 4).map(v => `<span class="badge">${v}</span>`).join('')}` +
      (isBin ? `<span class="badge cat"></span>` : '') + `</div>
      <div class="val"></div><div class="row"><button class="b-copy"></button><button class="b-open"></button></div>`;
    d.querySelector('.badge.f').textContent = h.format;
    if (isBin) {
      const st = binaryStats(h.text);
      const runs = binaryRuns(h.text, 4);
      d.querySelector('.badge.cat').textContent = T('binary.tag');
      let note = T('binary.note', { n: st.bytes, p: Math.round(st.printableRatio * 100) });
      if (runs.length) note += '\n' + T('binary.runs') + ' ' + runs.join(' | ');
      d.querySelector('.val').textContent = note;
    } else {
      d.querySelector('.val').textContent = h.text;
    }
    const [b1, b2] = d.querySelectorAll('button');
    b1.textContent = T('btn.copy');
    // 二进制没有可打开的链接，隐藏"打开"按钮
    if (isBin) { b2.style.display = 'none'; } else { b2.textContent = T('btn.open'); }
    b1.onclick = () => { navigator.clipboard.writeText(h.text).catch(() => { }); b1.textContent = T('btn.copied'); setTimeout(() => b1.textContent = T('btn.copy'), 1200); };
    b2.onclick = () => window.open(h.text, '_blank');
    body.appendChild(d);
    history_add({ name: file.name || 'clipboard', format: h.format, text: h.text, engines: h.engines, file: file.size, binary: isBin });
  });
}

/* ============================ 6. 历史 ============================ */
const HKEY = 'qrsuite.history';
function hist() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } }
function history_add(rec) {
  const h = hist(); h.unshift(Object.assign({ t: Date.now() }, rec));
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 200))); } catch (e) { }
  renderHistory();
}
function renderHistory() {
  const h = hist();
  const hint = $('#hhint');
  if (hint) hint.textContent = T('hist.hint', { n: h.length });
  const old = $('#hcount'); if (old) old.textContent = h.length;   // 兼容旧标记
  $('#hlist').innerHTML = h.slice(0, 30).map(r => {
    // 二进制历史不能直接显示原文（会是一行乱码）：改为标注 + 可读片段。
    // r.binary 是新记录带的标记；旧记录则实时判定一次。
    const isBin = (r.binary !== undefined) ? !!r.binary : isBinaryText(r.text);
    let shown;
    if (isBin) {
      const runs = binaryRuns(r.text, 2);
      shown = runs.length ? runs.join(' | ') : T('binary.nameOnly');
    } else {
      shown = r.text;
    }
    return `<div class="hrow"><span class="badge f">${r.format}</span>` +
      (isBin ? `<span class="badge cat">${esc(T('binary.tag'))}</span>` : '') +
      `<span class="hname">${esc(r.name)}</span>
      <span class="hval" title="${esc(T('hist.copyTitle'))}">${esc(shown)}</span>
      <button data-copy="${encodeURIComponent(r.text)}">${esc(T('btn.copy'))}</button></div>`;
  }).join('');
  $('#hlist').querySelectorAll('button[data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(decodeURIComponent(b.dataset.copy)).catch(() => { }); b.textContent = '✓';
  });
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ============================ 7. 统计 ============================ */
const stat = { n: 0, ok: 0, ms: 0 };
function bumpStats() {
  statEl.textContent = stat.n ? T('stat.summary', { n: stat.n, ok: stat.ok, ms: (stat.ms / stat.n).toFixed(0) }) : '';
}

/* ============================ 8. 自检（内置二维码图 → 像素 → 解码，全链路） ============================ */
async function runSelfTest(verbose) {
  const out = [];
  const ok = (name, cond, extra) => { out.push(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); return cond; };
  ok(T('st.protocol'), true, location.protocol);
  ok(T('st.decodeJs'), !!window.QRCascade, window.QRCascade ? T('st.decodeJsOk') : T('st.missing'));
  ok(T('st.dragBound'), ready, ready ? T('st.dragOk') : T('st.dragNo'));
  const isFile = location.protocol === 'file:';
  ok(T('st.worker'), !!workerPool || isFile,
     workerPool ? T('st.workerN', { n: workerPool.length }) : (isFile ? T('st.workerFile') : T('st.workerFallback')));
  ok(T('st.sw'), 'serviceWorker' in navigator, location.protocol.startsWith('http') ? T('st.swOk') : T('st.swNa'));

  let text = null, via = '';
  try {
    // 用 <img> 加载（file:// 下 fetch 本地文件被浏览器禁止，<img> 可以）
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error(T('err.selfTestImg')));
      i.src = SELFTEST_QR;
    });
    let ctx;
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(img.width, img.height).getContext('2d');
    else { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; ctx = cv.getContext('2d'); }
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, img.width, img.height);
    const t0 = performance.now();
    const r = workerPool ? await decodeViaWorker(rgba.data, img.width, img.height, 'fast', false)
                         : await decodeViaMainThread(rgba.data, img.width, img.height, 'fast', false);
    const ms = (performance.now() - t0).toFixed(0);
    text = r.hits.length ? r.hits[0].text : null;
    via = `${r.stages} / ${ms}ms / ${workerPool ? 'Worker' : 'main'}`;
    ok(T('st.e2e'), text === 'QRSUITE-SELFTEST-OK', text ? T('st.e2eOk', { text: text, via: via }) : T('st.e2eNo'));
  } catch (e) { ok(T('st.e2e'), false, String(e)); }

  const pass = out.every(l => l.startsWith('✓'));
  const report = T('selftest.title', { result: pass ? T('selftest.pass') : T('selftest.fail') }) + out.join('; ');
  statEl.textContent = report;
  banner(T('selftest.banner', {
    result: pass ? '<b class="ok">' + T('selftest.pass') + '</b>' : '<b class="err">' + T('selftest.fail') + '</b>',
    detail: out.join('; ')
  }), pass ? 'ok' : 'err');
  if (verbose) console.log(report);
  return pass;
}

/* ============================ 9. 启动 ============================ */
bindUI();                                    // ← 先绑定，任何后续失败都不影响交互
try { if (window.QRGen) window.QRGen.init(); } catch (e) { console.warn('[QRSuite] 生成板块初始化失败', e); }

/* ---------------- 标签页：解析 / 生成 ---------------- */
function setTab(name) {
  const isGen = (name === 'gen');
  const td = document.getElementById('tab-decode'), tg = document.getElementById('tab-gen');
  const pd = document.getElementById('pane-decode'), pg = document.getElementById('pane-gen');
  if (!td || !tg || !pd || !pg) return;
  td.classList.toggle('on', !isGen); tg.classList.toggle('on', isGen);
  td.setAttribute('aria-selected', String(!isGen));
  tg.setAttribute('aria-selected', String(isGen));
  pd.classList.toggle('on', !isGen); pg.classList.toggle('on', isGen);
  try { localStorage.setItem('qrsuite.tab', isGen ? 'gen' : 'decode'); } catch (e) { }
}
(function initTabs() {
  const td = document.getElementById('tab-decode'), tg = document.getElementById('tab-gen');
  if (td) td.addEventListener('click', () => setTab('decode'));
  if (tg) tg.addEventListener('click', () => setTab('gen'));
  let saved = 'decode';
  try { saved = localStorage.getItem('qrsuite.tab') || 'decode'; } catch (e) { }
  setTab(saved);
})();
// 解码开始时自动切回「解析」页，否则用户点了生成页再拖图会看不到结果
window.__qrShowDecodeTab = () => setTab('decode');
try {
  workerPool = initWorkers();
} catch (e) {
  workerPool = null;
  banner(T('msg.workerFallback', { msg: e.message }), 'warn');
}
refreshEnv();
renderHistory();

(async () => {
  try {
    const r = await fetch('/health', { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    backendOK = !!(j && j.ok);
    if (backendOK) {
      $('#backend-row').style.display = '';
      $('#backend-engines').textContent = (j.engines || []).join(' / ');
      refreshEnv();
    }
  } catch (e) { /* file:// 或纯静态部署：正常情况 */ }
})();

if (location.search.includes('selftest=1')) setTimeout(() => runSelfTest(true), 300);

/* PWA：可安装到桌面/手机，离线可用（仅 http(s) 生效） */
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
window.QRS = { runSelfTest, decodeFile, handleFiles, get workerOk() { return !!workerPool; } };

/* 切换语言后重刷动态文案（静态文案由 i18n.js 的 apply 负责） */
window.onLangChange = function () {
  refreshEnv();
  renderHistory();
  bumpStats();
  // 结果卡片里的按钮文案
  document.querySelectorAll('#list .res').forEach(card => {
    const bs = card.querySelectorAll('button');
    if (bs.length >= 2) { bs[0].textContent = T('btn.copy'); bs[1].textContent = T('btn.open'); }
  });
};
