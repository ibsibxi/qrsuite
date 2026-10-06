/*!
 * QRSuite v2 · stylized.js —— "样式化私有码"的结构识别与几何测量（浏览器端）
 *
 * 从 qrsuite/stylized.py **逐字移植**（不做"思路参考"）。它回答的问题是：
 *   这张图是不是微信小程序码 / 微信赞赏码 / 抖音主页码？几何参数是什么？
 * 不做 payload 解码 —— 这三类码协议私有、规格未公开，任何公开引擎都解不出内容。
 *
 * 设计约束（与 docs/decode.js 相同）：
 *   · 纯静态、无构建步骤、无 CDN、无网络请求，可 file:// 直接打开；
 *   · 无 DOM 依赖，可在 Web Worker 中运行，也可在 Node 中 require 做离线回归；
 *   · 输入为 RGBA（Uint8ClampedArray，网页端既有约定）。
 *
 * 移植时踩过/遵守的关键点（详见各函数内注释）：
 *   1. 必须在**原分辨率**上检测，调用方缩过的图不要在这里再缩（牛眼细环会被缩碎）；
 *   2. _find_bullseyes 的稠密环带搜索**绝对不能跳过**，即使它没增加候选数；
 *   3. _bullseye_verify 的中心 8 点预筛是性能关键（原占 ~90% 耗时），必须保留；
 *   4. _pick_four 的候选池逻辑 pool[:12] 不可改；
 *   5. 连通域必须 8 连通、面积/包围盒/像素索引质心，与 cv2.connectedComponentsWithStats 等价；
 *   6. 微信族有**硬门槛**：角向分度必须测得出且落在 30~80 格/圈且 peak ≥ 0.60。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRStylized = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ 常量 */

  var KIND_LABELS = {
    'douyin_profile': '抖音主页码',
    'wechat_miniprogram': '微信小程序码',
    'wechat_reward': '微信赞赏码',
    'unknown': '未识别的样式化码'
  };

  var HINTS = {
    'douyin_profile': '这是抖音主页码（平台私有格式，无法离线解出内容）。请打开抖音 App「扫一扫」识别。',
    'wechat_miniprogram': '这是微信小程序码（平台私有格式，无法离线解出内容）。请用微信「扫一扫」识别。',
    'wechat_reward': '这是微信赞赏码（平台私有格式，且涉及支付，无法离线解出内容）。请用微信「扫一扫」识别。',
    'unknown': ''
  };

  /** 给最终用户的一句话提示（用于解码失败的场景）。对应 Python 的 hint()。 */
  function hint(info) {
    return HINTS[(info && info.kind) || 'unknown'] || '';
  }

  /* ------------------------------------------------------------------ 数值工具 */

  function _unknown(W, H, notes) {
    return {
      kind: 'unknown', confidence: 0.0,
      label: KIND_LABELS['unknown'], hint: HINTS['unknown'],
      geometry: { image: [W, H] }, notes: notes
    };
  }

  /**
   * Python 的 round(x, nd)。
   * Python 是"就近取整、平局取偶"（且作用于 double 的真实二进制值），
   * JS 的 toFixed 是平局进位，因此这里显式实现取偶分支。
   */
  function _round(x, nd) {
    if (!isFinite(x)) return x;
    var f = Math.pow(10, nd);
    var y = x * f;
    var fl = Math.floor(y);
    if (y - fl === 0.5) return (fl % 2 === 0 ? fl : fl + 1) / f;
    return Math.round(y) / f;
  }

  /** Python 的 int(round(x))：平局取偶。 */
  function _iround(x) {
    var fl = Math.floor(x);
    if (x - fl === 0.5) return (fl % 2 === 0) ? fl : fl + 1;
    return Math.round(x);
  }

  function _f4(v) { return _round(v, 4).toFixed(4); }
  function _f2(v) { return _round(v, 2).toFixed(2); }
  function _f3(v) { return _round(v, 3).toFixed(3); }
  function _f1(v) { return _round(v, 1).toFixed(1); }

  /* ------------------------------------------------------------------ 检测内核 */

  /**
   * 对应 cv2.cvtColor(rgb, COLOR_RGB2GRAY)。
   *
   * 系数是用穷举反推出来的 OpenCV 8U 定点实现（60000 随机像素 0 误差）：
   *   y = (R*19596 + G*38470 + B*7470 + 32768) >> 16
   * 注意：0.299/0.587/0.114 的浮点写法会有 ~0.15% 像素差 1 级，
   * 而 gray 直接参与 <128 判据，所以这里用定点式。
   */
  function _gray(rgba, w, h) {
    var n = w * h;
    var g = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      g[i] = (rgba[j] * 19596 + rgba[j + 1] * 38470 + rgba[j + 2] * 7470 + 32768) >> 16;
    }
    return g;
  }

  /**
   * 对应 cv2.cvtColor(rgb, COLOR_RGB2HSV) 的 S/V（OpenCV 约定：S 0..255, V 0..255）。
   * OpenCV 8U 的 S 是 (max-min)*255/max 的"平局进位"取整；
   * 实测它只在 207/32895 组 (max,diff) 上与真值差 1，且**没有一组**落在本模块用到的
   * 阈值（sat<45 / sat>60）边界上 —— 对判定结果零影响。
   */
  function _sat(r, g, b) {
    var mx = r > g ? r : g; if (b > mx) mx = b;
    if (mx === 0) return 0;
    var mn = r < g ? r : g; if (b < mn) mn = b;
    return ((mx - mn) * 255 + (mx >> 1)) / mx | 0;
  }

  /** 移植自 _lab_dark_white：HSV 低饱和+高明度=白盘，高饱和偏暗=码点。 */
  function _lab_dark_white(rgba, w, h) {
    var n = w * h;
    var dark = new Uint8Array(n), white = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
      var v = r > g ? r : g; if (b > v) v = b;
      var s = 0;
      if (v !== 0) {
        var mn = r < g ? r : g; if (b < mn) mn = b;
        s = ((v - mn) * 255 + (v >> 1)) / v | 0;
      }
      if (s < 45 && v > 205) white[i] = 1;
      if (s > 60 && v < 240) dark[i] = 1;
    }
    return { dark: dark, white: white };
  }

  /* ------------------------------------------------------- 8 连通域（替代 cv2） */

  var _labBuf = null, _stkX = null, _stkY = null, _bufSize = 0;

  function _ensureBuf(n) {
    if (_bufSize < n) {
      _bufSize = n;
      _labBuf = new Int32Array(n);
      _stkX = new Int32Array(n);
      _stkY = new Int32Array(n);
    }
  }

  /**
   * 等价 cv2.connectedComponentsWithStats(mask, 8)：
   *   · 8 连通；标签 0 = 背景，其余按"栅格扫描首次出现顺序"编号（与 cv2 一致）；
   *   · 面积、包围盒（left/top/width/height）；
   *   · 质心是**像素索引的均值**（不是几何中心）—— cv2 的 centroids 就是这么算的。
   * 用显式栈的洪泛填充实现，O(n)。
   */
  function _cc(mask, w, h) {
    var n = w * h;
    _ensureBuf(n);
    var label = _labBuf, stkX = _stkX, stkY = _stkY;
    label.fill(0, 0, n);

    var left = [0], top = [0], width = [0], height = [0], area = [0], cx = [0], cy = [0];
    var nl = 0;
    for (var start = 0; start < n; start++) {
      if (!mask[start] || label[start]) continue;
      nl++;
      // 栈里存 (x,y) 而不是线性下标：省掉每个像素一次整数除法（热点）
      var sy0 = (start - start % w) / w, sx0 = start - sy0 * w;
      var sp = 0;
      stkX[sp] = sx0; stkY[sp] = sy0; sp++;
      label[start] = nl;
      var minx = w, maxx = -1, miny = h, maxy = -1, cnt = 0, sx = 0, sy = 0;
      while (sp > 0) {
        sp--;
        var x = stkX[sp], y = stkY[sp];
        cnt++; sx += x; sy += y;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
        var y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : h - 1;
        var x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : w - 1;
        for (var ny = y0; ny <= y1; ny++) {
          var row = ny * w;
          for (var nx = x0; nx <= x1; nx++) {
            var ni = row + nx;
            if (mask[ni] && !label[ni]) {
              label[ni] = nl;
              stkX[sp] = nx; stkY[sp] = ny; sp++;
            }
          }
        }
      }
      left.push(minx); top.push(miny);
      width.push(maxx - minx + 1); height.push(maxy - miny + 1);
      area.push(cnt); cx.push(sx / cnt); cy.push(sy / cnt);
    }
    return {
      n: nl + 1, left: left, top: top, width: width, height: height,
      area: area, cx: cx, cy: cy
    };
  }

  /** 移植自 _find_disc：最大白连通域 = 码盘。 */
  function _find_disc(white, w, h) {
    var cc = _cc(white, w, h);
    if (cc.n <= 1) return null;
    var bi = -1, ba = -1;
    for (var i = 1; i < cc.n; i++) {          // 严格大于 → 并列时取最小标签，与 np.argmax 一致
      if (cc.area[i] > ba) { ba = cc.area[i]; bi = i; }
    }
    if (bi < 0) return null;
    return {
      bbox: [cc.left[bi], cc.top[bi], cc.width[bi], cc.height[bi]],
      cent: [cc.cx[bi], cc.cy[bi]],
      area: cc.area[bi],
      fill: _round(cc.area[bi] / Math.max(cc.width[bi] * cc.height[bi], 1), 3)
    };
  }

  /* ------------------------------------------------------- 牛眼（环形定位点） */

  var _COS8 = null, _SIN8 = null, _COS64 = null, _SIN64 = null;
  (function () {
    _COS8 = new Float64Array(8); _SIN8 = new Float64Array(8);
    for (var k = 0; k < 8; k++) {
      var a = k * Math.PI / 4.0;
      _COS8[k] = Math.cos(a); _SIN8[k] = Math.sin(a);
    }
    _COS64 = new Float64Array(64); _SIN64 = new Float64Array(64);
    for (var k2 = 0; k2 < 64; k2++) {
      var a2 = 2 * Math.PI * k2 / 64.0;
      _COS64[k2] = Math.cos(a2); _SIN64[k2] = Math.sin(a2);
    }
  })();

  /**
   * 移植自 _bullseye_verify：验证 (ccx,ccy,R) 是否为一个牛眼
   * （中心黑 + 环黑 + 环外白）。命中返回候选，否则 null。
   *
   * 性能说明：本函数在稠密搜索里会被调用数千次，占整个判定 ~90% 的时间。
   * 因此先用少量像素做一次**保守预筛**（真牛眼中心必然是黑的），
   * 预筛中不通过就直接返回，避免为每个候选都重建极坐标网格。
   * 这里额外做"剩余采样点已不可能凑够 6 个"的提前返回 —— 与全量计数语义等价。
   */
  function _bullseye_verify(dark, w, h, ccx, ccy, R) {
    var py0 = Math.trunc(ccy - R), py1 = Math.trunc(ccy + R + 1);
    var px0 = Math.trunc(ccx - R), px1 = Math.trunc(ccx + R + 1);
    if (py0 < 0 || px0 < 0 || py1 > h || px1 > w || py1 <= py0 || px1 <= px0) return null;
    var ph = py1 - py0, pw = px1 - px0;

    // --- 预筛：中心 0.15R 圆内取 8 个采样点，要求 ≥6 个是暗的 ---
    // 阈值刻意保守（验证阶段要求 center_frac ≥ 0.6），避免把真眼拒掉。
    var r_in = Math.max(1.0, R * 0.15);
    var ccx_i = (pw - 1) / 2.0, ccy_i = (ph - 1) / 2.0;
    var dark_hits = 0;
    for (var k = 0; k < 8; k++) {
      var sx = _iround(ccx_i + r_in * _COS8[k]);
      var sy = _iround(ccy_i + r_in * _SIN8[k]);
      if (sy >= 0 && sy < ph && sx >= 0 && sx < pw && dark[(py0 + sy) * w + (px0 + sx)]) dark_hits++;
      if (dark_hits + (7 - k) < 6) return null;
    }
    if (dark_hits < 6) return null;

    var cThr = R * 0.22, rIn0 = R * 0.35, rIn1 = R * 0.95, rOut0 = R * 1.02, rOut1 = R * 1.6;
    var nC = 0, nR = 0, nO = 0, dC = 0, dR = 0, dO = 0;
    for (var yy = 0; yy < ph; yy++) {
      var dyy = yy - ccy_i, dyy2 = dyy * dyy;
      var base = (py0 + yy) * w + px0;
      for (var xx = 0; xx < pw; xx++) {
        var dxx = xx - ccx_i;
        var pr = Math.sqrt(dxx * dxx + dyy2);
        var d = dark[base + xx];
        if (pr < cThr) { nC++; if (d) dC++; }
        else if (pr > rIn0 && pr < rIn1) { nR++; if (d) dR++; }
        else if (pr > rOut0 && pr < rOut1) { nO++; if (d) dO++; }
      }
    }
    if (!(nC > 0 && nR > 0 && nO > 0)) return null;
    var center_frac = dC / nC;
    var ring_frac = dR / nR;
    var around_frac = dO / nO;
    if (center_frac < 0.6) return null;
    var score = center_frac - around_frac;
    if (score <= 0.25) return null;
    // center_frac 必须按 Python 一样 round 到 2 位：_pick_four 用它做 >0.65 的过滤，
    // 不取整会让 0.65x 的候选进出候选池，改变 _pick_four 看到的集合。
    return {
      x: ccx, y: ccy, R: R, flips: 0,
      score: _round(score, 3),
      center_frac: _round(center_frac, 2),
      ring_frac: _round(ring_frac, 2),
      around_frac: _round(around_frac, 2),
      fill: 0.0
    };
  }

  /**
   * 移植自 _find_bullseyes。
   *
   * dense=true 时额外做**稠密环带搜索**：网格步长可能正好错过牛眼圆心，
   * 而牛眼是规则同心环结构，稠密搜索能兜住这种情况（实测在 real_douyin 上补齐 4 个定位点）。
   */
  function _find_bullseyes(dark, w, h, disc, dense) {
    var cx = disc.cent[0], cy = disc.cent[1];
    var bw = disc.bbox[2], bh = disc.bbox[3];
    var r_disc = Math.max(bw, bh) / 2.0;

    // mask = dark & (r_map <= r_disc*1.02)
    var n = w * h;
    var mask = new Uint8Array(n);
    var lim = r_disc * 1.02, lim2 = lim * lim;
    for (var y = 0; y < h; y++) {
      var dy = y - cy, dy2 = dy * dy, row = y * w;
      for (var x = 0; x < w; x++) {
        if (!dark[row + x]) continue;
        var dx = x - cx;
        if (dx * dx + dy2 <= lim2) mask[row + x] = 1;
      }
    }

    var cc = _cc(mask, w, h);
    var cand = [];
    for (var i = 1; i < cc.n; i++) {
      var w0 = cc.width[i], h0 = cc.height[i], area = cc.area[i];
      if (w0 < 12 || h0 < 12 || area < 50) continue;
      var wh = w0 / h0;
      if (!(wh > 0.6 && wh < 1.7)) continue;
      var fill = area / (w0 * h0);
      if (!(fill >= 0.10 && fill <= 0.70)) continue;
      var ccx = cc.cx[i], ccy = cc.cy[i];
      var ddx = ccx - cx, ddy = ccy - cy;
      var r_c = Math.sqrt(ddx * ddx + ddy * ddy);
      if (!(r_c > r_disc * 0.5 && r_c < r_disc * 1.0)) continue;
      var R = (w0 + h0) / 4.0;
      var hit = _bullseye_verify(dark, w, h, ccx, ccy, R);
      if (hit) cand.push(hit);
    }

    if (dense !== false) {
      // 稠密搜索：以盘心为基准，沿"到盘心的距离"和角度扫描，覆盖被网格错过的心。
      //
      // 注意（实测教训）：即使它**没有增加最终候选数量**，也**不能跳过**——
      // 试过"连通域已找到 ≥4 个高分牛眼就跳过稠密搜索"的早退优化，
      // 结果抖音码被误判成微信族：因为稠密搜索产生的重复候选会参与排序与去重，
      // 从而改变 _pick_four 实际看到的集合。判定正确性优先于这点开销。
      var rrStart = r_disc * 0.55, rrEnd = r_disc * 0.98;
      var rrStep = Math.max(2.0, r_disc * 0.02);
      var radii = [r_disc * 0.085, r_disc * 0.105, r_disc * 0.13];
      for (var ri = 0; ri < 3; ri++) {
        var RR = radii[ri];
        if (RR < 5) continue;
        for (var kk = 0; ; kk++) {
          var r = rrStart + kk * rrStep;      // 等价 np.arange(start, stop, step)
          if (!(r < rrEnd)) break;
          for (var ai = 0; ai < 64; ai++) {
            var px = cx + r * _COS64[ai];
            var py = cy + r * _SIN64[ai];
            var hit2 = _bullseye_verify(dark, w, h, px, py, RR);
            if (hit2 && hit2.score > 0.55) cand.push(hit2);
          }
        }
      }
    }

    // 按 score 降序（稳定：同分保持插入顺序，等价 Python 的 key=-score 稳定排序）
    for (var q = 0; q < cand.length; q++) cand[q]._i = q;
    cand.sort(function (p1, p2) {
      return (p2.score - p1.score) || (p1._i - p2._i);
    });
    var keep = [];
    for (var c = 0; c < cand.length; c++) {
      var cc2 = cand[c], ok = true;
      for (var m = 0; m < keep.length; m++) {
        var kx = cc2.x - keep[m].x, ky = cc2.y - keep[m].y;
        var l2 = Math.max(cc2.R, keep[m].R) * 1.5;
        if (kx * kx + ky * ky <= l2 * l2) { ok = false; break; }
      }
      if (ok) keep.push(cc2);
      if (keep.length >= 12) break;
    }
    return keep;
  }

  /**
   * 移植自 _pick_four：同一环带 + 半径接近 + 正方形 + 质心≈盘心。
   *
   * 注意：候选池**必须**是"按 score（降序）排列后的前 12 个里、再按 center_frac>0.65 过滤"，
   * 且组合必须按组合序枚举。实测把它改成"按半径优先"或"评分偏向大半径"，
   * 会让全分辨率基线 PASS→fail。
   */
  function _pick_four(cand, disc) {
    var dcx = disc.cent[0], dcy = disc.cent[1];
    for (var i = 0; i < cand.length; i++) {
      var dx = cand[i].x - dcx, dy = cand[i].y - dcy;
      cand[i].r_c = Math.sqrt(dx * dx + dy * dy);
    }
    var pool = [];
    for (var j = 0; j < cand.length; j++) {
      var cf = (cand[j].center_frac === undefined) ? 1 : cand[j].center_frac;
      if (cf > 0.65) pool.push(cand[j]);
    }
    var pool12 = pool.slice(0, 12);
    var best = null;
    var nn = pool12.length;
    for (var a = 0; a < nn; a++) {
      for (var b = a + 1; b < nn; b++) {
        for (var c = b + 1; c < nn; c++) {
          for (var d = c + 1; d < nn; d++) {
            var combo = [pool12[a], pool12[b], pool12[c], pool12[d]];
            var rs0 = combo[0].r_c, rs1 = combo[1].r_c, rs2 = combo[2].r_c, rs3 = combo[3].r_c;
            var rsMean = (rs0 + rs1 + rs2 + rs3) / 4.0;
            var rsMax = Math.max(Math.max(rs0, rs1), Math.max(rs2, rs3));
            var rsMin = Math.min(Math.min(rs0, rs1), Math.min(rs2, rs3));
            if (rsMax - rsMin > rsMean * 0.12) continue;

            var cenx = (combo[0].x + combo[1].x + combo[2].x + combo[3].x) / 4.0;
            var ceny = (combo[0].y + combo[1].y + combo[2].y + combo[3].y) / 4.0;

            var d6 = [];
            for (var p1 = 0; p1 < 4; p1++) {
              for (var p2 = p1 + 1; p2 < 4; p2++) {
                var ex = combo[p1].x - combo[p2].x, ey = combo[p1].y - combo[p2].y;
                d6.push(Math.sqrt(ex * ex + ey * ey));
              }
            }
            d6.sort(function (u, v) { return u - v; });
            var side = (d6[0] + d6[1] + d6[2] + d6[3]) / 4.0;
            var diag = (d6[4] + d6[5]) / 2.0;
            if (side <= 0) continue;
            var sq = Math.abs(diag / side - Math.SQRT2);
            var cex = cenx - dcx, cey = ceny - dcy;
            var cen_err = Math.sqrt(cex * cex + cey * cey);
            var score = cen_err / 5.0 + sq * 300.0 + (rsMax - rsMin) / 5.0;
            if (best === null || score < best.score) {
              best = {
                score: score, combo: combo, cen: [cenx, ceny],
                side: side, diag: diag, sqerr: sq,
                rcMean: rsMean, rcSpread: rsMax - rsMin, cenErr: cen_err
              };
            }
          }
        }
      }
    }
    return best;
  }

  /* ------------------------------------------------------- 微信族：中心区牛眼 */

  /** 移植自 _find_eyes_in_center：中心区域找同心环牛眼（微信族）。 */
  function _find_eyes_in_center(gray, w, h) {
    var cx0 = Math.floor(w / 2), cy0 = Math.floor(h / 2);
    var r = Math.trunc(Math.min(h, w) * 0.36);
    var y0 = Math.max(0, cy0 - r), y1 = Math.min(h, cy0 + r);
    var x0 = Math.max(0, cx0 - r), x1 = Math.min(w, cx0 + r);
    var sw = x1 - x0, sh = y1 - y0;
    if (sw <= 0 || sh <= 0) return [];

    var binary = new Uint8Array(sw * sh);
    for (var yy = 0; yy < sh; yy++) {
      var src = (y0 + yy) * w + x0, dst = yy * sw;
      for (var xx = 0; xx < sw; xx++) binary[dst + xx] = gray[src + xx] < 128 ? 1 : 0;
    }

    var cc = _cc(binary, sw, sh);
    var eyes = [];
    for (var i = 1; i < cc.n; i++) {
      var bw = cc.width[i], bh = cc.height[i], area = cc.area[i];
      if (bw < 8 || bh < 8 || area < 40) continue;
      var ratio = bw / bh;
      if (!(ratio > 0.75 && ratio < 1.33)) continue;
      if (area / (bw * bh) > 0.5) continue;
      var ccx = cc.cx[i], ccy = cc.cy[i];
      var rmax = Math.min(bw, bh) / 2;
      var steps = Math.max(4, Math.trunc(rmax * 2));
      var flips = 0, prev = -1, count = 0;
      for (var s = 0; s < steps; s++) {
        var t = -rmax + (2 * rmax) * s / (steps - 1);
        var sy = _iround(ccy + t), sx = _iround(ccx);
        if (sy < 0 || sy >= sh || sx < 0 || sx >= sw) continue;
        var v = binary[sy * sw + sx];
        if (prev >= 0 && v !== prev) flips++;
        prev = v; count++;
      }
      // 越界样本被丢弃后若不足 3 个，Python 侧 flips 记 0（必然 <3，不会入选）
      if (count > 2 && flips >= 3) {
        eyes.push({ x: ccx + x0, y: ccy + y0, d: (bw + bh) / 2, flips: flips });
      }
    }
    // 按 flips 降序（稳定：同分保持标签顺序）
    for (var q = 0; q < eyes.length; q++) eyes[q]._i = q;
    eyes.sort(function (p1, p2) { return (p2.flips - p1.flips) || (p1._i - p2._i); });
    return eyes.slice(0, 8);
  }

  var _PERMS3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  /** 移植自 _fit_tri_center：3 牛眼 = 矩形三角 → 圆心 = 另两角中点。 */
  function _fit_tri_center(pts) {
    var best = null;
    for (var i = 0; i < 6; i++) {
      var o = _PERMS3[i];
      var v = pts[o[0]], a = pts[o[1]], b = pts[o[2]];
      var da = Math.sqrt((v[0] - a[0]) * (v[0] - a[0]) + (v[1] - a[1]) * (v[1] - a[1]));
      var db = Math.sqrt((v[0] - b[0]) * (v[0] - b[0]) + (v[1] - b[1]) * (v[1] - b[1]));
      var sc = Math.abs(da - db) / Math.max(Math.max(da, db), 1e-6);
      if (best === null || sc < best.sc) {
        best = { sc: sc, cen: [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0] };
      }
    }
    return best;
  }

  /** 双线性灰度采样；四角越界取 255（等价 cv2.remap INTER_LINEAR + BORDER_CONSTANT,255）。 */
  function _grayAt(gray, w, h, x, y) {
    return (x < 0 || y < 0 || x >= w || y >= h) ? 255 : gray[y * w + x];
  }
  function _bilinearGray(gray, w, h, x, y) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    var v00 = _grayAt(gray, w, h, x0, y0), v10 = _grayAt(gray, w, h, x1, y0);
    var v01 = _grayAt(gray, w, h, x0, y1), v11 = _grayAt(gray, w, h, x1, y1);
    var top = v00 * (1 - fx) + v10 * fx;
    var bot = v01 * (1 - fx) + v11 * fx;
    return top * (1 - fy) + bot * fy;
  }

  /**
   * 移植自 _angular_div：极坐标展开后沿角度自相关 → 主分度数
   * （微信族实测 36/54/72 格/圈）。
   *
   * 这是区分"微信族"与"普通二维码"的**唯一权威判据** ——
   * QR 的三个定位符同样构成等腰直角三角形，纯几何无法区分。
   */
  function _angular_div(gray, w, h, center, r0, r1) {
    if (r1 <= r0 * 1.25) return null;
    var cx = center[0], cy = center[1];
    var n_ang = 1440, n_rad = 200;
    var bandStart = Math.trunc(0.35 * n_rad), bandEnd = Math.trunc(0.9 * n_rad);
    var rows = bandEnd - bandStart;
    if (rows <= 0) return null;

    var darkCount = new Int32Array(n_ang);
    var step = (r1 - r0) / (n_rad - 1);
    for (var ri = bandStart; ri < bandEnd; ri++) {
      var rad = r0 + step * ri;
      for (var ai = 0; ai < n_ang; ai++) {
        var ang = 2 * Math.PI * ai / n_ang;       // 等价 np.linspace(0,2π,1440,endpoint=False)
        var sx = cx + rad * Math.cos(ang);
        var sy = cy + rad * Math.sin(ang);
        if (_bilinearGray(gray, w, h, sx, sy) < 128) darkCount[ai]++;
      }
    }

    var prof = new Float64Array(n_ang);
    var mean = 0;
    for (var i = 0; i < n_ang; i++) { prof[i] = darkCount[i] / rows; mean += prof[i]; }
    mean /= n_ang;
    for (var i2 = 0; i2 < n_ang; i2++) prof[i2] -= mean;

    // 自相关：ac[lag] = Σ_i prof[i]*prof[i+lag]（即 np.correlate(...,'full') 的后半段）
    var ac = new Float64Array(n_ang);
    for (var lag = 0; lag < n_ang; lag++) {
      var s = 0;
      for (var k = 0; k + lag < n_ang; k++) s += prof[k] * prof[k + lag];
      ac[lag] = s;
    }
    var ac0 = ac[0] + 1e-9;
    for (var i3 = 0; i3 < n_ang; i3++) ac[i3] /= ac0;

    // 峰值：局部极大 + >0.15；并列时取更小的 lag（等价 Python 稳定排序后取首个）
    var bestLag = -1, bestVal = -Infinity;
    for (var L = 3; L < 160 && L + 1 < n_ang; L++) {
      if (ac[L] >= ac[L - 1] && ac[L] >= ac[L + 1] && ac[L] > 0.15) {
        if (bestLag < 0 || ac[L] > bestVal) { bestVal = ac[L]; bestLag = L; }
      }
    }
    if (bestLag < 0) return null;
    return {
      div: _round(360.0 / (bestLag * 360.0 / n_ang), 1),
      angle_deg: _round(bestLag * 360.0 / n_ang, 3),
      peak: _round(bestVal, 3)
    };
  }

  /* ------------------------------------------------------------------ 主入口 */

  /**
   * 判定 rgba（Uint8ClampedArray，RGBA 交织，w×h）是否为样式化私有码。
   *
   * 调用方应已确认标准解码器全部失败（本函数不做标准 QR 排除，以免与引擎级联重复）。
   *
   * 两条**已验证**的检测管线（逐字移植，不做"思路参考"）：
   *   A. 抖音式 4 定位点：HSV 白盘 → 连通域牛眼 → 4 点正方形 + 质心≈盘心
   *      （real_douyin.jpg 实测：正方形误差 0.0051、质心/盘心偏差 29.7px）
   *   B. 微信式 3+1 牛眼：中心区同心环 → 等腰直角三角形 → 圆心=矩形第四角
   *      （real_wechat_reward.jpg 实测：等腰直角误差 0.0003、圆心 (575.8,419.8)）
   *
   * 注意：A/B 两条检测管线都在**原分辨率**上跑 —— 缩略到 1000px 会把牛眼环打碎，
   * 导致真实定位点被漏检（实测教训）。本函数不会自己再缩图。
   */
  function classify(rgba, w, h) {
    if (!rgba || !w || !h) return _unknown(w | 0, h | 0, ['未检出 3/4 定位点的规则几何结构']);
    var W = w, H = h;
    var gray = _gray(rgba, W, H);

    // ---------------- 路线 A：抖音式 4 定位点 ----------------
    try {
      var dw = _lab_dark_white(rgba, W, H);
      var disc = _find_disc(dw.white, W, H);
      if (disc && disc.fill > 0.45) {
        var eyes = _find_bullseyes(dw.dark, W, H, disc, true);
        var best = (eyes.length >= 4) ? _pick_four(eyes, disc) : null;
        if (best) {
          var disc_r = Math.max(disc.bbox[2], disc.bbox[3]) / 2.0;
          if (best.sqerr <= 0.02 && best.cenErr <= 0.08 * Math.max(disc_r, 1)) {
            var Rm = 0;
            for (var ei = 0; ei < best.combo.length; ei++) Rm += best.combo[ei].R;
            Rm /= best.combo.length;
            var mod = Rm / 3.5;
            var r_code = disc_r;
            var div = _angular_div(gray, W, H, best.cen,
              Math.max(Rm * 2.0, 0.3 * r_code), r_code * 0.96);
            var geo = {
              center: [_round(best.cen[0], 1), _round(best.cen[1], 1)],
              n_eyes: 4,
              eyes: best.combo.map(function (e) {
                return { x: _round(e.x, 1), y: _round(e.y, 1), R: _round(e.R, 1), score: e.score };
              }),
              square_err: _round(best.sqerr, 4),
              side_px: _round(best.side, 1),
              centroid_vs_disc_px: _round(best.cenErr, 1),
              disc_center: [_round(disc.cent[0], 1), _round(disc.cent[1], 1)],
              disc_fill: disc.fill,
              module_px: _round(mod, 2),
              code_radius_px: _round(r_code, 1),
              est_lines: _round(2 * r_code / mod, 0),
              image: [W, H]
            };
            if (div) geo.angular_div = div;
            var conf = Math.min(1.0, 0.80 + (0.02 - best.sqerr) * 5);
            var notes = ['4 定位点构成正方形，质心≈码盘圆心 → 抖音主页码',
              '正方形误差 ' + _f4(best.sqerr) + '，质心与盘心偏差 ' + _f1(best.cenErr) + 'px'];
            if (div) notes.push('角向主分度≈' + _f1(div.div) + ' 格/圈');
            notes.push('不做 payload 解码：厂商私有语义（实测等同于「打开谁的主页」）');
            return {
              kind: 'douyin_profile', confidence: _round(conf, 3),
              label: KIND_LABELS['douyin_profile'], hint: HINTS['douyin_profile'],
              geometry: geo, notes: notes
            };
          }
        }
      }
    } catch (e) { /* 与 Python 一致：路线异常不阻断另一条路线 */ }

    // ---------------- 路线 B：微信式 3+1 牛眼 ----------------
    try {
      var eyes2 = _find_eyes_in_center(gray, W, H);
      var b2 = null;
      var ne = Math.min(eyes2.length, 5);
      for (var a2 = 0; a2 < ne; a2++) {
        for (var b3 = a2 + 1; b3 < ne; b3++) {
          for (var c3 = b3 + 1; c3 < ne; c3++) {
            var combo = [eyes2[a2], eyes2[b3], eyes2[c3]];
            var pts = [[combo[0].x, combo[0].y], [combo[1].x, combo[1].y], [combo[2].x, combo[2].y]];
            var fit = _fit_tri_center(pts);
            if (fit.sc > 0.10) continue;
            var R_mean = (combo[0].d + combo[1].d + combo[2].d) / 3.0 / 4.0;
            var dsum = 0;
            for (var pi = 0; pi < 3; pi++) {
              var pdx = pts[pi][0] - fit.cen[0], pdy = pts[pi][1] - fit.cen[1];
              dsum += Math.sqrt(pdx * pdx + pdy * pdy);
            }
            var d_eye = dsum / 3.0;
            // 圆心须落在图像中部（真码的圆心就是码心）
            if (!(0.18 * W < fit.cen[0] && fit.cen[0] < 0.82 * W &&
                  0.18 * H < fit.cen[1] && fit.cen[1] < 0.82 * H)) continue;
            var meanFlips = (combo[0].flips + combo[1].flips + combo[2].flips) / 3.0;
            var score2 = (1 - fit.sc) * 0.7 + Math.min(1.0, meanFlips / 7.0) * 0.3;
            if (b2 === null || score2 > b2.score) {
              b2 = { score: score2, combo: combo, cen: fit.cen, sc: fit.sc, R_mean: R_mean, d_eye: d_eye };
            }
          }
        }
      }
      if (b2) {
        var mod2 = b2.R_mean / 3.5;
        var r_code2 = b2.d_eye + 2.0 * b2.R_mean;
        var div2 = _angular_div(gray, W, H, b2.cen,
          Math.max(b2.R_mean * 2.2, 0.3 * r_code2), r_code2 * 0.97);

        // ---- 权威判别：角向格律（硬门槛，必须测出且合规）----
        // 微信小程序码官方规格只有 36 / 54 / 72 线三档，数据区是**规则极坐标格**，
        // 因此角向自相关应能测出 30~80 格/圈且周期足够强。
        //
        // 实测分界（这是本模块唯一能区分"微信族"与"普通二维码"的依据）：
        //   真微信赞赏码      : 4 种半径带下均为 (36.0, peak 0.71~0.74)，完全稳定
        //   普通二维码(打印)  : (27~28, peak 0.21~0.44)，分度不符且周期弱
        //   充电桩LCD照片     : 4 种半径带下均为 None（整幅照片没有极坐标格律）
        // 普通二维码的三个定位符同样构成等腰直角三角形，纯几何无法区分，必须靠这一条。
        // 注意"测不出"要判否而不是放过——放过会让整幅照片级别的图蒙混过关。
        if (div2 === null) {
          return _unknown(W, H, ['3 牛眼呈等腰直角三角形，但测不出角向格律'
            + '（微信族应有 36/54/72 线档的规则极坐标格律）'
            + '→ 更可能是普通二维码或整幅照片']);
        }
        if (!(div2.div >= 30.0 && div2.div <= 80.0 && div2.peak >= 0.60)) {
          return _unknown(W, H, ['3 牛眼呈等腰直角三角形，但角向格律不符合微信规格'
            + '（实测 ' + _f1(div2.div) + ' 格/圈、周期强度 ' + _f3(div2.peak) + '；'
            + '要求 30~80 格/圈且强度 ≥0.60）→ 更可能是普通二维码']);
        }

        var div_bonus = 0.20;
        var x0 = Math.max(0, Math.trunc(b2.cen[0] - r_code2));
        var x1 = Math.min(W, Math.trunc(b2.cen[0] + r_code2));
        var y0 = Math.max(0, Math.trunc(b2.cen[1] - r_code2));
        var y1 = Math.min(H, Math.trunc(b2.cen[1] + r_code2));
        var total = 0, colorfulN = 0;
        for (var yy = y0; yy < y1; yy++) {
          var rbase = yy * W;
          for (var xx = x0; xx < x1; xx++) {
            var jj = (rbase + xx) * 4;
            total++;
            if (_sat(rgba[jj], rgba[jj + 1], rgba[jj + 2]) > 60) colorfulN++;
          }
        }
        var colorful = total ? colorfulN / total : 0.0;
        var kind = (colorful > 0.10) ? 'wechat_reward' : 'wechat_miniprogram';
        var geo2 = {
          center: [_round(b2.cen[0], 1), _round(b2.cen[1], 1)],
          n_eyes: 3,
          eyes: b2.combo.map(function (e) {
            return { x: _round(e.x, 1), y: _round(e.y, 1), d: _round(e.d, 1), flips: e.flips };
          }),
          iso_right_err: _round(b2.sc, 4),
          module_px: _round(mod2, 2),
          code_radius_px: _round(r_code2, 1),
          est_lines: _round(2 * r_code2 / mod2, 0),
          color_ratio: _round(colorful, 3),
          image: [W, H]
        };
        if (div2) geo2.angular_div = div2;
        var notes2 = ['3 牛眼构成等腰直角三角形 → 微信族异形码',
          '等腰直角误差 ' + _f4(b2.sc), '码区彩色占比 ' + _f2(colorful)];
        if (div2) notes2.push('角向主分度≈' + _f1(div2.div) + ' 格/圈');
        notes2.push('不做 payload 解码：厂商私有语义（实测等同于「打开谁的主页」）');
        var conf2 = Math.max(0.0, Math.min(1.0, 0.55 + 0.45 * b2.score + div_bonus));
        return {
          kind: kind, confidence: _round(conf2, 3),
          label: KIND_LABELS[kind], hint: HINTS[kind],
          geometry: geo2, notes: notes2
        };
      }
    } catch (e2) { /* 同上 */ }

    return _unknown(W, H, ['未检出 3/4 定位点的规则几何结构']);
  }

  return {
    classify: classify,
    hint: hint,
    KIND_LABELS: KIND_LABELS,
    HINTS: HINTS
  };
});
