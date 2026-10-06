# 架构与实现原理

本文说明 QRSuite v2 的整体架构、解码流水线设计与性能取舍。适合想理解"为什么快"、
或想二次开发的人阅读。

---

## 一、三种形态，一套策略

```
                    ┌──────────────────────────────────────┐
                    │ 同一套级联思路（三端各自实现，不共享代码）│
                    └──────────────────────────────────────┘
                          │              │              │
        ┌─────────────────┘              │              └─────────────────┐
        ▼                                ▼                                ▼
┌────────────────┐            ┌────────────────────┐            ┌──────────────────┐
│ Python CLI/服务 │            │ 浏览器静态站 docs/   │            │ Android 原生 App  │
│ qrsuite/       │            │ jsQR + ZXing-js    │            │ CameraX + ML Kit │
│ zxing-cpp      │            │ (Web Worker 内解码) │            │ (C++ 原生推理)     │
│ OpenCV / zbar  │            │ 无 CDN、可离线       │            │ 无网络权限         │
│ WeChatQRCode   │            │                    │            │                  │
└────────────────┘            └────────────────────┘            └──────────────────┘
   高精度 / 批量                  零安装 / 可分享                  随手扫 / 移动端
```

三端**不共享代码**（语言与运行环境不同），但共享同一套工程策略：
**按"代价低 / 命中率高"排序，命中即停**。这是 v2 相对 **Python 原型（文档里统称「v1」）** 提速的根本原因。
Rust 原作 `QRCodeScanner` 不在这个对比里——它只有 10 个变体 + 4 个角落裁剪、单引擎 bardecoder，
而且**本来就是命中即停**，只是不读命令行参数、只解 QR。
（三端的变体清单也各有出入，尤其浏览器端多了逐通道 R/G/B、少了 CLAHE / 自适应阈值，别把两边当同一份。）

---

## 二、Python 端：级联 + 早退

### 2.1 为什么 v1 慢

Python 原型对每张图**穷举** 18 种预处理变体 × 3 个引擎（zxing / cv2 / zbar），全部跑完才汇总——
13 张用例正好是 13 × 18 = 234 个阶段。绝大多数图片在**第一个变体**（原图）就已经能解出来，
后面的 17 个变体纯属浪费。具体实测数字集中在 [BENCHMARK.md](BENCHMARK.md)。

> Rust 原作不在这条对比里：它是 10 个变体 + 4 个角落裁剪、单引擎 bardecoder，且已经是「解出就 return」。

### 2.2 v2 的做法

`qrsuite/core.py` 的 `build_stages()` 生成一个**有序**变体序列，`Decoder.decode_arrays()`
逐级尝试，**一旦有命中立即停止**：

```
阶段 0   原图            ← 命中率最高、代价最低，绝大多数图在这一步就结束
阶段 1   灰度            ← 与原图是同一对数组，只是各引擎取用的入参不同
阶段 2   放大 2×         ← 仅小图（<700px）才生成，大图整条序列里没有它
阶段 3   Otsu 二值化
阶段 4   CLAHE
阶段 5   放大 3×         ← 同样仅小图
阶段 6   反色
阶段 7   自适应阈值
阶段 8   模糊 + Otsu 二值化
阶段 9-11 旋转 90 / 180 / 270°
阶段 12  锐化
阶段 13  中心裁剪
阶段 14-17 四角裁剪       ← 最贵，最后才用
```

小图（长边 <700px）共 18 个阶段；**大图跳过两个放大变体，只有 16 个**，所以上面的编号对大图整体前移两位。

关键点：变体由生成器 `build_stages()` 产出，**分辨率闸门决定生成哪些**——大图不会白白产出"放大 3×"
这种只会更慢的变体。但要注意 `decode_arrays()` 进来先做 `stages = list(build_stages(...))`，
把整条序列**一次性物化**后再按 `max_stages` 截断，所以「命中即停」省的是**引擎调用**，
并没有省掉后面那些变体的构造开销（想真正省掉，得把截断挪进生成器）。

### 2.3 三档模式

| 模式 | 阶段上限 | 引擎 | 定位 |
|---|---:|---|---|
| `fast` | 2 | zxing, cv2 | 单张秒出，只试原图/灰度 |
| `balanced`（默认） | 7 | zxing, cv2, zbar | 覆盖到二值化级别 |
| `deep` | 全部 | + wechat, original | 最难图；仍命中即停 |

### 2.4 引擎与惰性策略

| 引擎 | 依赖 | 特点 |
|---|---|---|
| `zxing` | zxing-cpp | 主力，多码制，速度快 |
| `cv2` | OpenCV QRCodeDetector | 与 zxing 互补 |
| `zbar` | pyzbar (libzbar) | 一维码强项 |
| `wechat` | OpenCV wechat_qrcode | **代价高**（约 20ms/张 + 固定初始化） |
| `original` | v1 的 QRCodeScanner.exe | 仅 deep、仅本地文件 |

`wechat` 被标记为**惰性引擎**（`LAZY_ENGINES`）：只在便宜引擎**全部失败后**才补跑一次。
它不放在默认 `balanced` 里——实测会让默认墙钟翻倍，而它多解出的图与
"抖音/赞赏码"无关（那类私有码它同样不支持），为默认路径付 2× 代价不划算。

码制覆盖并不对齐：`cv2` / `wechat` / `original` **只解 QR**，一维码靠 `zxing` 和 `zbar`
（DX Film Edge、Telepen 只有 `zxing` 能解；DataBar/RSS 系列 `zxing` 和 `zbar` 都行）。也因此 `--engines wechat` 必须
配 `--mode deep`——`--engines` 是与**该模式所用的引擎表取交集**，`wechat` 不在 fast/balanced 的表里，
单独指定会得到空集合，一个引擎都不跑。

### 2.5 其它优化

- **灰度只算一次**并全程复用；裁剪用数组切片（零拷贝）。v1 每个变体都做 PIL 往返。
- **分辨率闸门**：长边 >1800px 先降采样；只有小图才放大，避免"放大反而更慢"。
- **结果缓存**：本地服务按「图片哈希 + 模式 + 引擎集」缓存，重复请求直接命中。

---

## 三、浏览器端：零依赖静态站

- `docs/` 就是站点根目录，**零构建、零依赖**，任意静态托管可直接跑。
- jsQR + ZXing-js **已本地化进仓库**（`docs/vendor/`），不依赖任何 CDN，可完全离线。
- 浏览器侧码制由内置的 `zxing.min.js`（@zxing/library 0.23.0）决定：QR / Data Matrix / Aztec /
  PDF417 / 常用一维码都在；Micro QR、RSS-14、RSS-Expanded、MaxiCode 有读取器但**上游自己标注「待验证」**，
  本仓库没为它们做过样例实测；**DX Film Edge、Telepen 内置包里根本没有**（想要只能走 Python 端）。
  jsQR 只解 QR。`decode.js` 给 `MultiFormatReader` 只设了 `TRY_HARDER` + `ALSO_INVERTED`，
  没有设 `POSSIBLE_FORMATS`，所以是「全部已注册读取器都试一遍」。
- 解码跑在 **Web Worker** 里，界面不阻塞；主线程只负责交互与渲染。
- `file://` 下无法创建 Worker，自动**回退主线程**解码，并在顶部状态条说明当前环境。
- 可选**本机增强**：由 `python -m qrsuite --serve` 打开页面时（同源），`/health` 探测到后端就出现开关，
  可把图片交给 Python 端多引擎处理（网页版拿不到的 OpenCV/zbar 能力）。探测走**相对路径**，
  因此部署到静态托管（如 GitHub Pages）后即使本机服务在跑也连不上，该开关不出现。

> 注意：`file://` 下从 URL 加载的图片会污染 canvas（`getImageData` 抛 SecurityError），
> 因此自检二维码用 **data URI 内嵌**在 `app.js` 里。

### 3.1 灰度公式：彩色图上最容易踩的坑

浏览器端默认只把像素按亮度公式 `0.299R + 0.587G + 0.114B` 压成灰度。
**当图片颜色通道偏斜时，这个公式会把对比度压掉**，导致码明明清晰却判不出来。

真实案例（蓝色 LCD 屏上的二维码照片）：像素约 `(174, 230, 253)`，蓝色占绝对主导，
而亮度公式给蓝色只算 `0.114` 权重，于是

| 灰度方式 | 白底 | 码点 | 对比度 | 结果 |
|---|---:|---:|---:|---|
| 亮度公式 | 216 | 67 | 149 | ❌ 判不出 |
| **取 R 通道** | 174 | 0 | **177** | ✅ 解出 |

因此 `decode.js` 对**彩色图**会额外计算 R/G/B 三个通道，按**对比度从高到低**依次尝试
（每个通道先原图、再 Otsu）。这些阶段排在原有阶段之后且命中即停，所以简单图片
仍在前几步就结束，不付这份代价。

实测回归（43 张样例）：解出数 36 → 37（新增的正是那张蓝屏照片），
总耗时 6713ms → 6313ms，**无任何原有样例丢失**。

> 排查过程中排除的两条路，避免重复投入：
> - **中心裁剪 / 多尺度放大**：无效。该码只占整图 244px，中心裁剪裁不到（码不在正中），
>   整图放大又太慢。
> - **滑窗切块 + 放大**：30 块 / 5.7 秒仍失败，且码常被切在块边界上。
> - 另有一个"定位符几何外推"的实现被放弃了：虽然能定位到码，但真正起作用的是通道灰度，
>   加上定位器会显著增加复杂度与误报风险，故未并入。


---

## 四、Android 端：原生 CameraX + ML Kit

### 4.1 为什么不用 WebView

WebView 方案需要把 `docs/` 打进 assets，且相机/Worker 需要 https 源
（要用 `WebViewAssetLoader`）；解码跑 JS，**CPU 占用明显高于原生**。
所以选择原生：CameraX 取景 + ML Kit（C++ 推理），并配上真正的原生 UI。

### 4.2 降 CPU 的三个手段

1. **中央裁切**：只把与取景框对应的中央区域（屏幕方向 80%×52%）重排成 NV21 交给
   ML Kit，像素量约为全帧 40%。注意 ML Kit 会按 `rotationDegrees` 旋转，
   所以裁切要**先在屏幕方向算好再映射回缓冲区**。
2. **背压 KEEP_ONLY_LATEST**：识别跟不上时直接丢帧，不排队累积。
3. **720p 分析分辨率**：`setTargetResolution(1280, 720)` 足够识别二维码，
   比 1080p 少约 55% 像素。

### 4.3 其它

- **格式收敛**：`BarcodeScannerOptions` 只注册 QR/DataMatrix/Aztec/PDF417/常用一维码。
- **仅 arm64**：`.so` 只打 `arm64-v8a`，体积 23.4 MB → 7.59 MB。
- **零网络权限**：Manifest 里用 `tools:node="remove"` 显式移除依赖库合并进来的
  `INTERNET` / `ACCESS_NETWORK_STATE`，保证"图片不出设备"可被审计验证。
- 12 及以下没有 `READ_MEDIA_IMAGES`，相册选图走 `ACTION_GET_CONTENT` 回退。

---

## 五、已知能力边界

**标准二维码/条码**：三端都能解，且对轻微的 logo 遮挡、低对比、模糊、旋转有容错。
但三端码制集合并不相同（Micro QR：浏览器有读取器但上游标「待验证」/ Python ✅ / Android ❌；
DX Film Edge 与 Telepen：只有 Python 端的 zxing 能解），细节见 [MANUAL.md 的码制表](MANUAL.md)。

**样式化私有码**（抖音主页码、微信赞赏码/小程序码）：**解不了**，而且不是本项目的缺陷。
这类码的模块被渲染成**圆点/圆环**，破坏了标准 QR 解码依赖的两个前提：
定位符的 1:1:3:1:1 直线扫描判定、以及方块模块的采样网格。实测
`QRCodeDetector.detect()` 直接返回 `False`——**连"检测到码"都做不到**。

更根本的是，微信赞赏码/小程序码是**同心圆环结构**，数据按环排布，
还原链接或 `scene` 参数需要**平台服务端的业务密钥**；抖音码同理。
这已不属于解码器能力问题，而是平台私有加密协议。详见
[`NOTES-stylized-codes.md`](NOTES-stylized-codes.md)（含对若干第三方方案的评估结论）。

---

## 六、目录结构

```
qrsuite-v2/
├── README.md           门面（尽量短）
├── LICENSE             MIT
├── run.bat             Windows 菜单式入口
├── requirements.txt    Python 依赖
├── Documentation/      所有说明文档集中在这里
│   ├── MANUAL.md       使用手册（网页版 docs/manual.html 由它生成）
│   ├── ARCHITECTURE.md 本文
│   ├── BENCHMARK.md    实测数字的唯一出处
│   ├── LINEAGE.md      Rust 原作 / Python 原型 / v2 的关系
│   ├── ROADMAP.md      计划与明确不做
│   ├── CHANGELOG.md    版本变更
│   ├── THIRD_PARTY_NOTICES.md  第三方许可与原作二进制归属
│   └── NOTES-stylized-codes.md 私有样式化码的调研记录
├── qrsuite/            Python 包
│   ├── core.py         解码核心：引擎注册、预处理级联、早退与统计
│   ├── cli.py          命令行入口
│   ├── web.py          本地 HTTP 服务（结果缓存在这里，不在 core）
│   ├── winapp.py       Windows 单文件版入口
│   └── models.py       WeChatQRCode 模型下载（多镜像回退）
├── docs/               纯前端静态站（GitHub Pages 根目录）
│   ├── index.html      单页 UI（拖拽 / 粘贴 / 历史 / 导出）
│   ├── app.js  decode.js  decode.worker.js  sw.js  style.css  manifest.webmanifest
│   ├── i18n.js  lang.css   中英双语文案表与语言切换样式
│   ├── manual.html     手册网页版（构建产物）
│   └── vendor/         jsQR / ZXing-js（已本地化）
├── android/            Android 原生 App（Gradle 子项目）
│   └── app/src/main/java/com/qrsuite/scanner/
│       ├── MainActivity.java      相机 + 识别 + 面板
│       ├── ScanOverlayView.java   取景遮罩自绘
│       └── HistoryStore.java      历史记录（SQLite）
├── assets/             仓库用的介绍图与配图源文件（不属于站点）
├── tests/              smoke_test.py（引擎与早退自检）、bench.py（性能对比）
├── tools/              构建与实验脚本（build_manual.py 生成网页版手册、build_windows.py 打包+签名、
│                       qr_locate.py 定位符查找实验、exp_*.py 各类预处理实验）
└── .github/workflows/  android.yml（PR/push 编译 debug APK）、release.yml（`v*` tag 正式签名 Android）、
                        windows.yml（同一 tag 构建/签名单文件 exe）。Pages 仍走 branch 直发，无工作流
```

> 散文文档一律在 `Documentation/`，`docs/` 只放站点运行所需文件——这样 Pages 根目录干净，
> 也不会再把 ARCHITECTURE 之类误发布到线上。网页版手册 `docs/manual.html` 是个例外：
> 它是 `Documentation/MANUAL.md` 的生成产物，需要待在站点目录里供 Pages 访问，
> 由 `python tools/build_manual.py` 重建（依赖 `pip install markdown`）。
