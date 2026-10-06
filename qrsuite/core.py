# -*- coding: utf-8 -*-
"""qrsuite.core —— 多引擎二维码/条码解码核心

设计目标（v2 相对 v1 的优化点）：
  1. 级联 + 早退：按"命中率高 / 代价低"的顺序逐级尝试，Once hit -> stop（v1 会跑满 18 变体 × N 引擎）
  2. 预处理全程用 OpenCV/NumPy，灰度只算一次并复用（v1 每变体都做 PIL 往返）
  3. 分辨率闸门：大图先缩放、小图才放大，避免无效的高代价变体
  4. 多引擎可选、可验证模式（要求 ≥2 引擎一致才算命中，降低误读）
  5. 统计每张图实际跑了多少阶段/引擎、耗时与 CPU 时间，便于量化优化效果
"""
from __future__ import annotations
import os, sys, time, tempfile
from dataclasses import dataclass, field
from typing import Iterable

_DBG = os.environ.get('QRSUITE_DEBUG') == '1'

# ----------------------------------------------------------------------------- 引擎
class Engine:
    name = 'base'
    def available(self) -> bool: return False
    def read(self, img, gray, color) -> list[tuple[str, str]]: return []

class ZXingEngine(Engine):
    name = 'zxing'
    def __init__(self):
        try:
            import zxingcpp; self._zx = zxingcpp
        except Exception: self._zx = None
    def available(self): return self._zx is not None
    def read(self, img, gray, color):
        out = []
        for r in self._zx.read_barcodes(color):
            t = getattr(r, 'text', '') or ''
            if t:
                f = getattr(r, 'format', None)
                out.append((t, getattr(f, 'name', str(f))))
        return out

class Cv2Engine(Engine):
    name = 'cv2'
    def __init__(self):
        try:
            import cv2; self._cv2 = cv2
        except Exception: self._cv2 = None
        self._det = None
    def available(self): return self._cv2 is not None
    def read(self, img, gray, color):
        if self._det is None: self._det = self._cv2.QRCodeDetector()
        out = []
        try:
            data, _, _ = self._det.detectAndDecode(gray)
            if data: out.append((data, 'QRCode'))
        except Exception: pass
        return out

class ZbarEngine(Engine):
    name = 'zbar'
    def __init__(self):
        try:
            from pyzbar import pyzbar; self._pz = pyzbar
        except Exception: self._pz = None
    def available(self): return self._pz is not None
    def read(self, img, gray, color):
        out = []
        try:
            for r in self._pz.decode(gray):
                try: t = r.data.decode('utf-8')
                except Exception: t = r.data.decode('latin1')
                if t: out.append((t, r.type))
        except Exception: pass
        return out

class WeChatEngine(Engine):
    """微信自研检测+超分模型，专治小图/模糊/低对比码（抖音主页码、微信赞赏码这类）。

    OpenCV 5.0 起 `WeChatQRCode()` 可无参构造，模型已内置，**不再需要 4 个模型文件**；
    4.x 仍需 detect/sr 的 prototxt+caffemodel。这里两种都兼容，优先无参。
    """
    name = 'wechat'
    def __init__(self, model_dir):
        self._ok, self._wq = False, None
        try:
            import cv2
            if not hasattr(cv2, 'wechat_qrcode'):
                return
            # 1) OpenCV 5.0+：模型内置，无参即可
            try:
                self._wq = cv2.wechat_qrcode.WeChatQRCode()
                self._ok = True
                return
            except Exception:
                pass
            # 2) 旧版回退：需要 4 个模型文件
            files = ['detect.prototxt', 'detect.caffemodel', 'sr.prototxt', 'sr.caffemodel']
            if not all(os.path.exists(os.path.join(model_dir, f)) for f in files):
                return
            self._wq = cv2.wechat_qrcode.WeChatQRCode(*[os.path.join(model_dir, f) for f in files])
            self._ok = True
        except Exception:
            pass
    def available(self): return self._ok
    def read(self, img, gray, color):
        try:
            res = self._wq.detectAndDecode(color)
            texts = res[0] if isinstance(res, (tuple, list)) else res
            return [(t, 'QRCode') for t in (texts or []) if t]
        except Exception:
            return []

class OriginalEngine(Engine):
    """把 v1 的 QRCodeScanner.exe 当作一个引擎（可选，需文件路径，代价高）。"""
    name = 'original'
    def __init__(self, exe_path, timeout=60):
        self._exe, self._timeout = exe_path, timeout
        self._tmp = None
    def available(self): return bool(self._exe and os.path.isfile(self._exe))
    def read_path(self, path):
        import subprocess, re
        if not self.available(): return []
        try:
            p = subprocess.run([self._exe], input=os.path.abspath(path) + '\n', capture_output=True,
                               text=True, encoding='utf-8', errors='replace', timeout=self._timeout)
        except Exception: return []
        out = []
        for line in (p.stdout or '').splitlines():
            m = re.search(r'二维码内容: (.*)$', line)
            if m and m.group(1).strip(): out.append((m.group(1).strip(), 'QRCode'))
        return out

# ----------------------------------------------------------------------------- 预处理
def _imread_any(path):
    """用 PIL 读图（兼容中文路径），返回 (BGR ndarray, gray ndarray)。"""
    import numpy as np
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(path)
    im = _apply_exif(im).convert('RGB')
    rgb = np.asarray(im)
    color = rgb[:, :, ::-1].copy()          # RGB -> BGR
    gray = _rgb2gray(rgb)
    return color, gray

def _apply_exif(im):
    try:
        from PIL import ImageOps
        return ImageOps.exif_transpose(im)
    except Exception:
        return im

def _rgb2gray(rgb):
    import numpy as np
    return np.dot(rgb[..., :3], [0.299, 0.587, 0.114]).astype(np.uint8)

def from_bytes(data):
    import numpy as np
    from PIL import Image
    import io
    im = _apply_exif(Image.open(io.BytesIO(data))).convert('RGB')
    rgb = np.asarray(im)
    return rgb[:, :, ::-1].copy(), _rgb2gray(rgb)

# 阶段定义：名称 -> (代价权重, 构造函数)
def build_stages(gray, color, max_side=1800):
    """返回有序阶段列表 [(名称, color, gray)]，已按命中率/代价排序；只生成需要的变体。"""
    import cv2
    import numpy as np
    h, w = gray.shape[:2]
    scale = 1.0
    if max(h, w) > max_side:                       # 大图先降采样，省 CPU
        scale = max_side / float(max(h, w))
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        color = cv2.resize(color, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    small = max(gray.shape[:2]) < 700              # 小图才值得放大

    yield '原图', color, gray                       # 最便宜、命中率最高
    yield '灰度', color, gray
    if small:
        up2 = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        yield '放大2倍', cv2.resize(color, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), up2
    otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    yield 'Otsu二值化', cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR), otsu
    yield 'CLAHE', cv2.cvtColor(cv2.createCLAHE(3.0, (8, 8)).apply(gray), cv2.COLOR_GRAY2BGR), \
                   cv2.createCLAHE(3.0, (8, 8)).apply(gray)
    if small:
        up3 = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        yield '放大3倍', cv2.cvtColor(up3, cv2.COLOR_GRAY2BGR), up3
    inv = cv2.bitwise_not(gray)
    yield '反色', cv2.cvtColor(inv, cv2.COLOR_GRAY2BGR), inv
    adap = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 8)
    yield '自适应阈值', cv2.cvtColor(adap, cv2.COLOR_GRAY2BGR), adap
    blur = cv2.threshold(cv2.GaussianBlur(gray, (5, 5), 0), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    yield '模糊+二值化', cv2.cvtColor(blur, cv2.COLOR_GRAY2BGR), blur
    for ang, name in ((90, '旋转90'), (180, '旋转180'), (270, '旋转270')):
        g2 = np.rot90(gray, ang // 90).copy()
        yield name, cv2.cvtColor(g2, cv2.COLOR_GRAY2BGR), g2
    yield '锐化', cv2.cvtColor(cv2.filter2D(gray, -1, np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])), cv2.COLOR_GRAY2BGR), \
                  cv2.filter2D(gray, -1, np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]]))
    hh, ww = gray.shape[:2]
    yield '中心裁剪', color[int(hh * .15):int(hh * .85), int(ww * .15):int(ww * .85)], \
                      gray[int(hh * .15):int(hh * .85), int(ww * .15):int(ww * .85)]
    for nm, (y0, y1, x0, x1) in (('左上角', (0, hh // 2 + hh // 8, 0, ww // 2 + ww // 8)),
                                 ('右上角', (0, hh // 2 + hh // 8, ww // 2 - ww // 8, ww)),
                                 ('左下角', (hh // 2 - hh // 8, hh, 0, ww // 2 + ww // 8)),
                                 ('右下角', (hh // 2 - hh // 8, hh, ww // 2 - ww // 8, ww))):
        yield f'裁剪{nm}', color[y0:y1, x0:x1], gray[y0:y1, x0:x1]

MODES = {
    # 快速：只跑最便宜的两个阶段，命中即停
    'fast':     dict(max_stages=2,  engines=('zxing', 'cv2'),           verify=False),
    # 均衡（默认）：命中率最高的三个引擎 + 二值化级别，命中即停。
    #   注：微信模型不放在这里——它每张约 20ms，还有固定 ~0.2s 初始化，
    #   在 13 张基准上会让默认模式墙钟从 0.32s 涨到 0.68s（2×），
    #   而它多解出的那 1 张与"抖音/赞赏码"无关（那类私有码它也不支持），
    #   为默认路径付 2× 代价不划算。需要它时用 deep。
    'balanced': dict(max_stages=7,  engines=('zxing', 'cv2', 'zbar'),   verify=False),
    # 深度：全部阶段 + 全部引擎（含微信模型与可选 v1 程序）；仍命中即停
    'deep':     dict(max_stages=99, engines=('zxing', 'cv2', 'zbar', 'wechat', 'original'), verify=False),
}

# 惰性引擎：代价高（微信模型 20ms/张 + 固定初始化开销），
# 只在便宜的引擎全军覆没之后才补跑一次。目前仅 deep 模式启用。
LAZY_ENGINES = ('wechat',)

# 惰性引擎补跑时允许的阶段数上限（1=仅原图）
LAZY_MAX_STAGES = 2

# ----------------------------------------------------------------------------- 结果
@dataclass
class Hit:
    text: str
    format: str = '?'
    engines: set = field(default_factory=set)
    variants: set = field(default_factory=set)
    # 该 payload 是否为二进制（乘车码/令牌这类）。是二进制时 text 直接显示会是乱码，
    # 调用方应改用 qrsuite.binary.describe() 的可读呈现（见该模块文档）。
    is_binary: bool = False

@dataclass
class Result:
    hits: list = field(default_factory=list)
    stages_tried: int = 0
    engine_runs: int = 0
    elapsed: float = 0.0
    cpu: float = 0.0
    stopped_early: bool = False
    error: str = ''
    # 无命中时附加的"样式化私有码"结构判定（见 qrsuite/stylized.py）。
    # 它不做 payload 解码，只告诉用户"这是哪家的码、该用哪个 App 扫"。
    stylized: dict | None = None
    stylized_elapsed: float = 0.0
    def to_dict(self):
        return dict(results=[dict(text=h.text, format=h.format, engines=sorted(h.engines),
                                  variants=sorted(h.variants), is_binary=h.is_binary)
                             for h in self.hits],
                    stages=self.stages_tried, engine_runs=self.engine_runs,
                    elapsed=round(self.elapsed, 3), cpu=round(self.cpu, 3),
                    early=self.stopped_early, error=self.error,
                    stylized=self.stylized,
                    stylized_elapsed=round(self.stylized_elapsed, 3))

# ----------------------------------------------------------------------------- 解码器
class Decoder:
    def __init__(self, model_dir=None, original_exe=None, engines=None):
        here = os.path.dirname(os.path.abspath(__file__))
        model_dir = model_dir or os.path.join(here, 'wechat_models')
        all_eng = {
            'zxing': ZXingEngine(), 'cv2': Cv2Engine(), 'zbar': ZbarEngine(),
            'wechat': WeChatEngine(model_dir), 'original': OriginalEngine(original_exe),
        }
        self.engines = {k: v for k, v in all_eng.items() if v.available()}
        if engines:
            self.engines = {k: v for k, v in self.engines.items() if k in engines}
        self.last_perf = None

    def available_engines(self):
        return sorted(self.engines)

    def decode_path(self, path, mode='balanced', verify=False, max_side=1800,
                    stylized=True) -> Result:
        try:
            color, gray = _imread_any(path)
        except Exception as e:
            return Result(error=f'无法读取图片: {e}')
        return self.decode_arrays(color, gray, mode, verify, max_side, path, stylized)

    def decode_bytes(self, data, mode='balanced', verify=False, max_side=1800,
                     stylized=True) -> Result:
        try:
            color, gray = from_bytes(data)
        except Exception as e:
            return Result(error=f'不是有效图片: {e}')
        return self.decode_arrays(color, gray, mode, verify, max_side, None, stylized)

    def decode_arrays(self, color, gray, mode='balanced', verify=False, max_side=1800,
                      path=None, stylized=True) -> Result:
        cfg = MODES.get(mode, MODES['balanced'])
        want = tuple(e for e in cfg['engines'] if e in self.engines)
        eager = tuple(e for e in want if e not in LAZY_ENGINES)
        lazy = tuple(e for e in want if e in LAZY_ENGINES)
        t0, c0 = time.perf_counter(), time.process_time()
        res = Result()
        hits: dict[str, Hit] = {}
        tmp = None
        try:
            stages = list(build_stages(gray, color, max_side))
            for i, (name, c, g) in enumerate(stages):
                if i >= cfg['max_stages']:
                    break
                res.stages_tried += 1
                for eng_name in eager:
                    eng = self.engines[eng_name]
                    if eng_name == 'original':
                        if i > 0 or path is None:      # 只跑一次，且需要文件
                            continue
                        if tmp is None:
                            import cv2
                            tmp = os.path.join(tempfile.gettempdir(), f'qrsuite_{os.getpid()}_{id(self)}.png')
                            cv2.imwrite(tmp, color)
                        pairs = eng.read_path(tmp)
                    else:
                        pairs = eng.read(c, g, c)
                    res.engine_runs += 1
                    for text, fmt in pairs:
                        if not text: continue
                        h = hits.get(text)
                        if h is None:
                            # 二元判定只做一次：payload 是二进制时（乘车码/令牌），
                            # 界面直接显示 text 会是乱码，调用方应改用 binary.describe()
                            from .binary import looks_binary
                            h = hits[text] = Hit(text=text, format=fmt, is_binary=looks_binary(text))
                        h.engines.add(eng_name); h.variants.add(name)
                    if _DBG:
                        print(f'  [dbg] {name} / {eng_name} -> {len(pairs)}', file=sys.stderr)
                # 早退：本阶段已有命中
                if hits:
                    if verify:
                        # 验证模式：需 ≥2 个引擎一致，或已跑完
                        if any(len(h.engines) >= 2 for h in hits.values()):
                            res.stopped_early = True; break
                    else:
                        res.stopped_early = True; break

            # 便宜引擎都没命中：补跑惰性引擎（只在前几个阶段试，多为原图）
            if not hits and lazy:
                for i, (name, c, g) in enumerate(stages[:LAZY_MAX_STAGES]):
                    for eng_name in lazy:
                        pairs = self.engines[eng_name].read(c, g, c)
                        res.engine_runs += 1
                        for text, fmt in pairs:
                            if not text: continue
                            h = hits.get(text)
                            if h is None:
                                h = hits[text] = Hit(text=text, format=fmt)
                            h.engines.add(eng_name); h.variants.add(name)
                        if _DBG:
                            print(f'  [dbg-lazy] {name} / {eng_name} -> {len(pairs)}', file=sys.stderr)
                    if hits:
                        res.stopped_early = True
                        break
        finally:
            if tmp and os.path.exists(tmp):
                try: os.remove(tmp)
                except OSError: pass
        res.hits = list(hits.values())
        # 全部引擎都没命中时，附一条"样式化私有码"结构判定（不改变解码行为）
        if stylized and not res.hits:
            ts = time.perf_counter()
            try:
                from .stylized import classify
                info = classify(color, gray)
                if info.kind != 'unknown':
                    res.stylized = info.to_dict()
            except Exception as e:
                if _DBG:
                    print(f'  [dbg] stylized 失败: {type(e).__name__}: {e}', file=sys.stderr)
            res.stylized_elapsed = time.perf_counter() - ts
        res.elapsed = time.perf_counter() - t0
        res.cpu = time.process_time() - c0
        self.last_perf = res
        return res
