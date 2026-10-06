# QRSuite 移动端（Android）构建指南

原生 CameraX + ML Kit 条码扫描壳工程，产物 `QRSuite.exe` 的移动端对应物。
**全程离线**：APK 不申请 `INTERNET` / `ACCESS_NETWORK_STATE`（已在 Manifest 用 `tools:node="remove"` 显式移除依赖库合并进来的网络权限）。

---

## 一、产物

| 项 | 值 |
|---|---|
| 包名 | `com.qrsuite.scanner` |
| 版本 | versionName 2.0.4 / versionCode 2 |
| minSdk / targetSdk | 26 / 35（Android 8.0 及以上） |
| ABI | 仅 `arm64-v8a` |
| 体积 | 约 7.9 MB |
| 界面语言 | 中 / 英（`res/values` + `res/values-en`，跟随系统） |
| 签名 | 有正式证书时用正式证书，**两者都缺失时静默回退 debug 签名**（见 `app/build.gradle` 的 `signingConfigs`）；产物均带 APK Signature Scheme v2 |
| 权限 | CAMERA、VIBRATE、READ_MEDIA_IMAGES（≤32 为 READ_EXTERNAL_STORAGE） |

正式发布给别人用时应换成自己的 keystore（见 `app/build.gradle` 的 `signingConfigs`）。

---

## 二、工具链位置（本机）

工作区内自包含，**不依赖 C 盘**（沙箱对 C 盘写入受限）：

| 组件 | 路径 |
|---|---|
| Android SDK | `E:\学习\Android\sdk` |
| cmdline-tools | `E:\学习\Android\sdk\cmdline-tools\latest` |
| platform-tools(adb) | `E:\学习\Android\sdk\platform-tools\adb.exe` |
| Gradle 8.11.1 | `E:\学习\Android\gradle\gradle-8.11.1` |
| Gradle 缓存 | `E:\学习\Android\.gradle` |
| Android 用户目录 | `E:\学习\Android\.android` |
| JDK | `E:\Program Files\Java\jdk-21.0.11` |

---

## 三、构建

```powershell
cd E:\学习\qcode\01-qrsuite-v2\android
.\build-apk.bat                    # 默认 :app:assembleRelease
.\build-apk.bat :app:assembleDebug # 也可传别的 task
```

脚本已封装必需的环境变量（JAVA_HOME / GRADLE_USER_HOME / ANDROID_USER_HOME / ANDROID_HOME）。

产物：`android\app\build\outputs\apk\release\app-release.apk`

> CI 侧分工：`.github/workflows/android.yml` 只跑 `:app:assembleDebug`（验证源码可构建、上传 debug APK）；
> 正式签名由打 `v*` tag 触发的 `.github/workflows/release.yml` 完成——keystore 与口令来自仓库 Secrets
> （`SIGNING_KEYSTORE_BASE64` / `SIGNING_STORE_PASSWORD` / `SIGNING_KEY_ALIAS` / `SIGNING_KEY_PASSWORD`），
> 产物自动挂到对应 Release，并用 `apksigner verify --print-certs` 校验证书不是 debug。
> 本机签名走同一份 `signingConfigs`：优先环境变量 `QRSUITE_KEYSTORE` 等，否则读仓库外的
> `signing.properties`；缺这些材料时 `assembleRelease` 会**静默回退 debug 签名**，
> 上传前务必核对 `apksigner verify --print-certs` 输出的 `CN=QRSuite`。

手动等价命令：

```powershell
$env:JAVA_HOME='E:\Program Files\Java\jdk-21.0.11'
$env:GRADLE_USER_HOME='E:\学习\Android\.gradle'
$env:ANDROID_USER_HOME='E:\学习\Android\.android'
$env:ANDROID_HOME='E:\学习\Android\sdk'
$env:ANDROID_SDK_ROOT='E:\学习\Android\sdk'
cd E:\学习\qcode\01-qrsuite-v2\android
& 'E:\学习\Android\gradle\gradle-8.11.1\bin\gradle.bat' --no-daemon --console=plain :app:assembleRelease
```

## 四、安装与真机调试

```powershell
$adb='E:\学习\Android\sdk\platform-tools\adb.exe'
& $adb devices -l                                    # 确认设备状态为 device（不是 offline）
& $adb install -r 'E:\学习\qcode\06-构建产物\android\QRSuite-2.0.2-arm64.apk'
& $adb shell am start -n com.qrsuite.scanner/.MainActivity
& $adb shell pidof com.qrsuite.scanner               # 有输出=进程存活
& $adb logcat -d | Select-String 'FATAL|ClassCast'   # 崩溃排查
```

取截图（**必须在手机侧截图再 pull**，PowerShell 的 `>` 重定向会把二进制流写坏）：

```powershell
& $adb shell screencap -p /sdcard/s.png
& $adb pull /sdcard/s.png .\s.png
& $adb shell rm /sdcard/s.png
```

用 UI 树定位控件坐标（比肉眼估坐标可靠）：

```powershell
& $adb shell uiautomator dump /sdcard/ui.xml
& $adb shell cat /sdcard/ui.xml > ui.xml   # 再搜 clickable="true" 的 bounds
```

---

## 五、性能取舍（对应"快 + 省 CPU"）

1. **中央裁切识别**：`MainActivity.buildCenterCrop()` 只把与取景框对应的中央区域
   （屏幕方向下宽 80%、高 52%）重排成 NV21 交给 ML Kit，像素量约为全帧 40%，
   识别更快、CPU 更低。注意 ML Kit 会按 `rotationDegrees` 旋转，所以裁切要在
   屏幕方向算好再映射回缓冲区。
2. **背压 KEEP_ONLY_LATEST**：识别跟不上时直接丢帧，不排队累积。
3. **720p 分析分辨率**：`setTargetResolution(1280,720)` 足够识别二维码，比 1080p 少约 55% 像素。
4. **格式收敛**：`BarcodeScannerOptions` 只注册 QR/DataMatrix/Aztec/PDF417/常用一维码。
5. **仅 arm64**：`.so` 只打 `arm64-v8a`，体积从 23.4 MB 降到 7.9 MB。

---

## 六、踩过的坑（照着做可以省几小时）

| 坑 | 现象 | 处理 |
|---|---|---|
| 工程路径含中文 | AGP 直接拒绝：*project path contains non-ASCII characters* | `gradle.properties` 加 `android.overridePathCheck=true` |
| Gradle 文件监视 | `Couldn't open current thread, error = 5` | `gradle.properties` 加 `org.gradle.vfs.watch=false` |
| SDK/Gradle 写 C 盘被沙箱拒 | `C:\Users\...\.android\...` 拒绝访问、sdkmanager `NoSuchFileException` | 把 `ANDROID_USER_HOME`/`GRADLE_USER_HOME` 指到工作区 |
| `services.gradle.org` 下载 | 307 跳转到 **GitHub Releases**，而本机 GitHub DNS 被阻断 | 用镜像 `https://mirrors.cloud.tencent.com/gradle/gradle-8.11.1-bin.zip`（与官方同尺寸 136,920,070 字节） |
| PowerShell 破坏二进制 | `adb exec-out screencap > x.png` 得到坏图 | 先 `screencap` 到手机，再 `adb pull` |
| PowerShell 吃掉 `-D` 参数 | `Task '.gradle.vfs.watch=false' not found` | 参数写进 `gradle.properties`，别走命令行 |
| 依赖偷偷合并网络权限 | badging 出现 `INTERNET` | Manifest 里 `tools:node="remove"` 显式移除 |
| `Row findViewById` 类型不符 | `ClassCastException: MaterialButton cannot be cast to ImageView`（一点"历史"就崩） | 与布局控件类型保持一致（本项目已修） |
| Android 12 无 `READ_MEDIA_IMAGES` | `pm grant` 报 Unknown permission | 13+ 用 `PickVisualMedia`，12 及以下走 `ACTION_GET_CONTENT` 回退（已实现） |
| **.bat 里的中文路径** | cmd 报 `'droid' is not recognized as an internal command`、`'OME' is not recognized...`——**整行被按字节切开** | cmd.exe 按 OEM 代码页解析 .bat，而文件是 UTF-8。`build-apk.bat` 首行必须 `chcp 65001 >nul`（已修） |
| Gradle 读 .properties | keystore 路径变成 `E:\å­¦ä¹ ...` 找不到 | Java 按 ISO-8859-1 读 properties：中文路径要写 `\uXXXX` 转义，且**用正斜杠**（反斜杠会被 properties 反转义吃掉，`\q` 直接丢字符） |

---

## 七、验证状态与已知限制

**已验证（真机 Pixel 5a / Android 12）**
- ✅ 相机链路：CameraX `tryOpenCamera ... SUCCESS`，预览 + 分析两个 use case 均 ATTACHED
- ✅ 相机扫码：历史面板出现过 5 条真实扫码记录（企业微信/微信链接等），端到端可用
- ✅ 相册选图：解出 `QRSUITE-ANDROID-OK-2026`，结果面板正常弹出
- ✅ 历史面板：修复 `ClassCastException` 后正常渲染、可清空
- ✅ 正式签名：`CN=QRSuite`（不再是 debug 证书），v2 签名校验通过

**已知限制**
- ❌ **解不了样式化私有码**：抖音主页码、微信赞赏码的模块是**圆点/圆环**、定位符也是圆环，
  ML Kit 与所有通用解码器一样结构上匹配不上（详见 `../../02-测试用例/real/` 的两张真实样例，
  以及交接说明里的穷举实验记录）。失败时会提示用户改用对应 App 扫码。
- 圆度启发式自动判定"这是样式化码"**已评估但放弃**：真实私有码与模糊标准码的圆度分布重叠
  （标准码可达 0.80，抖音码只有 0.66），仅 2 个正样本不足以调参，误报会误导用户，故只用措辞提示。
- 版本号：只发 arm64；armeabi-v7a / x86 设备装不上。
- 本机 adb 在持续操作时会掉线（USB 供电/线材），需要重新插拔。
