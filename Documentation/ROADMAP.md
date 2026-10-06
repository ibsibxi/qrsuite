# Roadmap

只做「想清楚要做、但还没做」的事；已评估又放弃的方向记在
[ARCHITECTURE.md](ARCHITECTURE.md) 与 [CHANGELOG.md](CHANGELOG.md) 里，不在这儿重复躺尸。

## 待办

- [ ] **网页端摄像头实时扫码**（`getUserMedia` + 逐帧解码）。目前实时取景只有 Android App 有。
- [ ] **WASM 引擎**（ZXing-C++ 的 WASM 构建）替换现在的 JS 版 `zxing.min.js`，
      顺带把上游标「待验证」的 Micro QR / DataBar 在浏览器侧坐实。
- [ ] **条形码类型过滤与置信度评分**：现在 `decode.js` 不设 `POSSIBLE_FORMATS`，等于所有读取器全试一遍；
      按用途收敛能更快，也能减少一维码的误读面。
- [ ] **让早退真正省下变体构造**：`decode_arrays()` 现在先 `list(build_stages(...))` 全量物化再截断，
      命中即停只省了引擎调用（见 ARCHITECTURE 2.2）。
- [ ] **Python 与前端两份级联清单的收敛**：两边已经分叉（JS 无 >1800px 降采样闸门，缺 CLAHE / 自适应阈值 /
      模糊+二值化，多了逐通道 R/G/B）。要么统一，要么就明确承认是两套并各自测准。

## 已完成（留个记录）

- [x] PWA 离线安装：`docs/manifest.webmanifest` + `docs/sw.js`（`sw.js` 的 `CACHE` 只是 cache-buster，
      只增不减、不跟版本号绑定，见 MANUAL 9.4）。
- [x] 批量导出 CSV / JSON（网页端「识别历史」区）。
- [x] 三端码制范围写清（含 Micro QR / DX Film Edge / Telepen 的差异），见 MANUAL 码制表。
- [x] 网页端中英双语、Android 发布与 Windows 单文件由 CI 自动签名（2.0.4），流程见 MANUAL 9.5。

## 不太可能做

- **抖音主页码 / 微信赞赏码 / 小程序码**：圆点圆环结构破坏了标准 QR 的两个前提，且赞赏码/小程序码的
  数据按同心环排布、还原 `scene` 需要平台服务端密钥。这是平台私有协议，不是解码器能力问题。
  评估记录见 [NOTES-stylized-codes.md](NOTES-stylized-codes.md)。
- **整行定位符丢失的严重残缺码**（如底部被裁 20%）：需要真正的几何重建，投入大、收益不确定，
  已实测放弃过两版启发式方案（见 CHANGELOG 2.0.3）。
