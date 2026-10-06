# QRSuite v2 · 多引擎二维码 / 条码识别

图片进来，内容出去。同一个仓库里有三种用法：**命令行批量识别**、**纯前端网页（可直接部署 GitHub Pages）**、
**Android 原生 App**；再加一个可选的**本地 Python 高精度引擎**做兜底。三端各自实现，**不共享代码**。

本项目是 [ZapcoMan/QRCodeScanner](https://github.com/ZapcoMan/QRCodeScanner)（Rust 单文件 CLI）的
非官方重写版，由 [ZboY](https://github.com/ibsibxi) 维护。来龙去脉与「两个 v1」的区别见
[Documentation/LINEAGE.md](Documentation/LINEAGE.md)。

[![Pages](https://img.shields.io/badge/GitHub%20Pages-ready-success)](Documentation/MANUAL.md#9-部署与维护给维护者)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)]()
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Android](https://img.shields.io/badge/Android-arm64-brightgreen)](android/)

**🟢 在线试用（无需安装）：<https://ibsibxi.github.io/qrsuite/>** —— 纯前端版，图片不出浏览器，
**界面支持中英切换**（右上角按钮，自动跟随浏览器语言）；也可把 `docs/` 部署到你自己的静态托管。

## ⬇️ 下载

装好即用的版本在 [Releases](https://github.com/ibsibxi/qrsuite/releases/latest)：

| 平台 | 文件 | 说明 |
|---|---|---|
| **Android** | [QRSuite-2.0.4-arm64.apk](https://github.com/ibsibxi/qrsuite/releases/download/v2.0.4/QRSuite-2.0.4-arm64.apk) | 7.59 MB，原生 CameraX + ML Kit，**仅 arm64**（现代手机），正式签名，无网络权限，中/英界面 |
| **Windows** | [QRSuite.exe](https://github.com/ibsibxi/qrsuite/releases/download/v2.0.4/QRSuite.exe) | 80 MB，单文件版，双击启动本地服务并自动开浏览器 |

> Android 装上后若曾装过 debug 签名版，需先卸载（签名不同无法覆盖安装）。
> Windows 目前**无数字签名**，SmartScreen 会提示"已保护你的电脑"，点"仍要运行"即可。
> 仓库**有意不提交** `.apk` / `.exe`（二进制会污染版本历史），一律走 Releases 分发，源码仍可自行构建。
>
> 签名与发布的完整流程（Android 打 tag 自动签名、Windows `signtool`、需要哪些 Secrets）见
> [MANUAL §9.5 发布与签名](Documentation/MANUAL.md#95-发布与签名android--windows)。

---

## 能做什么

- **一维码和二维码都能读**：QR / MicroQR / DataMatrix / Aztec / PDF417 / Code128·39·93 / EAN·UPC / ITF / Codabar。
  三端覆盖范围不同，逐格式对照见 [MANUAL 的码制表](Documentation/MANUAL.md#1-这是什么能识别什么)。
- **多引擎并联**：zxing-cpp · OpenCV QRCodeDetector · zbar · WeChatQRCode（可选）· 原作 exe（可选），
  结果按内容去重。
- **级联 + 早退**：16～18 个预处理变体按「命中率高 / 代价低」排序，命中即停，不跑满。
  为什么快见 [ARCHITECTURE](Documentation/ARCHITECTURE.md)，实测数字见 [BENCHMARK](Documentation/BENCHMARK.md)。
- **网页零依赖、可离线、中英双语**：jsQR + ZXing-js 全部本地化进仓库，不依赖 CDN；界面文案在
  `docs/i18n.js` 里中英对齐，右上角切换并自动跟随浏览器语言（Android 同步有英文资源）。
- **隐私优先**：网页与 App 都在本机/设备内解码，不上传、无埋点；App 连 `INTERNET` 权限都显式移除。
  唯一的网络请求是你主动把图片 URL 交给命令行时的那次下载。

---

## 快速开始

**网页版**（日常推荐，也是 Pages 上的那一版）

```bash
pip install -r requirements.txt
python -m qrsuite --serve           # 自动打开 http://127.0.0.1:8765，Windows 可双击 run.bat 选 1
```

**命令行**

```bash
python -m qrsuite qr.png                        # 单张
python -m qrsuite ./pics --mode fast            # 目录自动递归
python -m qrsuite "https://example.com/q.png"   # 图片 URL
python -m qrsuite ./pics --json out.json -v     # 导出 JSON + 每张的阶段/CPU 明细
```

**纯前端**（不装 Python）：直接双击 `docs/index.html`，拖拽或 `Ctrl+V` 粘贴即可。

**Android**：`android/` 是 Gradle 子项目，构建与真机调试见 [android/README.md](android/README.md)。

**Windows 单文件版**：`python tools/build_windows.py`（加 `--sign` 走 `signtool` 签名，需自备证书）。

---

## 文档地图

| 想知道 | 去看 |
|---|---|
| 每个参数、每种打开方式、识别不出来怎么办 | [Documentation/MANUAL.md](Documentation/MANUAL.md)（[网页版](docs/manual.html)） |
| 级联/早退/引擎取舍、三端各自怎么实现 | [Documentation/ARCHITECTURE.md](Documentation/ARCHITECTURE.md) |
| 基准数字、怎么复现、哪些数字不能互相比较 | [Documentation/BENCHMARK.md](Documentation/BENCHMARK.md) |
| 与 Rust 原作 / Python 原型的关系 | [Documentation/LINEAGE.md](Documentation/LINEAGE.md) |
| 接下来做什么 | [Documentation/ROADMAP.md](Documentation/ROADMAP.md) |
| 版本变更 | [Documentation/CHANGELOG.md](Documentation/CHANGELOG.md) |
| 第三方组件许可、原作二进制归属 | [Documentation/THIRD_PARTY_NOTICES.md](Documentation/THIRD_PARTY_NOTICES.md) |
| 私有样式化码（抖音/赞赏码）为什么解不了 | [Documentation/NOTES-stylized-codes.md](Documentation/NOTES-stylized-codes.md) |

## 仓库结构

```
README.md · LICENSE
Documentation/     所有说明文档（MANUAL 是源头，docs/manual.html 由它生成）
qrsuite/           Python 包：core 引擎与级联 / cli 入口 / web 本地服务 / models 模型下载
docs/              GitHub Pages 站点根目录（index.html + app.js + i18n.js + decode.js + vendor + sw.js）
android/           原生 App（CameraX + ML Kit，中/英界面）
tests/ tools/      基准与冒烟测试、构建脚本（build_manual / build_windows）与实验脚本
.github/workflows/ Android CI + Release 自动签名 + Windows 构建
```

`docs/` 是 Pages 根目录，所以站点文件和散文文档分开放：散文一律在 `Documentation/`。

## License

本项目（v2 代码）MIT，见 [LICENSE](LICENSE)；第三方组件与原作二进制归属见
[Documentation/THIRD_PARTY_NOTICES.md](Documentation/THIRD_PARTY_NOTICES.md)。
