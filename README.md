# QRSuite v2 · 多引擎二维码 / 条码识别

> 一个把「命令行工具 + 本地网页 + 多引擎解码」合并到一套代码里的二维码识别项目。
> **前半部分是纯前端静态站点，可直接部署到 GitHub Pages；后半部分是本地 Python 高精度引擎。**

**这是 [ZapcoMan/QRCodeScanner](https://github.com/ZapcoMan/QRCodeScanner) 的非官方重写版（二创）**，
由 [ZboY](https://github.com/ibsibxi) 维护。原作是 Rust 单文件 CLI（bardecoder 单引擎、仅交互式输入）；
本项目重写为「Python 多引擎 + 纯前端静态站 + Android 原生 App」三形态共存。
原作的源码与二进制版权归**原作者**所有，**不随本仓库分发**（详见 [LICENSE](LICENSE) 与
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。

[![Pages](https://img.shields.io/badge/GitHub%20Pages-ready-success)](#-部署到-github-pages)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)]()
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Android](https://img.shields.io/badge/Android-arm64-brightgreen)](android/)

**🟢 在线试用（无需安装）：<https://ibsibxi.github.io/qrsuite/>**
纯前端版本，图片不出浏览器；**界面支持中英切换**（右上角按钮，自动跟随浏览器语言）。
也可把 `docs/` 部署到你自己的静态托管。

## ⬇️ 下载

装好即用的版本在 [Releases](https://github.com/ibsibxi/qrsuite/releases/latest)：

| 平台 | 文件 | 说明 |
|---|---|---|
| **Android** | [QRSuite-2.3.0-arm64.apk](https://github.com/ibsibxi/qrsuite/releases/download/v2.3.0/QRSuite-2.3.0-arm64.apk) | 7.6 MB，原生 CameraX + ML Kit，**仅 arm64**（现代手机），正式签名，无网络权限，中/英切换 |
| **Windows** | [QRSuite.exe](https://github.com/ibsibxi/qrsuite/releases/download/v2.3.0/QRSuite.exe) | 80 MB，单文件版，双击启动本地服务并自动开浏览器 |
| **网页版** | <https://ibsibxi.github.io/qrsuite/> | 无需安装，纯前端离线可用（见上方「在线试用」） |

> 各端版本号含义不同：网页端 = `sw.js` 缓存版本（**2.3.0**）、Android = `versionName`（**2.1.2**，versionCode 4）、
> Python 包 = `qrsuite.__version__`（**2.1.1**）。三者是独立演进的功能集，Release 以网页端版本的 `v2.3.0` 统一打标。

> Android 装上后若曾装过 debug 签名版，需先卸载（签名不同无法覆盖安装）。
> Windows 目前**无数字签名**，SmartScreen 会提示"已保护你的电脑"，点"仍要运行"即可；
> 消除该提示需购买代码签名证书（见下方「Windows 代码签名」）。
> 仓库**有意不提交** `.apk` / `.exe`（二进制会污染版本历史），一律走 Releases 分发，源码仍可自行构建。

### Android 发布由 CI 自动完成

打 `v*` tag 即触发 `Android Release` 流程：构建**正式签名** APK → 自动校验"不是 debug 证书" → 上传到对应 Release。
签名材料存放于仓库 Secrets（`SIGNING_KEYSTORE_BASE64` 等），**密钥不进代码库**。

### Windows 代码签名（需自备证书）

`tools/build_windows.py` 支持构建后签名（走 Windows SDK 的 `signtool`）：

```powershell
# 1) 购买代码签名证书（OV 可逐步建立声誉，EV 立即受信），导入证书存储或保留 .pfx
# 2) 设置环境变量（不要写进任何仓库文件）
$env:QRSUITE_SIGN_PFX      = 'C:\path\to\codesign.pfx'
$env:QRSUITE_SIGN_PFX_PASS = '<口令>'
# 3) 构建并签名
python tools/build_windows.py --sign
```

CI 侧（`.github/workflows/windows.yml`）也支持：配置 `WINDOWS_CERT_PFX_BASE64` 与
`WINDOWS_CERT_PASSWORD` 两个 Secret 后，打 tag 会自动构建并签名 Windows 产物；
**未配置时照常构建，只是产物无签名**。

---

## ✨ 特性

> 📚 文档：[使用手册 MANUAL.md](MANUAL.md) · [网页版手册](docs/manual.html) · [变更记录 CHANGELOG.md](CHANGELOG.md)
>
> 🧩 样式化私有码（微信小程序码/赞赏码、抖音主页码）的识别能力与调研结论：见 **[HANDOFF-stylized.md](HANDOFF-stylized.md)**

| | |
|---|---|
| **多引擎并联** | zxing-cpp · OpenCV QRCodeDetector · zbar · WeChatQRCode(可选) · 原版 bardecoder |
| **多码制** | QR / MicroQR / DataMatrix / Aztec / PDF417 / Code128·39·93 / EAN·UPC / ITF / Codabar |
| **级联 + 早退** | 变体按「命中率高 / 代价低」排序，**命中即停**，不再无脑跑满全部变体 |
| **18 种预处理** | 灰度 · CLAHE · Otsu · 自适应阈值 · 模糊+二值化 · 锐化 · 反色 · 放大 2×/3× · 旋转 90/180/270° · 中心/四角裁剪 |
| **两种形态一套代码** | `qrsuite`（Python CLI + 本地服务）与 `docs/`（纯前端静态页）共享同一套解码策略 |
| **网页零依赖** | jsQR + ZXing-js 全部本地化进仓库，**不依赖任何 CDN**，可离线使用 |
| **浏览器内解码** | 图片不上传服务器；Worker 后台线程解码，界面不卡顿 |
| **可选本机增强** | 静态页检测到本地 Python 服务时，自动启用 OpenCV / zbar / bardecoder 等额外引擎 |
| **隐私** | 无埋点、无网络请求（除你主动输入的图片 URL） |
| **私有码结构判定** | 微信小程序码/赞赏码、抖音主页码等**平台私有**异形码：解不出内容，但会判定它是哪一家的码并提示用对应 App 扫（见 `qrsuite/stylized.py`） |

---

## 📊 实测基准（v1 vs v2，13 张图 / 6 种码制 + 7 种困难场景，同一台机器）

| 方案 | 墙钟 | CPU 时间 | 阶段总数 | 引擎调用 | 解出 |
|---|---:|---:|---:|---:|---:|
| v1 旧流程（18 变体全跑完，无早退） | 3.40 s | 6.78 s | 234 | — | 12/13 |
| **v2 `--mode fast`** | **0.3～0.5 s** | 0.6～1.1 s | **15** | 30 | 11/13 |
| **v2 `--mode balanced`（默认）** | **0.4～0.6 s** | 0.6～1.8 s | **21** | 63 | 12/13 |
| v2 `--mode deep`（含微信模型与 v1 程序） | 0.7～0.9 s | 1.2 s | 32 | 98 | 12/13 |

- **解出数量与 v1 持平（12/13）**，阶段总数从 234 降到 21（**约 11× 更少**）。
- **墙钟/CPU 为 3 次运行的区间**：本机测量噪声较大（同配置单次可差 ±0.2 s），
  因此给出区间而非单点值；早期版本曾记录 0.32 s 的单点值，那是加入 WeChat 引擎
  （固定初始化约 0.2 s）之前的数字，现默认模式已不再加载它。
- v1 的 CPU 时间 > 墙钟时间（6.78 > 3.40），说明多核跑满；v2 fast 更接近单核轻载。
- 浏览器端（jsQR + ZXing-js，Worker 内）：13 张平均 **44 ms/张**（fast）、平均只用 **1.2 个阶段**。

复现：`python tests/bench.py <图片目录>`（进程内计时，与原 v1 数字同口径）。
若同时给出 v1 脚本路径，会打印两者对比；脚本路径可在 `tests/bench.py` 顶部调整。

架构与设计取舍见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。

---

## 🚀 快速开始

### 方式一：网页版（推荐日常使用，也是 GitHub Pages 上的那一版）

```bash
pip install -r requirements.txt
python -m qrsuite --serve           # 自动打开浏览器 http://127.0.0.1:8765
```

Windows 直接双击 `run.bat`（菜单选 1）。

### 方式二：命令行

```bash
python -m qrsuite qr.png                        # 单张
python -m qrsuite ./pics --mode fast            # 目录递归 + 快速模式
python -m qrsuite "https://example.com/q.png"   # 图片 URL
python -m qrsuite ./pics --json out.json -v     # 输出 JSON 并打印每张的阶段/CPU 明细
python -m qrsuite qr.png --verify               # 交叉验证：需 ≥2 引擎一致才算成功
python -m qrsuite --fetch-models                # 下载 WeChatQRCode 模型（可选引擎）
```

### 方式三：纯前端（无需 Python）

直接双击 `docs/index.html` 即可用（拖拽 / 粘贴图片），或把 `docs/` 部署到任意静态托管。

---

## 🌐 部署到 GitHub Pages

`docs/` 就是站点根目录，**零构建、零依赖**（已含 `.nojekyll`）。

1. Fork / 克隆本项目，推送到你的 GitHub 仓库（分支 `main`）。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 `Deploy from a branch`，分支选 `main`、目录选 **`/docs`** → Save。
3. 等 1 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`。

> 说明：仓库自带的 GitHub Actions 工作流只有 `android.yml` / `release.yml` / `windows.yml`（分别用于构建 APK、发 Release、打包 Windows），**并没有 Pages 部署工作流**。网页发布直接用上方的 `Deploy from a branch`（源分支 `main`、目录 `/docs`）即可。

> 提示：Pages 是纯静态托管，**没有后端**，因此线上的网页使用浏览器端解码（jsQR + ZXing-js）。
> 需要 OpenCV / WeChatQRCode 这类更强引擎时，在本机跑 `python -m qrsuite --serve`，页面会自动出现「本机增强引擎」开关。

---

## 🧱 目录结构

```
qrsuite-v2/
├─ qrsuite/                 # Python 包（本地高精度版）
│  ├─ core.py               #   引擎注册 + 级联/早退策略 + 统计
│  ├─ cli.py                #   统一命令行入口（scan / serve / fetch-models）
│  ├─ web.py                #   本地 HTTP 服务（含结果缓存）
│  ├─ winapp.py             #   Windows 单文件版入口（启动本地服务并自动开浏览器）
│  ├─ stylized.py           #   样式化私有码结构识别（微信小程序码/赞赏码、抖音主页码）
│  └─ models.py             #   WeChatQRCode 模型下载（多镜像回退）
├─ docs/                    # ← GitHub Pages 站点根目录
│  ├─ index.html            #   单页 UI（拖拽 / 粘贴 / 历史 / 导出）
│  ├─ app.js                #   Worker 池、结果渲染、历史、可选后端
│  ├─ decode.worker.js      #   Web Worker：后台线程解码
│  ├─ decode.js             #   级联解码核心（worker 与 Node 双端可用）
│  ├─ style.css
│  └─ vendor/               #   jsQR.js + zxing.min.js（本地化，含各自 LICENSE）
├─ tests/
│  ├─ bench.py              # v1 vs v2 基准对比
│  ├─ smoke_test.py         # 冒烟测试（引擎可用性 + 端到端解码）
│  └─ test_stylized.py      # 私有码结构判定回归（判定 + 几何精度 + 性能预算）
├─ .github/workflows/         # android.yml · release.yml · windows.yml
├─ requirements.txt
├─ run.bat                  # Windows 一键入口（网页版 / 命令行 / 模型下载）
└─ LICENSE · THIRD_PARTY_NOTICES.md
```

---

## 🧩 解不出来的那类码（重要）

微信小程序码（菊花码/太阳码）、微信赞赏码、抖音主页码，以及各类"圆点/环形"样式化码，
**都是平台私有的编码方案**：协议未公开、无任何公开实现，且官方明确"只有自家 App 能解"。
本项目的实测结论（`tools/NOTES-stylized-codes.md`）：

- 4 个解码器 × 18 种预处理，对这类码**全部 0 命中**（连"检测到码"都做不到）；
- 即便解出来也没有额外收益：实测抖音客户端扫自家主页码，解出的 payload 是
  `snssdk1128://user/profile` —— 一条"打开某用户主页"的**明文深链**，不含路径/参数/票据；
- 抓包路线同样不通：抖音走自研 TTNet/Cronet 在 native 层直连，实测 `is_proxy=0`，绕过系统代理与 VPN。

因此本项目**不做**这类码的私有协议解码（涉及 ToS 与法律风险），而是：

> 全部引擎失败后，用 `qrsuite/stylized.py` 判定**这是哪一家的码**并给出准确提示，
> 例如"这是抖音主页码，请打开抖音 App「扫一扫」识别"。

命令行默认开启，可用 `--no-stylized` 关闭：

```powershell
python -m qrsuite 某张抖音码.jpg
#   ✗ 未解码（7 阶段 / 21 次引擎调用 / 1.04s）
#   ⓘ 结构判定: 抖音主页码（置信度 0.88）
#      定位点 4 个 · 圆心 (632.0, 680.8) · 约 126 线
#      这是抖音主页码（平台私有格式，无法离线解出内容）。请打开抖音 App「扫一扫」识别。
```

**已知限制**：普通二维码的三个定位符本来就构成等腰直角三角形，纯几何无法与微信牛眼区分，
故带噪 QR 可能被误判为微信族；实际管线中这类图会被标准引擎先解出，不会走到这一步。

---

## 🔍 解析策略（为什么更快）

1. **级联排序**：`原图 → Otsu 二值化 → 放大2× → 反色 → 旋转 → 裁剪 → 锐化 → 自适应阈值`，
   顺序按「命中率 / 计算代价」排，常见图在**第 1 阶段**就出结果。
2. **早退**：任一引擎解出即停止（`--verify` 时要求 ≥2 引擎一致）。
3. **分辨率闸门**：大图先缩到 1800px 再解码；只有小图（<700px）才做放大——避免最贵的无效变体。
4. **少拷贝**：灰度只算一次并复用，切片裁剪零拷贝，全程 NumPy/OpenCV 数组（v1 每个变体都做 PIL 往返）。
5. **缓存**：本地服务按「图片哈希 + 模式」缓存结果，同一张图重复打开即时返回。
6. **后台线程**：网页端解码全部在 Worker 里跑，主线程只做 UI；并发数按 CPU 核数自适应。

---

## 🤝 与原始项目的关系

本项目是 **v2 分支**，最初用于替代/增强原作者（朋友）那版 `QRCodeScanner.exe`：
v1 是 Rust 单文件 CLI，只有 bardecoder 单引擎、且**不读命令行参数**（`stdin` 交互输入）。
v2 保留了对 v1 的兼容（可作为 `original` 引擎一并调用），并重写了输入层、引擎层与交互层。

> 原版二进制与源码版权归原作者所有；请在合并进对方仓库前与其确认 License 与署名方式。

## 📄 License

本项目（v2 代码）采用 **MIT**，见 [LICENSE](LICENSE)。
第三方组件许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)（zxing-cpp、OpenCV、pyzbar/ZBar、jsQR、ZXing-js 等）。

## 🗺️ Roadmap

- [ ] 摄像头实时扫码（`getUserMedia` + 逐帧解码）
- [ ] WASM 引擎（ZXing-C++ WASM）替换 JS 版，进一步提升识别率
- [ ] PWA 离线安装（Service Worker 缓存 `docs/`）
- [ ] 批量导出 CSV / 二维码内容去重统计
- [ ] 条形码类型过滤与置信度评分
