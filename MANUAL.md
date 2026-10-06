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

QRSuite 把「解码引擎」和「输入方式」拆开组合：**同一套级联策略**，既能在 Python 里跑（高精度），也能在浏览器里跑（零安装）。

### 支持的码制

| 类别 | 格式 | 浏览器版 | Python 版 |
|---|---|---|---|
| 二维码 | QR Code、Micro QR | ✅ | ✅ |
| 二维码 | Data Matrix | ✅ | ✅ |
| 二维码 | Aztec | ✅ | ✅ |
| 二维码 | PDF417 | ✅ | ✅ |
| 一维码 | Code 128 / Code 39 / Code 93 | ✅ | ✅ |
| 一维码 | EAN-8/13、UPC-A/E | ✅ | ✅ |
| 一维码 | ITF、Codabar、DX Film Edge | ✅ | ✅ |

### 四个解码引擎（并联，结果去重）

| 引擎 | 运行位置 | 特点 |
|---|---|---|
| **zxing-cpp** | Python | 主力，码制最全、识别率最高 |
| **OpenCV QRCodeDetector** | Python | 抗噪、抗低质量，常与 zxing 互补 |
| **zbar (pyzbar)** | Python | 一维码稳健 |
| **bardecoder（v1 原程序）** | Python（可选） | 兼容你朋友那一版的多预处理链路 |
| **jsQR** | 浏览器 | 极快、体积小，专攻 QR |
| **ZXing-js** | 浏览器 | 浏览器侧的多码制选手 |

---

## 2. 安装与运行要求

### 2.1 只用网页版（推荐）

- **不需要安装任何东西**。双击 `docs/index.html` 即可（Chrome / Edge / Firefox / Safari 现代版本）。
- 想用「本机增强引擎」（OpenCV / zbar / bardecoder）才需要 Python。

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
| **均衡**（默认） | 前 7 个阶段 | ~80 ms/张 | 日常万能，命中即停 |
| **深度** | 全部 13+ 个变体 | 0.5~1.5 s/张 | 模糊、反色、倾斜、局部损坏的疑难图 |

页面上的「阶段」就是本次实际尝试的预处理变体数量——**数字越小说明越早命中**（页面上会标注「早退」）。

### 3.4 交叉验证

勾选 **交叉验证** 后，必须**两个引擎给出相同内容**才判定成功。
适合场景：内容要拿去做敏感操作（付款、登录），宁可失败也不接受误读。

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

# 交叉验证（需 ≥2 引擎一致）
python -m qrsuite qr.png --verify

# 只用一个引擎（排障用）
python -m qrsuite qr.png --engines zxing

# 交互式（不带参数时，回车后输入路径或 URL，多个用逗号分隔）
python -m qrsuite
```

### 4.3 全部参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `paths...` | 图片路径 / 目录 / 通配符 / 图片 URL，可多个 | 无（缺省转交互输入） |
| `--mode {fast,balanced,deep}` | 解码深度 | `balanced` |
| `--verify` | 交叉验证：需 ≥2 引擎一致才判定成功 | 关 |
| `--engines LIST` | 只启用指定引擎，逗号分隔：`zxing,cv2,zbar,wechat,original` | 全部可用引擎 |
| `--max-side N` | 大图先缩放到该边长（像素），降低 CPU | `1800` |
| `--dir` | 把参数当目录处理（`paths` 已是目录时也自动递归） | 关 |
| `--json FILE` | 结果写入 JSON | 无 |
| `-v, --verbose` | 打印每张的阶段数 / 引擎调用数 / CPU 时间 / 是否早退 | 关 |
| `--serve` | 启动本地网页服务 | — |
| `--port N` | 网页服务端口 | `8765` |
| `--no-browser` | 启动服务时不自动开浏览器 | 关 |
| `--fetch-models` | 下载 WeChatQRCode 模型（可选引擎） | — |
| `--original-exe PATH` | 挂载 v1 的 `QRCodeScanner.exe` 作为 `original` 引擎 | 读环境变量 `QRSUITE_ORIGINAL_EXE` |
| `--model-dir PATH` | WeChatQRCode 模型目录 | `qrsuite/wechat_models` |

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

它带超分模型，对「小而糊」的二维码效果明显。模型不随仓库分发，需要手动下载：

```bash
python -m qrsuite --fetch-models
```

脚本会依次尝试 jsdelivr / ghproxy / gitee / raw.githubusercontent 等多个镜像，成功后模型放在 `qrsuite/wechat_models/`：

```
qrsuite/wechat_models/
├─ detect.prototxt
├─ detect.caffemodel
├─ sr.prototxt
└─ sr.caffemodel
```

四个文件齐全时，引擎列表里会自动出现 `wechat`。**下载失败不影响其它引擎**。

> 若你的网络屏蔽 GitHub（DNS 被改 / 公司网络），`--fetch-models` 可能全部镜像失败。可以让能从外网下载的朋友把 4 个文件发你，直接放进上面的目录即可。

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
5. **勾选交叉验证**：如果解出来的内容像乱码或每次不一样，说明是**误读**，开启交叉验证可过滤。
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
A：仓库里只有源码，`.bat` 也只是调用 Python，不带任何可执行文件。Releases 里的 **Windows 单文件版
`QRSuite.exe` 是 PyInstaller 打的**，这类自解压包被杀软误报、被 SmartScreen 拦「已保护你的电脑」都很常见；
CI 未配置代码签名证书时它必然是未签名的（要自己签：`python tools/build_windows.py --sign`，凭据走
`QRSUITE_SIGN_PFX` / `QRSUITE_SIGN_PFX_PASS` 等环境变量）。若你保留了 v1 的 `QRCodeScanner.exe`，那是原作自己的
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

> 本仓库**没有** Pages 部署工作流，静态站只能走上面的 branch 直发。`.github/workflows/` 下的三个文件
> 都不涉及 Pages：`android.yml`（PR/push 跑 `:app:assembleDebug`，验证能编译并上传 debug APK）、
> `release.yml`（打 `v*` tag 时正式签名并挂到 Release）、`windows.yml`（同一 tag 构建/签名单文件 exe）。
> 想用 Actions 发布 Pages 需自建 `pages.yml`（`actions/upload-pages-artifact` 指定 `path: docs`
> + `actions/deploy-pages`），再把 Source 切成 `GitHub Actions`。

> `docs/` 已包含 `.nojekyll`，且所有前端资源本地化，无 CDN 依赖，离线也能用。

### 9.2 升级前端解码库

```bash
npm pack jsqr@latest               # 或用 npm registry 直接下载 tgz
npm pack @zxing/library@latest
# 解包后替换 docs/vendor/jsQR.js 与 docs/vendor/zxing.min.js
# 同时更新 docs/vendor/LICENSE.*.txt 与 THIRD_PARTY_NOTICES.md 中的版本号
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
- **三个版本号互不相干，别指望它们一致，也别拿其中一个去推另一个**（括号里是 2.0.4 时的真实值）：
  - `qrsuite/__init__.py` 的 `__version__`（2.0.3）——Python 版自己的版本；
  - `android/app/build.gradle` 的 `versionName` / `versionCode`（2.0.4 / 2）——Android 独立版本，
    `release.yml` 用 `versionName` 拼产物文件名 `QRSuite-<versionName>-arm64.apk`，`versionCode` 必须单调递增；
  - `docs/sw.js` 的 `CACHE`（`qrsuite-v2.0.7`）——**只是 PWA cache-buster，只增不减，不跟版本号绑定**，
    唯一作用是新资源上线时让旧缓存失效。把它「对齐」成当前版本会缓存不到东西，别改小它。
- 发版时还要在 `CHANGELOG.md` 新增一节，并在 README 顶部补变更摘要。

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
| **交叉验证** | 要求 ≥2 个引擎结果一致 |
| **墙钟 / CPU 时间** | 真实耗时 / 实际占用的 CPU 时间 |
| **引擎** | 一个独立的解码器实现（zxing / cv2 / zbar / wechat / original / jsQR / ZXing-js） |

### 10.3 目录结构

```
qrsuite-v2/
├─ qrsuite/             Python 包（core 引擎策略 / cli 入口 / web 服务 / models 模型）
├─ docs/                GitHub Pages 站点（index.html、app.js、decode.js、worker、vendor）
├─ tests/               smoke_test.py（自检）、bench.py（基准）
├─ run.bat              Windows 菜单式入口
├─ requirements.txt     依赖
└─ README.md · MANUAL.md · LICENSE · THIRD_PARTY_NOTICES.md
```

### 10.4 性能参考（13 张混合用例，同一台机器）

| 方案 | 墙钟 | CPU | 阶段总数 | 解出 |
|---|---:|---:|---:|---:|
| v1 旧流程（跑满 18 变体） | 3.40 s | 6.78 s | 234 | 12/13 |
| v2 快速 | 0.19 s | 0.19 s | 15 | 11/13 |
| v2 均衡（默认） | 0.32 s | 0.45 s | 21 | 12/13 |
| v2 深度（含 v1 子进程） | 8.69 s | 0.95 s | 30 | 12/13 |
| 浏览器版（jsQR+ZXing-js） | 平均 44 ms/张（快速） | — | 平均 1.2 | 12/13 |

---

*手册随代码一起维护：`MANUAL.md` 是本文件，`docs/manual.html` 是同一内容的网页版。*
