# QRSuite v2 使用手册

> 多引擎二维码 / 条码识别工具 · 命令行 + 本地网页 + 纯前端静态页
> 版本 2.0 · 适用 Windows / macOS / Linux（Python 3.10+）

---

## 目录

- [0. 一分钟上手](#0-一分钟上手)
- [1. 这是什么，能识别什么](#1-这是什么能识别什么)
- [2. 安装与运行要求](#2-安装与运行要求)
- [3. 网页版使用详解](#3-网页版使用详解)
- [4. 命令行使用详解](#4-命令行使用详解)
- [5. Windows 一键启动器](#5-windows-一键启动器)
- [6. 可选增强引擎](#6-可选增强引擎)
- [7. 识别不出来怎么办（排查清单）](#7-识别不出来怎么办排查清单)
- [8. 常见问题 FAQ](#8-常见问题-faq)
- [9. 部署与维护（给维护者）](#9-部署与维护给维护者)
- [10. 附录](#10-附录)

---

## 0. 一分钟上手

| 你想干什么 | 怎么做 |
|---|---|
| **拖张图片进去就出结果** | 双击 `run.bat` → 选 `1` → 浏览器打开后把图片拖进页面 |
| **不改任何东西，直接看** | 双击 `docs/index.html`（纯前端，无需 Python） |
| **批量扫一个文件夹** | `python -m qrsuite D:\pics --mode fast` |
| **识别一个网络图片链接** | `python -m qrsuite "https://example.com/qr.png"` |
| **给同事用（网页）** | 把仓库 `docs/` 部署到 GitHub Pages，发链接即可 |

---

## 1. 这是什么，能识别什么

QRSuite 把「解码引擎」和「输入方式」拆开组合：**同一套级联思路在两边各写一遍**（Python 与浏览器
不共享代码，变体清单也已有差异），既能在 Python 里跑（高精度），也能在浏览器里跑（零安装）。

### 支持的码制

一维码（条形码）和二维码都能读，但**三端覆盖范围不同**——差别集中在 Micro QR 和最后两行：

| 类别 | 格式 | 浏览器版 | Python 版 | Android 版 |
|---|---|---|---|---|
| 二维码 | QR Code | ✅ | ✅ | ✅ |
| 二维码 | Micro QR | ⚠️（ZXing-js 有读取器，上游标为「待验证」） | ✅（zxing-cpp） | ❌（ML Kit 不支持） |
| 二维码 | Data Matrix | ✅ | ✅ | ✅ |
| 二维码 | Aztec | ✅ | ✅ | ✅ |
| 二维码 | PDF417 | ✅ | ✅ | ✅ |
| 一维码 | Code 128 / Code 39 / Code 93 | ✅ | ✅ | ✅ |
| 一维码 | EAN-8/13、UPC-A/E | ✅ | ✅ | ✅ |
| 一维码 | ITF、Codabar | ✅ | ✅ | ✅ |
| 一维码 | DataBar / RSS-14 / RSS Expanded | ⚠️（ZXing-js 名义支持，上游标「待验证」，本仓库未做样例实测） | ✅（zxing-cpp；RSS 系列 zbar 也能解） | ❌ |
| 一维码 | DX Film Edge、Telepen | ❌ | ✅（仅 zxing-cpp，需 2.2+） | ❌ |

> 浏览器侧的码制范围由仓库内置的 `docs/vendor/zxing.min.js`（@zxing/library 0.23.0）决定，
> 它没有 `POSSIBLE_FORMATS` 限制时会把已注册的读取器全试一遍；标 ⚠️ 的几项是上游自己声明
> 「尚未充分验证」的，真用到关键流程前请先拿样例图实测。
> Android 侧由 `MainActivity` 里 `BarcodeScannerOptions` 注册的格式决定（不含 Micro QR）。
> Python 侧 `cv2` / `wechat` / `original` 三个引擎**只解 QR**，一维码靠 `zxing` 与 `zbar`。

### 引擎一览（并联，结果按内容去重）

| 引擎 | 运行位置 | 特点 |
|---|---|---|
| **zxing-cpp** | Python | 主力，码制最全、识别率最高（DX Film Edge、Telepen 只有它能解） |
| **OpenCV QRCodeDetector** | Python | 抗噪、抗低质量，常与 zxing 互补；**只解 QR** |
| **zbar (pyzbar)** | Python | 一维码稳健；QR 也能解 |
| **WeChatQRCode** | Python（可选） | 小图/模糊码兜底；**只解 QR**，代价高，deep 模式才补跑 |
| **original（Rust 原作 QRCodeScanner.exe）** | Python 起子进程（可选） | 走原作那条「10 变体 + 4 角落裁剪」链路兜底，只解 QR，慢 |
| **jsQR** | 浏览器 | 极快、体积小，专攻 QR |
| **ZXing-js** | 浏览器 | 浏览器侧的多码制选手（含 Micro QR，不含 DX Film Edge） |

---

## 2. 安装与运行要求

### 2.1 只用网页版（推荐）

- **不需要安装任何东西**。双击 `docs/index.html` 即可（Chrome / Edge / Firefox / Safari 现代版本）。
- 想用「本机增强引擎」（OpenCV / zbar / WeChatQRCode）才需要 Python。

### 2.2 用 Python 版

```bash
# 1) 确认 Python
python --version          # 需要 3.10 以上

# 2) 安装依赖（在项目根目录执行）
python -m pip install -r requirements.txt

# 3) 自检（应输出 ALL PASSED）
python tests/smoke_test.py

# 4) 启动网页版
python -m qrsuite --serve
```

依赖清单（`requirements.txt`）：

| 包 | 作用 | 是否必需 |
|---|---|---|
| `zxing-cpp` | 主力解码引擎 | 建议 |
| `opencv-contrib-python-headless` | QRCodeDetector、图像预处理、WeChatQRCode | 建议 |
| `pyzbar` | 一维码引擎 | 建议 |
| `Pillow` | 读图（兼容中文路径、EXIF 方向） | 必需 |
| `numpy` | 数组运算 | 必需 |

> 只装 `Pillow + numpy` 也能跑（无引擎时会提示「至少 1 个引擎可用」失败）。至少要装 `zxing-cpp` 或 `opencv` 之一。

---

## 3. 网页版使用详解

### 3.1 三种打开方式

| 方式 | 命令 / 操作 | 适用 |
|---|---|---|
| **本地服务**（推荐） | `python -m qrsuite --serve` 或 `run.bat` 选 1 | 想要「本机增强引擎」+ 可分享给同机其他程序 |
| **直接打开文件** | 双击 `docs/index.html` | 什么都不装，快速用 |
| **线上部署** | 部署 `docs/` 到 GitHub Pages | 发给别人用，手机也能开 |

本地服务默认端口 **8765**，被占用会自动顺延（8765 → 8784）。启动后浏览器会自动打开；关闭命令行窗口即停止服务。

### 3.2 三种投喂图片的方式

1. **拖拽**：把图片拖到中间的虚线框（可以一次拖多张，或直接拖一个文件夹里的多张）。
2. **点击**：点虚线框 → 选择文件（可多选）。
3. **粘贴**：`Ctrl+V` 直接粘贴剪贴板里的截图（QQ / 微信 / 系统截图工具都行）。

> 支持：PNG / JPG / JPEG / GIF / BMP / WEBP。**图片不会被上传**，全部在你本机内存里解码。

### 3.3 三个模式怎么选

| 模式 | 尝试的阶段 | 速度（实测） | 什么时候用 |
|---|---|---|---|
| **快速** | 原图、Otsu 二值化 | ~44 ms/张 | 截图/标准二维码，追求最省 CPU |
| **均衡**（默认） | 前 7 个阶段（顺序见下方说明，含反色；大图还能走到旋转与中心裁剪） | ~80 ms/张 | 日常万能，命中即停 |
| **深度** | 全部阶段（另含逐通道 Otsu、四角裁剪、锐化） | 0.5~1.5 s/张 | 模糊、反色、倾斜、局部损坏的疑难图 |

> 这里的阶段清单是**浏览器端**（`docs/decode.js`）自己的：
> `原图 → Otsu →（小图才）放大2× → 反色 →（彩色图才）通道 R/G/B → 通道 R/G/B + Otsu → 旋转 90/180/270° → 中心裁剪 → 四角裁剪 → 锐化`。
> 所以「均衡」在一张大图灰度码上大约试到 中心裁剪，在一张小尺寸彩色图上大约试到 通道 B 就停了。
> **Python 命令行端的清单不一样**（多 CLAHE / 自适应阈值 / 模糊+二值化，少逐通道变体，且大图先降到 1800px），
> 它的「均衡」只有 原图/灰度/Otsu/CLAHE/反色/自适应阈值/模糊+二值化，**旋转和裁剪要 `--mode deep` 才会试**。

页面上的「阶段」就是本次实际尝试的预处理变体数量——**数字越小说明越早命中**（页面上会标注「早退」）。

### 3.4 交叉验证

勾选 **交叉验证** 后，命中不再是「第一个引擎解出就停」，而是**推迟到有两个引擎给出相同内容才停**，
用来确认结果不是单引擎的误读。

> 要说清楚它**做不到**的事：如果跑完全部阶段始终只有单个引擎解出，结果**仍会照常返回**，
> 并不会因为「凑不齐两个引擎」而判为失败。所以它是「更晚停、更多重复确认」，不是硬性的正确性门槛。
> 适合场景：内容要拿去做敏感操作（付款、登录），宁可多花点时间确认，也别拿一个可疑字符串去执行。

### 3.5 本机增强引擎（只有本地服务才有）

用 `python -m qrsuite --serve` 打开时，页面会自动探测到后端，多出一个开关：

- **勾选**：浏览器解码之外，再把图片交给本机 Python 引擎跑一遍，结果合并展示（引擎徽章会带 `py:` 前缀，例如 `py:cv2`、`py:zbar`）。
- **不勾选**：纯浏览器解码，最省资源。

GitHub Pages 上没有后端，所以这个开关不会出现。

### 3.6 结果卡片怎么读

```
┌──────┐  h_noise.png
│ 缩略图│  290×290 · 解出 1 条 · 87ms · 3 阶段 · 早退 · 本机增强
│      │  ┌────────┐ ┌──────────┐ ┌────────────────┐
│      │  │ QRCode │ │ py:zxing │ │ Otsu二值化 放大2倍 │
└──────┘  └────────┘ └──────────┘ └────────────────┘
          HARD-QR-2026                     [复制] [打开链接]
```

| 元素 | 含义 |
|---|---|
| 黄色徽章 | **码制**（QRCode / PDF417 / CODE_128 …） |
| 绿色徽章 | **命中的引擎**（`py:` 前缀 = 来自本机 Python 后端） |
| 灰色徽章 | **生效的预处理变体**（最多显示 4 个） |
| `3 阶段 · 早退` | 只试了 3 个变体就命中，后面的没跑（省 CPU） |
| `[复制]` | 复制识别内容到剪贴板 |
| `[打开链接]` | 内容是网址时直接用浏览器打开 |

### 3.7 识别历史与导出

- 所有结果自动存进**本机浏览器**的 `localStorage`（不上传、不过期，默认保留最近 200 条）。
- 页面底部「识别历史」：点内容即复制；「导出 JSON」给程序用；「导出 CSV」用 Excel 打开（已加 BOM，中文不乱码）。
- 「清空」只清当前浏览器里的记录。

### 3.8 性能与并发

- 解码跑在 **Web Worker 后台线程**，界面不会卡；并发数 = CPU 核数 − 1（最多 4）。
- 多张图会排队并行解码，一张失败不影响其他张。

---

## 4. 命令行使用详解

### 4.1 基本用法

```bash
python -m qrsuite <图片/目录/URL> [更多输入...] [选项]
```

### 4.2 常用示例

```bash
# 单张图片
python -m qrsuite qr.png

# 一次多张
python -m qrsuite a.png b.jpg c.webp

# 整个目录（自动递归子目录）
python -m qrsuite D:\pics

# 通配符
python -m qrsuite "D:\pics\*.png"

# 图片 URL（会先下载再解码）
python -m qrsuite "https://example.com/qr.png"

# 快速模式 + 打印每张的明细
python -m qrsuite D:\pics --mode fast -v

# 结果存 JSON
python -m qrsuite D:\pics --json result.json

# 交叉验证（推迟早退：直到有 ≥2 引擎给出同一内容才停）
python -m qrsuite qr.png --verify

# 只用一个引擎（排障用）
python -m qrsuite qr.png --engines zxing

# 只让微信引擎干活（必须配 --mode deep，否则见 4.3 的说明）
python -m qrsuite qr.png --mode deep --engines wechat

# 交互式（不带参数时，回车后输入路径或 URL，多个用逗号分隔）
python -m qrsuite
```

### 4.3 全部参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `paths...` | 图片路径 / 目录 / 通配符 / 图片 URL，可多个 | 无（缺省转交互输入） |
| `--mode {fast,balanced,deep}` | 解码深度 | `balanced` |
| `--verify` | 交叉验证：推迟「命中即停」，直到有 ≥2 引擎给出同一内容；始终只有单引擎结果时也会照常返回 | 关 |
| `--engines LIST` | 只启用指定引擎，逗号分隔：`zxing,cv2,zbar,wechat,original`。注意它是与**当前模式所用引擎**取交集：`wechat`/`original` 只在 `deep` 的模式表里，所以 `--engines wechat` 要配 `--mode deep`，否则一个引擎都不会跑 | 全部可用引擎 |
| `--max-side N` | 大图先缩放到该边长（像素），降低 CPU | `1800` |
| `--dir` | 保留参数，**当前版本不改变行为**：`paths` 里给目录本来就会递归 | 关 |
| `--json FILE` | 结果写入 JSON | 无 |
| `-v, --verbose` | 打印每张的阶段数 / 引擎调用数 / CPU 时间 / 是否早退 | 关 |
| `--serve` | 启动本地网页服务 | — |
| `--port N` | 网页服务端口 | `8765` |
| `--no-browser` | 启动服务时不自动开浏览器 | 关 |
| `--fetch-models` | 下载 WeChatQRCode 模型（可选引擎） | — |
| `--original-exe PATH` | 挂载 v1 的 `QRCodeScanner.exe` 作为 `original` 引擎 | 读环境变量 `QRSUITE_ORIGINAL_EXE` |
| `--model-dir PATH` | WeChatQRCode 模型目录（供**识别时**加载） | `qrsuite/wechat_models` |

> `--model-dir` 只影响解码时去哪里找模型；`--fetch-models` 目前**固定下载到包内默认目录**
> `qrsuite/wechat_models/`，不认这个参数。两者要用同一个目录，就别改 `--model-dir`。

### 4.4 输出解读

```
[1/13] ..\cases\h_noise.png
  ✓ [QRCode] HARD-QR-2026
     引擎: zxing | 生效变体: Otsu二值化
     阶段 3 / 引擎调用 6 / 用时 0.087s / CPU 0.081s / 早退      ← 只有 -v 才有这行
------------------------------------------------------------------------------
完成: 13 个输入, 解出 12 条, 墙钟 0.32s, CPU 0.45s, 平均 0.025s/张
```

- **墙钟**：真实等待时间；**CPU 时间**：真正占用的 CPU（多线程引擎会大于墙钟）。
- **阶段**：实际尝试的预处理变体数；**引擎调用**：真正调用的引擎次数。
- 退出码：解出至少 1 条 = `0`，一条都没解出 = `1`（方便脚本判断）。

### 4.5 在脚本/批处理里用

```bat
:: Windows 批处理：扫描拖进来的文件
python -m qrsuite %* --json out.json
if errorlevel 1 echo 没有识别出任何二维码
```

```bash
# Linux/macOS：管道 + jq
python -m qrsuite ./pics --json out.json >/dev/null && jq -r '.[].text' out.json
```

---

## 5. Windows 一键启动器

| 文件 | 位置 | 作用 |
|---|---|---|
| `run.bat` | 项目根目录 | 菜单式入口：网页版 / 交互识别 / 快速扫目录 / 深度扫目录 / 下载模型 / 跑基准 |
| `二维码网页版.bat` | `E:\ToolDownloads` | 直接拉起 v1 本地网页服务（旧版） |
| `二维码识别增强版.bat` | `E:\ToolDownloads` | 命令行版：把图片/文件夹**拖到 bat 上**直接识别 |
| `二维码扫描器.bat` | `E:\ToolDownloads` | 只调用 v1 原程序（单引擎） |

**拖拽用法**：把图片或文件夹拖到 `.bat` 图标上松手即可，结果留在窗口里（末尾有 `pause`，窗口不会一闪而过）。

---

## 6. 可选增强引擎

### 6.1 WeChatQRCode（专治小图/模糊码）

它带超分模型，对「小而糊」的二维码效果明显。**是否需要自己下模型，取决于 OpenCV 版本**：

- **OpenCV 5.0+**（本仓库 `requirements.txt` 装的 contrib 包新版本即属此类）：
  `cv2.wechat_qrcode.WeChatQRCode()` 可无参构造，**模型已编进 `cv2.pyd`，不需要任何外部文件**，
  装好依赖就自动出现 `wechat` 引擎。
- **OpenCV 4.x**：仍需 `detect.prototxt / detect.caffemodel / sr.prototxt / sr.caffemodel` 四个文件，
  放到 `qrsuite/wechat_models/` 才会启用。

4.x 下可以用脚本抓取：

```bash
python -m qrsuite --fetch-models
```

```
qrsuite/wechat_models/
├─ detect.prototxt
├─ detect.caffemodel
├─ sr.prototxt
└─ sr.caffemodel
```

> 已知坑：`qrsuite/models.py` 里两个 `.prototxt` 取的是 `opencv/opencv` 主仓库路径，
> 而 wechat_qrcode 模块实际在 **opencv_contrib**；镜像列表里还有一个不存在的域名。
> 因此 4.x 上 `--fetch-models` 可能只有两个 `.caffemodel` 成功、`.prototxt` 全部镜像失败。
> 遇到这种情况直接从 contrib 仓库手动取四个文件放进上面的目录即可——
> **下载失败不影响其它引擎**，`wechat` 只是不出现在引擎列表里。

### 6.2 挂载 v1 原程序

```bash
# 临时指定
python -m qrsuite qr.png --mode deep --original-exe "E:\ToolDownloads\QRCodeScanner.exe"

# 或设环境变量，之后一直生效
set QRSUITE_ORIGINAL_EXE=E:\ToolDownloads\QRCodeScanner.exe
```

只在 `--mode deep` 且输入是本地文件时才会调用它（需要写临时文件、启动子进程，较慢）。

---

## 7. 识别不出来怎么办（排查清单）

按顺序试，通常第 2~4 步就能解决：

1. **换模式**：`--mode deep`（或页面切「深度」）。
2. **剪裁重试**：把二维码区域单独裁出来再识别（页面已内置四角/中心裁剪变体，但人工裁剪更狠）。
3. **放大或缩小**：太小的图先放大到 ≥300px；太大的截图先缩到 1800px 以内（`--max-side 1800`）。
4. **加对比度 / 去反色**：深色底浅色码、屏摄反光、低对比度截图，先做「反色 + 二值化」再试。
5. **怀疑误读时**：加 `-v` 看结果卡片上的引擎徽章，或用 `--engines zxing` / `--engines cv2` 分别重跑，
   比对内容是否一致。勾选「交叉验证」**不能过滤掉单引擎的结果**——它只是把「命中即停」推迟到
   两个引擎给出同一内容，凑不齐时照样返回已解到的字符串，所以别把它当成正确性开关。
6. **确认码制**：PDF417 / DataMatrix / Aztec 在浏览器版也支持；如果是一维码，注意别裁掉两端的静区（留白）。
7. **确认不是"半张码"**：二维码被裁掉一半、或关键定位角缺失时，**任何解码器都无能为力**，只能找回原图。
8. **排障单引擎**：`--engines zxing -v`、`--engines cv2 -v` 分别跑，看是哪个引擎能出结果。

---

## 8. 常见问题 FAQ

**Q：网页点开是空白 / 一直转圈？**
A：确认 `docs/vendor/jsQR.js`、`docs/vendor/zxing.min.js` 存在。若从 GitHub Pages 打开，检查仓库 Settings → Pages 的目录是否选了 `/docs`。浏览器 F12 看 Console 报错最准。

**Q：端口 8765 被占用？**
A：程序会自动顺延到 8766…8784。也可以手动指定：`python -m qrsuite --serve --port 9000`。

**Q：`pip install` 很慢或失败？**
A：换国内源：`python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`。

**Q：中文路径/中文文件名读不了？**
A：Python 版用 Pillow 读图并做了 EXIF 方向处理，中文路径没问题。若你用其它库自行调用，注意 Windows 上 `cv2.imread` 不支持中文路径（本项目已规避）。

**Q：杀毒软件报警？**
A：仓库里只有源码，`.bat` 也只是调用 Python，不带任何可执行文件。官方 Releases 里的 **Windows 单文件版
`QRSuite.exe` 是 PyInstaller 打的**，这类自解压包被杀软误报、被 SmartScreen 拦「已保护你的电脑」都很常见；
未配置代码签名证书时它必然是未签名的（签名流程见 9.5）。若你保留了 v1 的 `QRCodeScanner.exe`，那是原作自己的
未签名产物，与本项目无关。介意的话直接用 `python -m qrsuite` 或网页版。

**Q：图片会被上传吗？**
A：不会。本地服务只监听 `127.0.0.1`，浏览器版全部在本机内存解码。唯一的网络请求是你在命令行里**主动**传入图片 URL 时的那次下载。

**Q：识别结果里同时出现多个引擎徽章，是重复了吗？**
A：不是。同一内容被多个引擎确认，**置信度更高**；结果按内容去重，只显示一条。

**Q：能识别手机拍屏幕的照片吗？**
A：能，但屏摄会有摩尔纹和反光。建议用「深度」模式，并尽量让二维码占画面一半以上。

**Q：能同时处理多少张？**
A：没有硬上限。页面按 CPU 核数并发解码（最多 4 个 Worker）；命令行一张张顺序处理。

---

## 9. 部署与维护（给维护者）

### 9.1 部署到 GitHub Pages

1. 推送到 GitHub（分支 `main`）。
2. **Settings → Pages → Source**：选 `Deploy from a branch` → `main` → `/docs`，保存后 1 分钟上线。
3. 访问 `https://<用户名>.github.io/<仓库名>/`。

> 本仓库**没有** Pages 部署工作流，静态站走 branch 直发（就是上面第 2 步）。
> `.github/workflows/` 下的三个文件都不涉及 Pages：`android.yml`（PR/push 跑 `:app:assembleDebug`，
> 只验证能编译并上传 debug APK）、`release.yml`（打 `v*` tag 时正式签名并attach Release）、
> `windows.yml`（同一 tag 构建单文件 exe）。想用 Actions 发布 Pages 需自建 `pages.yml`
> （`actions/upload-pages-artifact` 指定 `path: docs` + `actions/deploy-pages`），再把 Source 切成 `GitHub Actions`。

> `docs/` 已包含 `.nojekyll`，且所有前端资源本地化，无 CDN 依赖，离线也能用。

### 9.2 升级前端解码库

```bash
npm pack jsqr@latest               # 或用 npm registry 直接下载 tgz
npm pack @zxing/library@latest
# 解包后替换 docs/vendor/jsQR.js 与 docs/vendor/zxing.min.js
# 同时更新 docs/vendor/LICENSE.*.txt 与 Documentation/THIRD_PARTY_NOTICES.md 中的版本号
node --check docs/decode.js        # 语法自检
```

### 9.3 回归测试

```bash
python tests/smoke_test.py                      # 引擎可用性 + 端到端 + 早退行为
python tests/bench.py ./cases /path/to/v1.py    # 性能/精度基准对比
node -e "require('./docs/decode.js')"           # 前端解码模块可加载
```

### 9.4 发版建议

- 语义化版本：破坏性改动 `3.0.0`，新引擎/新模式 `2.1.0`，修复 `2.0.1`。
- **三个版本号互不相干，别指望它们一致**（2.0.4 时的真实值写在括号里）：
  - `qrsuite/__init__.py` 的 `__version__`（2.0.3）——Python 版自己的版本；
  - `android/app/build.gradle` 的 `versionName` / `versionCode`（2.0.4 / 2）——Android 独立的版本，
    `release.yml` 用 `versionName` 拼产物文件名 `QRSuite-<versionName>-arm64.apk`，`versionCode` 必须单调递增；
  - `docs/sw.js` 的 `CACHE`（`qrsuite-v2.0.7`）——**只是 PWA cache-buster，只增不减，不跟版本号绑定**，
    它的唯一作用是让新资源上线时旧缓存失效。
- 发版时还要：`Documentation/CHANGELOG.md` 新增一节；改过 MANUAL / README 的手册链接后重新生成
  `pip install markdown && python tools/build_manual.py`（产出 `docs/manual.html`）。

### 9.5 发布与签名（Android / Windows）

两条链路都由打 tag 触发（`v*`），也可以用 `workflow_dispatch` 手动补发同一个 tag。
产物都由 `gh release upload <tag> … --clobber` 挂到对应 Release（不存在则 `gh release create`）。

**Android** —— `.github/workflows/release.yml`

1. 在仓库 Settings → Secrets and variables → Actions 里配四个 Secrets（keystore 绝不入库）：
   `SIGNING_KEYSTORE_BASE64`（`base64 -w0 release.jks` 的结果）、`SIGNING_STORE_PASSWORD`、
   `SIGNING_KEY_ALIAS`、`SIGNING_KEY_PASSWORD`。
2. `git tag v2.0.4 && git push <分发该 Release 的远端> v2.0.4`，工作流还原 keystore → `:app:assembleRelease`。
3. 工作流用 `apksigner verify --print-certs` 检查证书，**只要出现 `CN=Android Debug` 就失败退出**，
   防止把 debug 包当正式版发出去。

本机发布走的是同一份 `signingConfigs`：优先环境变量 `QRSUITE_KEYSTORE` / `QRSUITE_STORE_PASSWORD` /
`QRSUITE_KEY_ALIAS` / `QRSUITE_KEY_PASSWORD`，否则找 `QRSUITE_SIGNING_PROPERTIES` 指向的
`signing.properties`，再退到 `android/signing.properties`；**都没有就静默回退 debug 签名**并打印警告
（详见 [android/README.md](../android/README.md)）。

**Windows** —— `.github/workflows/windows.yml` + `tools/build_windows.py`

```bash
python tools/build_windows.py                      # 只构建，产物 dist/QRSuite.exe
python tools/build_windows.py --sign               # 构建后用证书签名
python tools/build_windows.py --sign --no-build    # 只对已有 exe 签名（CI 就这么用）
```

签名用 Windows SDK 的 `signtool.exe`（不在 PATH 时用 `QRSUITE_SIGNTOOL` 指定全路径），凭据只从环境变量读：
`QRSUITE_SIGN_PFX` / `QRSUITE_SIGN_PFX_PASS`，或不给 .pfx 而用证书存储（`QRSUITE_SIGN_SHA1` 指定指纹，
不给则 `signtool /a` 自动挑选）。CI 侧对应两个**可选** Secrets：`WINDOWS_CERT_PFX_BASE64`、
`WINDOWS_CERT_PASSWORD`——不配置也能跑完，只是产物没有签名。

> 未签名的 exe 会触发 SmartScreen「已保护你的电脑」，用户得手动点「仍要运行」。
> OV 证书需累积声誉才逐步消除，EV 证书立即受信。证书自行向 CA 购买，本项目不附带。

---

## 10. 附录

### 10.1 命令速查

```bash
python -m qrsuite --serve                    # 网页版（推荐）
python -m qrsuite qr.png                     # 单张
python -m qrsuite ./pics --mode fast -v      # 目录 + 快速 + 明细
python -m qrsuite ./pics --json out.json     # 导出 JSON
python -m qrsuite qr.png --verify            # 交叉验证
python -m qrsuite --fetch-models             # 下载 WeChat 模型
python tests/smoke_test.py                   # 自检
python tests/bench.py ./cases old.py         # 基准对比
```

### 10.2 术语

| 术语 | 含义 |
|---|---|
| **阶段 / 变体** | 一种预处理后的图像（原图、二值化、放大 2×…）；阶段数=实际尝试了几个 |
| **早退** | 命中后立刻停止，不再跑剩余阶段 |
| **交叉验证** | 推迟「命中即停」，直到有 ≥2 个引擎给出同一内容（不硬性过滤单引擎结果） |
| **墙钟 / CPU 时间** | 真实耗时 / 实际占用的 CPU 时间 |
| **引擎** | 一个独立的解码器实现（zxing / cv2 / zbar / wechat / original / jsQR / ZXing-js） |

### 10.3 目录结构

见 [ARCHITECTURE.md](ARCHITECTURE.md) 第六节——目录树的唯一出处。要点只有一句：
散文文档一律在 `Documentation/`，`docs/` 只放 GitHub Pages 站点（含生成的 `manual.html`）。

### 10.4 性能参考

见 [BENCHMARK.md](BENCHMARK.md)——实测数字的唯一出处，本手册不再复制表格以免对不上。

---

*手册随代码一起维护：`Documentation/MANUAL.md` 是本文件，`docs/manual.html` 是同一内容的网页版，
由 `python tools/build_manual.py` 生成（需先 `pip install markdown`）。改了本文件务必重新生成，
否则网页版会滞后于本文。*
