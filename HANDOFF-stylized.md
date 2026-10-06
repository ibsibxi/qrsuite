# 交接：样式化私有码（太阳码/抖音码）识别能力 —— 给下一个会话

> 写于 2026-10-06。本文档的用途：**另一个会话/另一位同事可以据此自学本轮工作**，
> 不需要重新调研，也不需要我在场。

---

## 一、一分钟摘要

**做了什么**：往 QRSuite v2 里加了一个新模块 `qrsuite/stylized.py`。

**它解决什么**：微信小程序码（菊花码/太阳码）、微信赞赏码、抖音主页码这三类是**平台私有**的
放射/圆环状码，**解不出内容**（协议私有 + 无公开实现 + 官方明确只有自家 App 能解）。
新模块不尝试解码，只在**所有标准引擎失败之后**判定：

- 这是哪一家的码（抖音主页码 / 微信小程序码 / 微信赞赏码）
- 几何参数：定位点数、圆心、模块尺度、估计线数、角向主分度格数
- 给用户一句能用的提示：「这是抖音主页码，请打开抖音 App『扫一扫』识别」

**第二轮补强（2026-10-06，同一会话内完成）**：
- **误判清零**：原 6/16 误判 → 0；真抖音码/真赞赏码判定不变（0.88 / 1.00）。
  判别依据是「角向格律」（微信官方仅 36/54/72 线档），详见坑清单第 8 条。
- **性能提升 ~3×**：`_bullseye_verify` 加保守预筛（真牛眼中心必为黑，8 点采样）。
  16 张总耗时 2089ms → 658ms；抖音码 436→152ms、赞赏码 286→91ms。
- **一个失败的反向优化（教训）**：曾试"连通域已找到 ≥4 个高分牛眼就跳过稠密搜索"，
  实测**会把抖音码误判成微信族**——即使稠密搜索不增加最终候选数量，它产生的重复候选
  会参与排序与去重，从而改变 `_pick_four` 实际看到的集合。已回退并在代码里注明不可跳过。

**关键前提（先读这条，否则会走弯路）**：这类码**值得做的只有"识别"**，不值得做"解码"。
理由（本轮实测得到，不是推断）：

1. payload 就是一条**明文深链**：抖音侧实测解出 `snssdk1128://user/profile`
   → 即「打开某用户主页」，**不含路径/参数/票据**。所以"解出来能多拿什么"的答案是：**什么都多拿不到**。
2. 抓包路线原理性不通：抖音走自研 TTNet/Cronet 在 native 层直连，实测日志里 `is_proxy=0`，
   绕过系统代理与 VPN。
3. 4 引擎 × 18 预处理对这类码 **0 命中**（连"检测到码"都做不到），记录在
   `tools/NOTES-stylized-codes.md`。
4. 自行实现私有协议解码器涉及 ToS 与法律风险（赞赏码还涉及支付）——**不要做**。

---

## 二、项目地址

```
E:\学习\qcode\01-qrsuite-v2        ← 主项目（本次改动都在这里）
E:\学习\qcode\07-太阳码调研         ← 本轮调研的原始材料与工具（证据链）
E:\学习\qcode\02-测试用例\real      ← 测试样本（真实抖音码 / 微信赞赏码 / 普通码照片）
```

**状态更新（v2.1.1，后续升至 2.1.2）**：这些改动**已 commit 并合入上游**（含 Android 侧移植），工作区已干净，不再是待提交状态。

---

## 三、本次改动清单

| 文件 | 性质 | 说明 |
|---|---|---|
| `qrsuite/stylized.py` | **新增** | 结构判定与几何测量（核心交付物） |
| `tests/test_stylized.py` | **新增** | 回归测试（18 项断言：2 正例判定 + 几何精度 + <0.6s 性能预算 + 12 张反例误判清零） |
| `qrsuite/core.py` | 改 | `Result` 加 `stylized`/`stylized_elapsed`；`decode_*` 加 `stylized=True`；**仅未命中时**运行判定 |
| `qrsuite/cli.py` | 改 | `--stylized/--no-stylized`（默认开）；输出「ⓘ 结构判定」；JSON 带 `stylized` |
| `qrsuite/__init__.py` | 改 | 版本 → `2.1.1`，导出 `StylizedInfo` / `classify_stylized` |
| `docs/app.js` | 改 | 未解码时渲染判定块 |
| `docs/i18n.js` | 改 | 补中英文案 4 键（`stylized.*`） |
| `docs/style.css` | 改 | `.dim` / `.res.stylized` 样式 |
| `docs/sw.js` | 改 | 缓存版本 `2.0.7` → `2.1.1`（本仓库约定：改 docs 必升版本） |
| `README.md` / `CHANGELOG.md` / `tools/NOTES-stylized-codes.md` | 改 | 文档：新增「解不出来的那类码」章节、2.1.1 变更、本轮实测证据 |

---

## 四、怎么跑（三条命令）

```powershell
cd E:\学习\qcode\01-qrsuite-v2

# 1) 回归测试（必须先全过）
python tests\smoke_test.py          # 期望 ALL PASSED
python tests\test_stylized.py       # 期望 18 通过 / 0 失败

# 2) 端到端看效果
python -m qrsuite ..\02-测试用例\real\real_douyin.jpg ..\02-测试用例\real\real_wechat_reward.jpg
# 期望：两张都「✗ 未解码」+「ⓘ 结构判定」+ 提示文案

# 3) 确认默认路径没变慢
python tests\bench.py ..\02-测试用例\cases
# 期望 balanced ≈0.5s / 12-13 命中（与改动前一致）
```

编程接口：

```python
from qrsuite import Decoder
r = Decoder().decode_path(r"..\02-测试用例\real\real_douyin.jpg")
print(r.hits)        # []  —— 解不出
print(r.stylized)    # {'kind': 'douyin_profile', 'label': '抖音主页码', 'confidence': 0.88,
                     #  'geometry': {...}, 'hint': '这是抖音主页码…', 'notes': [...]}

# 单独做判定（不经解码器）
from qrsuite.stylized import classify
import numpy as np; from PIL import Image
info = classify(np.array(Image.open(path).convert("RGB")))
```

---

## 五、模块内部结构（自学要点）

`qrsuite/stylized.py` 只有两条**已验证**的检测管线，**没有第三种启发式**：

### 路线 A —— 抖音式 4 定位点
```
_lab_dark_white(rgb)      # HSV 分色：低饱和+高明度=白盘；高饱和偏暗=码点
_find_disc(white)         # 最大白连通域 = 码盘
_find_bullseyes(dark,disc)# 连通域牛眼 + 稠密环带搜索（关键，见"坑"）
_pick_four(eyes,disc)     # 同一环带 + 半径接近 + 4 点正方形 + 质心≈盘心
门槛：square_err ≤ 0.02 且 质心/盘心偏差 ≤ 0.08×盘半径
```

### 路线 B —— 微信式 3+1 牛眼
```
_find_eyes_in_center(gray)  # 中心区域找同心环（环跳变数排序）
_fit_tri_center(pts)        # 3 牛眼 = 矩形三角 → 圆心 = 另两角中点
门槛：等腰直角误差 ≤ 0.10，圆心须落在图像中部
细分：码区彩色占比 > 0.10 → 赞赏码，否则 → 小程序码
```

### 实测指标（写测试时用的权威值）
| 样本 | 判定 | 关键指标 |
|---|---|---|
| `real_douyin.jpg` | douyin_profile | 正方形误差 0.0051、置信度 0.88 |
| `real_wechat_reward.jpg` | wechat_reward | 圆心 (575.8, 419.8)、等腰直角误差 0.0003、角向主分度 36.0 格/圈、置信度 1.00 |

---

## 六、坑（血泪清单，务必读）

1. **必须在原分辨率上检测**。缩略到 1000px 会把牛眼的细环打碎 → 定位点漏检。
   我为此连续失败了三版。
2. **不要用"连通域当牛眼"**。牛眼的环常被白圈切成多个连通域，成分质心**不落在环心上**
   （实测真眼位置最近的连通域得分只有 0.12）。
3. **不要用网格扫描打分挑眼**。小半径上环评分会虚高（R=9.4 得 1.757），把真眼挤出 NMS。
   稠密搜索只应该作为**补充**，且必须配"中心黑 + 环外白"的硬验证。
4. **不要照"思路"重写已验证的检测器**，要**逐字移植**。我三次重写三次退化，
   最后把 `analyze_douyin.py` 的实现原样搬过来才一次通过。
5. **PowerShell 写中文文件会乱码**（UTF-8 无 BOM vs GBK）。改 `.py`/`.md`/`.css`
   一律用 Python 的 `open(..., encoding='utf-8', newline='\n')` 写，不要用 `Set-Content`/`Add-Content`。
6. **`.gitattributes` 要求 `*.py text eol=lf`**。新写的 Python 文件用 LF。
7. **改 `docs/` 之后必须升 `docs/sw.js` 的 `CACHE` 版本**，否则浏览器一直用旧缓存（本仓库老坑）。
8. **误判问题已解决（2026-10-06 第二轮）**：普通二维码的三个定位符本来就构成等腰直角三角形，
   纯几何无法与微信牛眼区分 —— 上一轮有 **6/16 张普通二维码被误判成微信族**（f_qr、h_blur、
   h_lowcontrast、h_noise、h_rot15、h_tiny），甚至整幅充电桩照片 `real_charger_lcd.jpg` 也被误判。
   环宽比（QR 1:1:3:1:1 vs 微信 0.8:1.2:1:1.2:0.8）**实测失败**（见 `07-太阳码调研/exp_ring_ratio.py`）。
   **最终有效的判据是「角向格律」**（`_angular_div` 的输出），因为微信小程序码官方规格只有
   36/54/72 线三档、数据区是规则极坐标格：

   | 样本 | div（格/圈） | peak（周期强度） |
   |---|---|---|
   | **真微信赞赏码** | **36.0**（4 种半径带下完全稳定） | **0.71~0.74** |
   | 普通二维码（打印） | 27~28.2 | 0.21~0.44 |
   | 充电桩 LCD 照片 | **None**（整幅照片无极坐标格律） | — |

   现为硬门槛：`div` 必须落在 **30~80 格/圈且 peak ≥ 0.60**，否则直接返回 `unknown`。
   关键点：**"测不出 div"也要判否**——放过它会让整幅照片蒙混过关。
   回归测试已把这 12 个反例固化成断言（`tests/test_stylized.py` 现 18 项）。

---

## 七、调研侧材料（`E:\学习\qcode\07-太阳码调研\`）

| 文件 | 用途 |
|---|---|
| `REPORT.md` | **主报告**（10 节：协议事实、GitHub 零实现证据、几何反演、抓包实测、扫码闭环、环境事实） |
| `analyze_douyin.py` / `analyze_reward.py` | 两条检测管线的**原始出处**（`stylized.py` 的内核从这里移植） |
| `measure_eyes.py` | 牛眼几何测量（含 3+1 等腰直角校验） |
| `exp_sunshape.py` | 自造太阳码结构样本 + 4 引擎对照实验 |
| `exp_ring_ratio.py` | **失败的**判别实验（环宽比），留档避免重复踩 |
| `ghhttp.py` / `ghdl.py` | GitHub 直连（绕本机 DNS 污染）+ Release 资产下载 |
| `mcp_client.py` | MCP over SSE 直连 ProxyPin MCP Server 的独立客户端 |
| `check_sim.py` / `diag_carrier.py` | SIM/运营商诊断（顺带做的，与主课题无关） |
| `samples/` | 合成结构样本、几何拟合标注图、极坐标展开图 |
| `apk/` | 抖音官方原包留档（25.7.0 / 40.0.0，md5 与签名已核验） |

**环境事实（省时间用）**：
- GitHub 系域名在本机被 **DNS 污染**（解析到 127.0.0.1，hosts 里没有）。用 `ghhttp.py`（DoH + 直连 + 磁盘缓存）。
- PowerShell 抓 https 会失败，**必须用 Python 直连**。
- 本沙箱 **pip 装不上包**、**GUI 程序起不来**（`CreateProcessAsUserW failed`）。

---

## 八、如果继续做，建议的下一步

1. ~~**Android 侧接入**（未做）~~ **已于 2026-10-06 完成**：
   - `android/app/src/main/java/com/qrsuite/scanner/StylizedDetector.java`（621 行）——
     从本模块**逐字移植**，零 Android 依赖（只用 `java.*`），因此可在桌面 JVM 上离线回归。
   - 移植验证：`tools/android-parity/StylizedParityTest.java` 与 Python 参考逐张比对，
     **桌面 JVM 16/16 一致**（判定/置信度/定位点数/圆心，圆心容差 0.05px）。
   - 真机验证：`android/app/src/androidTest/.../StylizedDeviceTest.java` 在 Pixel 5a 上跑，
     **2 个测试全过**（一致性 + 耗时预算）。
   - 接入点：`MainActivity.detectStylizedThenHint(uri)` —— 仅在 ML Kit 未命中时于后台线程跑，
     按结果提示"请用抖音/微信扫一扫"。未识别出已知厂商时退回原来的通用措辞。
   - R8：`proguard-rules.pro` 显式 keep `StylizedDetector`（正确性依赖与 Python 一致的浮点顺序，
     已确认发布包中类名与 angularDiv/bullseyeVerify 等方法名完整保留）。
   - **移植坑（务必知道）**：
     a. `javax.imageio` / `java.awt` 在 Android **不存在** —— 桌面验证台不能放进 `src/main`，
        否则 App 编不过（我是被这个坑了一次才挪到 `tools/android-parity/`）。
     b. Android `Bitmap` **没有** `getRGB(0,0,w,h,...)` 批量接口（那是桌面 BufferedImage 的），
        对应方法是 `getPixels(px, 0, w, 0, 0, w, h)`。
     c. `testInstrumentationRunner` 必须写在 `defaultConfig {}` **内部**，
        放在 `android {}` 下会报 "Could not find method testInstrumentationRunner()"。
     d. 真机上把长边缩到 1600 再判定（原图直接跑虽更准但更慢；1600 在实测样本上结果不变）。
2. **提升判定精度**：目前靠手调阈值。若要更稳，需要**更多标注样本**（每类 10–20 张，
   覆盖不同背景/角度/尺寸），然后用手工特征（环宽序列、定位点数量与半径分布、角向分度、
   盘心一致性）训一个轻量分类器，并给出混淆矩阵。
3. ~~**提交代码**~~ **已完成**：改动已 commit 并合入上游（v2.1.1）。
