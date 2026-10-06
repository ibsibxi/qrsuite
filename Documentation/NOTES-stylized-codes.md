# -*- coding: utf-8 -*-
"""对"圆形/样式化私有码"第三方方案的评估结论（2026-10-06 调研）。

结论：**清单里的项目没有一个能解决"解析出内容"这个目标**，原因如下表。
本文件保留为决策记录，避免以后重复调研。

| 方案 | 实际是什么 | 能否解决 | 依据 |
|---|---|---|---|
| QRacer (ChengYan-3721) | 柔印**印前矢量化**工具：把码图转成 SVG，`sample.rs` 的径向采样是**渲染**用 | ❌ 方向相反（是生成不是解码） | 公开介绍："将二维码、各类条码的截图、拍照图转换为 SVG 矢量文件，还原时优先保证码点位置与原图 1:1 几何一致" |
| qr-decode-wechat (Curtion) | OpenCV wechat_qrcode **编译成 WASM** | ❌ 同一底层，已实测 0 命中 | 本项目 PC 版已集成 cv2.wechat_qrcode |
| weapp-vite scripts/scan-wechat-qrcode.py | 几行 **cv2.wechat_qrcode** 调用 | ❌ 同上 | 同上 |
| qrdecoder (Tianxiaomo) | wechat_qrcode 的 **C++ 上游** | ❌ 同上 | 同上 |
| OpenCV wechat_qrcode | 我们**已经在用**的引擎 | ❌ 已实测 0 命中 | 见本目录 exp_real_codes*.py 的实验输出 |

## 实测证据（本仓库可复现）

对 `02-测试用例/real/` 下两张真实样例（微信赞赏码、抖音主页码）：

- 4 个解码器（zxing-cpp / OpenCV QRCodeDetector / cv2.wechat_qrcode / zbar）
- × 18 种预处理（Otsu、自适应阈值及反色、膨胀/闭运算、缩放 400~900px、
  居中裁剪 50~80%、放大 1.5/2×、微信 scaleFactor 0.5~3.0、三种二值化器、限定 QR 格式）
- **全部 0 命中**；`QRCodeDetector.detect = False`（连"检测到码"都做不到）、
  zxing 候选数 0（结构上就没匹配上）

复现脚本：`tools/exp_real_codes.py`、`exp_real_codes2.py`、`exp_real_codes3.py`、`exp_real_structure.py`。

## 为什么结构上匹配不上

这两类码的**模块被渲染成圆点、定位符是圆环**，而标准 QR 解码依赖：
1. 定位符 1:1:3:1:1 的**直线扫描**判定；
2. **方块**模块的采样网格。
圆点/圆环把这两条同时打断。

**微信赞赏码/小程序码**更特殊：它是**同心圆环结构**（外观像"太阳/靶心"），
数据按环排布，且解码需要**微信服务端的业务密钥**才能还原链接或 scene 参数。
抖音码同理，是平台私有方案。

## 因此

- 不做集成：上面没有任何一项能带来增益，引入 WASM/OpenCV 反而会把网页版从
  约 600KB 膨胀到数 MB，并失去纯离线静态站的优势。
- 不自行实现私有协议解码器：那是针对微信/抖音私有格式的逆向，涉及 ToS 与法律风险，
  且赞赏码属支付相关，自行实现可能被用于欺诈。
- 产品化处理：解码失败时给出**准确提示**（见 Android `stylized_code_hint` 文案），
  引导用户使用对应 App 的"扫一扫"。
"""
