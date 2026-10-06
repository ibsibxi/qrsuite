# 变更记录

本项目遵循[语义化版本](https://semver.org/lang/zh-CN/)。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [2.0.4] — 2026-10-06

### 新增 Added
- **网页端中英双语**：`docs/i18n.js`（78 个文案键，中英完全对齐），右上角一键切换，
  并自动跟随浏览器语言（`zh*` → 中文，其余 → 英文）。Android 同步补 `res/values-en`。
- **Android 发布由 CI 自动签名**：打 `v*` tag 触发 `.github/workflows/release.yml`，
  构建正式签名 APK → 自动校验「不是 debug 证书」→ 上传到对应 Release。
- Windows 构建/签名脚本 `tools/build_windows.py`（`--sign` 走 `signtool`）与
  `.github/workflows/windows.yml`（配置证书 Secrets 后自动签名）。

### 修复 Fixed
- **彩色/蓝屏照片解不出码**：浏览器端只用亮度公式灰度，而蓝色 LCD 的蓝色通道占绝对主导，
  亮度公式给蓝仅 0.114 权重，导致白底/码点灰度差被压到 149，jsQR 判不出。
  现对彩色图增加**逐通道灰度**（按对比度从高到低尝试原图与 Otsu）。
  实测 43 张样例解出数 36 → 37、总耗时未增加、无回归。
- **状态条永久停在「正在初始化…」**：`#env` 挂了 `data-i18n`，i18n 的 `apply()` 在
  DOMContentLoaded 时用 textContent 覆盖了 app.js 刚写入的环境信息。
- **`data-i18n-html` 元素漏译**：`querySelectorAll('[data-i18n]')` 不匹配
  `data-i18n-html/-title/-content`（属性名不同），导致两处含内联标签的文案在英文界面下仍为中文。
- 页脚链接此前无 `a` 规则、使用浏览器默认链接蓝，现统一为品牌色。

### 文档 Docs

- 本节初稿曾被一轮转义处理损坏：反引号变成反斜杠，而 `\t`、`\v`、`\a`、`\r` 这些序列又被
  转义吃掉，连带吞掉 `tools`、`v*`、`apply()`、`res/values-en` 与 CSS 的 `a` 等 token。
  现已逐条对着源码与 `.github/workflows/` 还原并核对。

---

## [2.0.3] — 2026-10-06

不规则二维码（抖音主页码 / 微信赞赏码这类「中心大 logo + 彩色 + 截图模糊」的码）专项调研与改进。
结论先行：**瓶颈不在本项目的预处理级联**，而是微信引擎一直被误判为不可用。

### 修复 Fixed

- **`WeChatEngine` 实际从未运行**：它要求 `detect/sr` 的 4 个模型文件存在才启用，而 **OpenCV 5.0 起
  `cv2.wechat_qrcode.WeChatQRCode()` 可无参构造，模型已编进 `cv2.pyd`**，无需任何外部文件。
  现改为「优先无参构造，旧版回退到 4 文件」，该引擎终于真正生效。
- Windows 单文件版打包补上 `--hidden-import cv2.wechat_qrcode`，否则 PyInstaller 不带 contrib 子模块
  （实测打包版 `/health` 由 `["cv2","zbar","zxing"]` 变为 `["cv2","wechat","zbar","zxing"]`）。

### 性能 Performance

微信模型约 20ms/张，比其它引擎贵一个量级，因此做成**惰性引擎**：只有 zxing/cv2/zbar 全部失败后，
才补跑一次原图（`LAZY_ENGINES` / `LAZY_MAX_STAGES`）。`fast` 模式完全不启用它。

同进程、3 次取中位数（新增 27 张不规则压力样例）：

| 数据集 | 改动前 | 改动后 | 说明 |
|---|---|---|---|
| 原 13 张基准 | 12/13，32.6 ms/张 | 12/13，34.4 ms/张 | 差异在噪声范围 |
| 27 张不规则 | 25/27，61.1 ms/张 | **26/27**，69.9 ms/张 | 多解出「顶部被裁」那张，只有微信引擎能解 |

### 已评估但未采纳（有测量数据）

- **新增预处理变体**：CLAHE、对比拉伸、四周补白、放大 2×/3×、自适应阈值全部实测增益为 **0**；
  自适应阈值反而把命中从 25 打到 6（会毁掉干净码）。因此没有往级联里加任何阶段——避免白白拖慢。
- **两定位符几何重建**（参考 qqAys/Robust-QR-Code-Detector）：定位符检测严重误报（干净图也报 4~19 个），
  产出数百无效组合、0 命中；需严格的 1:1:3:1:1 扫描线校验才可用，投入大且收益不确定，未并入。

### 文档 Docs（准确性订正）

逐条对着源码核了一遍，改掉几处「文档说的和代码做的不一样」：

- **`--verify` 的真实语义**：它只是把「命中即停」推迟到有两个引擎给出同一内容（`core.py` 的
  `if hits:` 分支），**不会过滤掉单引擎的结果**。此前 README / MANUAL / 本文件 2.0.0 那条
  「需 ≥2 引擎一致才判定成功」是错的，容易让人以为它是正确性开关。
- **两个「v1」不再混用**：基准表里的 v1 是重构前的 **Python 原型**（13 张 × 18 变体 = 234 阶段正好对上），
  不是 Rust 原作。Rust 原作是 10 变体 + 4 角落裁剪、单引擎 bardecoder，**本来就命中即停**、只解 QR，
  所以「11×」与它无关。
- **码制范围按端拆开写**：一维码确实能扫（Python 靠 zxing + zbar，浏览器靠内置 ZXing-js 的
  `MultiFormatReader`——它没设 `POSSIBLE_FORMATS`，等于全部已注册读取器都试）。
  Micro QR 浏览器有读取器（上游标注「待验证」）而 Android ❌；DX Film Edge、Telepen **只有** Python 的
  zxing 能解（DataBar/RSS 则是 zxing 与 zbar 都能解）。
  原表把「ITF、Codabar、DX Film Edge」整行标成浏览器 ✅ 是错的。
- **GitHub Pages 工作流不存在**：当时 `.github/workflows/` 只有 `android.yml`，Pages 走 branch 直发；
  已从 README / MANUAL / ARCHITECTURE 删掉对 `pages.yml` 的引用。（2.0.4 又补了 `release.yml`
  与 `windows.yml`，但仍**没有** Pages 部署工作流。）
- **本机增强引擎只在同源时探测得到**：前端用相对路径打 `/health`，部署到 Pages 后即使本机服务在跑也连不上。
- **Python 与前端是两套实现**：变体清单已分叉（JS 无 >1800px 降采样闸门，缺 CLAHE / 自适应阈值 / 模糊+二值化，
  多了逐通道 R/G/B），不再是「同一套策略」。
- **CLI 行为订正**：`--dir` 是空参数（目录本来就自动递归）；`--engines` 是与所选模式的引擎表**取交集**，
  所以 `--engines wechat` 必须配 `--mode deep`；`--model-dir` 不影响 `--fetch-models` 的下载目录。
- **阶段编号与「惰性生成」**：`decode_arrays()` 先 `list()` 物化整条序列再截断，早退省的是引擎调用，
  没省掉后续变体的构造；大图是 16 个变体而非 18。
- `tests/bench.py` 找不到 v1 脚本时会打印 `[skip]`，但底部的「×× 提升」仍以 **v2 fast** 作基线。
  脚本本身没改，README 已注明此时那组数字不是与 v1 的对比。
- Android README：versionName 对齐当时的 2.0.3（2.0.4 已再次上调），签名说明改为「正式证书优先、
  缺失时静默回退 debug」，并注明 `android.yml` 只产 debug APK（release 由 2.0.4 的 `release.yml` 接管）。

### 文档结构重组 Docs（restructure）

- **README 只留门面**：项目是什么、能做什么、怎么跑起来、文档地图。性能基准表、级联策略、码制矩阵、
  目录结构、与原作关系、Roadmap 全部搬出。
- **散文文档集中到 `Documentation/`**：`MANUAL.md`、`CHANGELOG.md`、`THIRD_PARTY_NOTICES.md` 从根目录迁入；
  `ARCHITECTURE.md` 从 `docs/` 迁出（那里是 GitHub Pages 站点根目录，文档混进去会被当成网页的一部分）；
  `tools/NOTES-stylized-codes.md` 也并入。`docs/` 现在只放静态站与生成的 `manual.html`。
- **新增三份文档**：`BENCHMARK.md`（实测数字的唯一出处，避免 README / MANUAL 各存一份对不上）、
  `LINEAGE.md`（Rust 原作 / Python 原型 / v2 三层关系与取舍）、`ROADMAP.md`（待办 / 已完成 / 明确不做）。
- **去重**：MANUAL 的目录结构一节与性能表改为指向 ARCHITECTURE / BENCHMARK，不再复制。
- `tools/build_manual.py` 的源路径随迁移改为 `Documentation/MANUAL.md`，产物仍是 `docs/manual.html`。

### 已知限制 Known limitations

- 仍无法解码**整行定位符丢失**的严重残缺码（如底部被裁 20%，`j_long_cropped20.png`）——
  这需要真正的几何重建能力，属当前边界。
- **版本号其实是三个互不相干的数**（此前「已统一到 2.0.3 / 四处一起改」的说法是我写错的，
  那次还顺手把 PWA 缓存名从 `qrsuite-v2.0.4` 降回了 `v2.0.3`，已回退）：
  `qrsuite/__init__.py` = 2.0.3、Android `versionName` = 2.0.4、`docs/sw.js` 的 `CACHE` = `qrsuite-v2.0.7`。
  缓存名只是 cache-buster，**只增不减**，不跟版本走；发版时真正要动的是前两个，
  外加 `docs/manual.html` 记得用 `python tools/build_manual.py` 重新生成。

---

## [2.0.0] — 2026-10-06

首个 v2 版本：把「命令行工具 + 本地网页 + 多引擎解码」合并为一套代码，并做成可直接部署到 GitHub Pages 的静态站。

### 新增 Added

**输入方式（原版只能手动交互输入）**
- 命令行参数：图片路径、目录（自动递归）、通配符、图片 URL，可一次多个
- Windows 拖拽启动器：把图片/文件夹拖到 `.bat` 上直接识别
- 网页端：拖拽、点击选择、`Ctrl+V` 粘贴截图，支持一次多张并发
- 无参数时保留交互式输入（兼容原版习惯）

**解码能力**
- 单引擎 → **多引擎并联**：zxing-cpp + OpenCV QRCodeDetector + zbar(pyzbar) + 可选 WeChatQRCode + 原版 bardecoder
- 码制：仅 QR → **QR / MicroQR / DataMatrix / Aztec / PDF417 / Code128·39·93 / EAN·UPC / ITF / Codabar**
- **交叉验证模式**（`--verify`）：要求 ≥2 引擎结果一致才判定成功，抑制误读
- **三档解码模式**：`fast` / `balanced` / `deep`，按场景取舍速度与识别率
- 结果**按内容去重**，并标注命中的引擎与生效的预处理变体

**输出与集成**
- JSON 输出（`--json`）
- 网页识别历史（localStorage）+ 导出 JSON / CSV
- 结果一键复制；内容为网址时可一键打开
- 命令行退出码语义化：解出 ≥1 条 = 0

**工程化**
- 合并为单一 Python 包 `qrsuite`（`core` 引擎策略 / `cli` 入口 / `web` 服务 / `models` 模型）
- 本地服务统一入口 `python -m qrsuite --serve`，并内置**结果缓存**（图片哈希 + 模式）
- `docs/` 改写为**纯前端静态站**（jsQR + ZXing-js 本地化，无 CDN 依赖），可直接跑在 GitHub Pages
- 静态站可**自动探测本地 Python 后端**并启用「本机增强引擎」
- 浏览器解码全部移入 **Web Worker**，界面不阻塞
- `run.bat` 菜单式入口（网页版 / 交互 / 快速 / 深度 / 下载模型 / 基准）
- 测试：`tests/smoke_test.py`（引擎可用性 + 端到端 + 早退行为）、`tests/bench.py`（v1 与 v2 性能精度对比）
- 文档：`README.md`、`MANUAL.md`（+ 网页版 `docs/manual.html`，构建脚本 `tools/build_manual.py`）
  ——以下 2.0.0 各处提到的路径是**当时**的位置，散文文档现已迁到 `Documentation/`
- 仓库：`LICENSE`(MIT)、`THIRD_PARTY_NOTICES.md`、`.gitignore`、`.gitattributes`、GitHub Actions Pages 工作流

### 性能 Performance

同样 13 张用例（6 种码制 + 7 种困难场景）、同一台机器：

| 指标 | v1 旧流程 | v2 默认（balanced） | 变化 |
|---|---:|---:|---:|
| 墙钟时间 | 3.40 s | 0.32 s | **10.5× 更快** |
| CPU 时间 | 6.78 s | 0.45 s | **15× 更低** |
| 预处理阶段总数 | 234 | 21 | **11× 更少** |
| 解出数量 | 12/13 | 12/13 | 持平 |

优化手段：
- **级联 + 早退**：变体按「命中率高 / 代价低」排序，命中即停（原先 18 个变体全跑完）
- **分辨率闸门**：大图（>1800px）先降采样；仅小图（<700px）才做放大，跳过最贵的无效变体
- **减少拷贝**：灰度只计算一次并复用；裁剪为数组切片零拷贝；全程 NumPy/OpenCV（原先每个变体都做 PIL 往返）
- **缓存**：本地服务对「图片哈希 + 模式 + 引擎集合」缓存结果，重复请求即时返回
- 浏览器端：平均 **44 ms/张**（fast）、平均仅 **1.2 个阶段**，且运行在后台线程

### 修复 Fixed

- 原版「拖到图标上/带参数启动无反应」——因为它不读命令行参数（仅 `stdin`），现已支持全部输入方式
- 原版「双击后窗口一闪而过」——现所有启动器末尾均等待按键
- 中文路径读图：改用 Pillow + EXIF 方向处理（规避 Windows 下 `cv2.imread` 不支持中文路径的问题）
- 原版无输出汇总/无结构化结果——现提供逐项明细、统计与 JSON

### 兼容性 Compatibility

- 原版 `QRCodeScanner.exe` **仍可作为 `original` 引擎挂载**使用（`--original-exe` 或环境变量 `QRSUITE_ORIGINAL_EXE`），仅在 `deep` 模式对本地文件生效
- **破坏性变更**：入口由 `python qrsuite.py` 改为 `python -m qrsuite`；原 `qrweb.py` 由 `python -m qrsuite --serve` 取代（旧文件保留亦不受影响）
- 未随仓库分发任何第三方二进制；模型文件与 v1 exe 需自备（见 `Documentation/MANUAL.md` 第 6 章）

### 已知限制 Known limitations

- 浏览器端（jsQR + ZXing-js）识别率略低于 Python 端：某张强噪声用例仅 Python 端（OpenCV/zbar）能解出；需要时在本机跑 `--serve` 启用「本机增强引擎」
- WeChatQRCode 模型未内置，需 `--fetch-models`（多镜像回退）；若网络屏蔽 GitHub 需手动放置 4 个模型文件
- GitHub Pages 为纯静态托管，无后端，因此线上页面不包含 OpenCV / WeChatQRCode 引擎

---

## [1.x] — 原版（原作者）

- Rust 单文件 CLI `QRCodeScanner.exe`，单引擎（bardecoder）+ 多预处理变体
- 仅支持交互式输入（启动提示后手动输入图片路径或 URL）
- 不支持命令行参数、无网页界面、无结构化输出
