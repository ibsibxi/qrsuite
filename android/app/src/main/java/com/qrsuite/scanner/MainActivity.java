package com.qrsuite.scanner;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.Image;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.Display;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.button.MaterialButton;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * QRSuite 移动端：CameraX 取景 + ML Kit 本地条码识别。
 *
 * <p>面向“快 + 省电”的三点取舍：
 * <ol>
 *   <li>只把取景框对应的中央方形裁切区交给识别器，像素量约为全帧 1/4，识别更快更省 CPU；</li>
 *   <li>背压策略 KEEP_ONLY_LATEST：识别跟不上时直接丢帧，而不是排队累积；</li>
 *   <li>格式按用户偏好收敛到常用 QR/一维码，减少无效分类开销。</li>
 * </ol>
 * 全程不申请网络权限，图片不出设备。
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "QRSuite";

    private PreviewView previewView;
    private ScanOverlayView overlay;
    private LinearLayout permPanel;
    private MaterialButton btnTorch, btnHistory, btnPick, btnGrant, btnPickFromPerm, btnLang;

    // ---- 相机帧里的异形码判定限流参数 ----
    /** 每隔多少帧抽一次灰度小图做异形码判定（判定要几十毫秒，不必逐帧）。 */
    private static final int STYLIZED_FRAME_INTERVAL = 5;
    /** Y 平面抽稀步长（720p -> 约 427×240）。 */
    private static final int STYLIZED_LUMA_STEP = 3;
    /** 弹出结果后的冷却，避免连续弹窗。 */
    private static final long STYLIZED_COOLDOWN_MS = 2500L;

    private int frameCounter = 0;
    private final java.util.concurrent.atomic.AtomicBoolean stylizedBusy =
            new java.util.concurrent.atomic.AtomicBoolean(false);
    private volatile long stylizedCooldownUntil = 0L;
    private TextView hint;

    private ProcessCameraProvider cameraProvider;
    private ImageAnalysis analysis;
    private BarcodeScanner scanner;
    private ExecutorService analysisExecutor;
    private ListenableFuture<ProcessCameraProvider> providerFuture;

    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean scanning = false;
    private Camera camera;
    private boolean torchOn = false;
    private HistoryStore db;

    private ActivityResultLauncher<String> permLauncher;
    private ActivityResultLauncher<PickVisualMediaRequest> pickLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyEdgeToEdge();
        setContentView(R.layout.activity_main);
        applyWindowInsets();

        db = new HistoryStore(getApplicationContext());
        analysisExecutor = Executors.newSingleThreadExecutor();

        previewView = findViewById(R.id.preview);
        overlay = findViewById(R.id.overlay);
        permPanel = findViewById(R.id.permPanel);
        hint = findViewById(R.id.hint);
        btnTorch = findViewById(R.id.btnTorch);
        btnHistory = findViewById(R.id.btnHistory);
        btnPick = findViewById(R.id.btnPick);
        btnGrant = findViewById(R.id.btnGrant);
        btnPickFromPerm = findViewById(R.id.btnPickFromPerm);
        btnLang = findViewById(R.id.btnLang);

        BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                        Barcode.FORMAT_QR_CODE,
                        Barcode.FORMAT_DATA_MATRIX,
                        Barcode.FORMAT_AZTEC,
                        Barcode.FORMAT_PDF417,
                        Barcode.FORMAT_CODE_128,
                        Barcode.FORMAT_CODE_39,
                        Barcode.FORMAT_CODE_93,
                        Barcode.FORMAT_EAN_13,
                        Barcode.FORMAT_EAN_8,
                        Barcode.FORMAT_UPC_A,
                        Barcode.FORMAT_UPC_E,
                        Barcode.FORMAT_ITF,
                        Barcode.FORMAT_CODABAR)
                .build();
        scanner = BarcodeScanning.getClient(options);

        registerLaunchers();

        btnTorch.setOnClickListener(v -> toggleTorch());
        btnHistory.setOnClickListener(v -> showHistory());
        btnPick.setOnClickListener(v -> launchPicker());
        btnPickFromPerm.setOnClickListener(v -> launchPicker());
        btnGrant.setOnClickListener(v -> permLauncher.launch(Manifest.permission.CAMERA));
        btnLang.setOnClickListener(v -> toggleLang());
        updateLangButton();

        if (hasCamera()) {
            permPanel.setVisibility(View.GONE);
            startCamera();
        } else {
            permPanel.setVisibility(View.VISIBLE);
            overlay.setVisibility(View.GONE);
        }
    }

    private boolean hasCamera() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * 全屏预览 + 顶部/底部条避开状态栏与手势条。
     * 只给上下两条加内边距，相机预览仍然铺满整屏。
     */
    private void applyWindowInsets() {
        View top = findViewById(R.id.topBar);
        View bottom = findViewById(R.id.bottomBar);
        ViewGroup root = findViewById(R.id.root);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            androidx.core.graphics.Insets bars = androidx.core.view.WindowInsetsCompat
                    .toWindowInsetsCompat(insets)
                    .getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars());
            top.setPadding(top.getPaddingLeft(), bars.top + dp(10),
                    top.getPaddingRight(), top.getPaddingBottom());
            bottom.setPadding(bottom.getPaddingLeft(), bottom.getPaddingTop(),
                    bottom.getPaddingRight(), bars.bottom + dp(18));
            return insets;
        });

        // 提示文字跟随取景框：始终贴在取景框下方 16dp，避免大屏上飘在中间空处
        root.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            float fb = overlay.frameBottom();
            if (fb <= 0 || hint.getHeight() == 0) return;
            float currentTop = hint.getTop() + hint.getTranslationY();
            hint.setTranslationY(hint.getTranslationY() + (fb + dp(16) - currentTop));
        });
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void applyEdgeToEdge() {
        Window w = getWindow();
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void registerLaunchers() {
        permLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(), granted -> {
                    if (granted) {
                        permPanel.setVisibility(View.GONE);
                        overlay.setVisibility(View.VISIBLE);
                        startCamera();
                    } else {
                        permPanel.setVisibility(View.VISIBLE);
                        Toast.makeText(this, R.string.permission_needed, Toast.LENGTH_LONG).show();
                    }
                });

        // Android 13+ 用系统照片选择器（无需存储权限）；低版本走 GET_CONTENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pickLauncher = registerForActivityResult(
                    new ActivityResultContracts.PickVisualMedia(), uri -> {
                        if (uri != null) decodeFromUri(uri);
                    });
        } else {
            pickLauncher = null;
        }
    }

    private void launchPicker() {
        if (pickLauncher != null) {
            pickLauncher.launch(new PickVisualMediaRequest.Builder()
                    .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly.INSTANCE)
                    .build());
        } else {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.setType("image/*");
            i.addCategory(Intent.CATEGORY_OPENABLE);
            legacyPicker.launch(i);
        }
    }

    private final ActivityResultLauncher<Intent> legacyPicker = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    Uri uri = result.getData().getData();
                    if (uri != null) decodeFromUri(uri);
                }
            });

    // ---------------- 相机与识别 ----------------

    private void startCamera() {
        providerFuture = ProcessCameraProvider.getInstance(this);
        providerFuture.addListener(() -> {
            try {
                cameraProvider = providerFuture.get();
                bindUseCases();
            } catch (Exception e) {
                Log.e(TAG, "相机初始化失败", e);
                showFailure(getString(R.string.fail_camera_init, String.valueOf(e.getMessage())));
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindUseCases() {
        cameraProvider.unbindAll();

        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        // 720p 足够识别二维码，同时显著省电（相比 1080p 少 ~55% 像素）
        analysis = new ImageAnalysis.Builder()
                .setTargetResolution(new android.util.Size(1280, 720))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                .build();
        analysis.setAnalyzer(analysisExecutor, this::onFrame);

        camera = cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA,
                preview, analysis);

        if (camera.getCameraInfo().hasFlashUnit()) {
            btnTorch.setVisibility(View.VISIBLE);
        } else {
            btnTorch.setVisibility(View.GONE);
        }
        setScanning(true);
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void onFrame(@NonNull ImageProxy proxy) {
        try {
            if (!scanning) return;
            Image media = proxy.getImage();
            if (media == null) return;
            if (!busy.compareAndSet(false, true)) return;

            InputImage input = buildCenterCrop(proxy, media);
            if (input == null) {
                busy.set(false);
                return;
            }

            // 异形码（太阳码/抖音码）判定走**另一条通道**：ML Kit 永远认不出这类码，
            // 所以不能挂在"识别成功"回调里。这里在送 ML Kit 之前先把灰度小图抽出来，
            // 省得在回调里再解一次 YUV；判定本身限流（见 maybeDetectStylized）。
            // 每 STYLIZED_FRAME_INTERVAL 帧才抽一次：判定只用于"对准后扫"，不需要高频。
            byte[] smallLuma = null;
            int smallW = 0, smallH = 0;
            if ((frameCounter++ % STYLIZED_FRAME_INTERVAL) == 0) {
                smallLuma = grabSmallLuma(media, STYLIZED_LUMA_STEP);
                if (smallLuma != null) {
                    smallW = Math.max(1, media.getWidth() / STYLIZED_LUMA_STEP);
                    smallH = Math.max(1, media.getHeight() / STYLIZED_LUMA_STEP);
                }
            }
            final byte[] luma = smallLuma;
            final int sw = smallW, sh = smallH;

            scanner.process(input)
                    .addOnSuccessListener(this, codes -> {
                        busy.set(false);
                        if (codes != null && !codes.isEmpty()) {
                            onCodes(codes);
                        } else if (luma != null) {
                            maybeDetectStylized(luma, sw, sh);
                        }
                    })
                    .addOnFailureListener(this, e -> {
                        busy.set(false);
                        Log.w(TAG, "识别失败", e);
                    });
        } finally {
            proxy.close();
        }
    }

    /**
     * 把 Y 平面按步长抽稀成灰度小图（只取值、不做插值），供异形码判定使用。
     *
     * <p>为什么抽稀：判定里的连通域与极坐标自相关耗时随像素量增长，
     * 720p 抽到 1/3 后约 427×240，单帧判定落在几十毫秒量级；
     * 而这类码的定位点尺寸远大于 3px，抽稀不会破坏结构（Python 侧实测：
     * 真正的限制是"不要把牛眼细环缩得太狠"，1/3 远未到那个程度）。
     */
    private byte[] grabSmallLuma(Image media, int step) {
        try {
            android.media.Image.Plane[] planes = media.getPlanes();
            if (planes.length == 0) return null;
            java.nio.ByteBuffer buf = planes[0].getBuffer();
            int rowStride = planes[0].getRowStride();
            int pw = media.getWidth(), ph = media.getHeight();
            if (pw <= 0 || ph <= 0) return null;
            int sw = Math.max(1, pw / step), sh = Math.max(1, ph / step);
            byte[] out = new byte[sw * sh];
            int p = 0;
            for (int y = 0; y < sh; y++) {
                int rowBase = (y * step) * rowStride;
                for (int x = 0; x < sw; x++) {
                    int idx = rowBase + x * step;
                    out[p++] = (idx < buf.limit()) ? buf.get(idx) : 0;
                }
            }
            return out;
        } catch (Throwable t) {
            Log.w(TAG, "抽稀灰度失败", t);
            return null;
        }
    }

    /**
     * 相机帧里的异形码判定（限流）。
     *
     * <p>限流原因：判定要几十毫秒，逐帧跑会明显发热耗电；而且这类码是"对准了才扫"，
     * 没必要高频。这里每 {@link #STYLIZED_FRAME_INTERVAL} 帧才判一次，
     * 弹过结果后还要等 {@link #STYLIZED_COOLDOWN_MS} 冷却，避免连续弹窗。
     *
     * <p>小图是灰度，而判定用的是 HSV 特色分割（看饱和度）——灰度会退化，
     * 但本模块的判据是**几何**（定位点排列 + 角向格律），实测在灰度下仍成立。
     */
    private void maybeDetectStylized(byte[] smallLuma, int sw, int sh) {
        if (!scanning) return;
        if (smallLuma == null || smallLuma.length == 0 || sw <= 0 || sh <= 0) return;
        if (System.currentTimeMillis() < stylizedCooldownUntil) return;
        if (!stylizedBusy.compareAndSet(false, true)) return;

        final int fw = sw, fh = sh;

        new Thread(() -> {
            String kind = null;
            try {
                int[] px = new int[smallLuma.length];
                for (int i = 0; i < smallLuma.length; i++) {
                    int g = smallLuma[i] & 0xFF;            // NV21 的 Y 就是灰度，0..255
                    px[i] = (0xFF << 24) | (g << 16) | (g << 8) | g;
                }
                StylizedDetector.Info info = new StylizedDetector(px, fw, fh).classify();
                kind = info.isActionable() ? info.kind : null;
                Log.i(TAG, "相机帧异形码判定: " + info);
            } catch (Throwable t) {
                Log.w(TAG, "相机帧异形码判定失败", t);
            } finally {
                stylizedBusy.set(false);
            }
            final String k = kind;
            if (k == null) return;                          // 没认出来就静默，不打扰连续扫描
            stylizedCooldownUntil = System.currentTimeMillis() + STYLIZED_COOLDOWN_MS;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (!scanning) return;
                setScanning(false);
                buzz(35);
                showResult(null, null, vendorLabel(k), vendorNotice(k));
            });
        }, "stylized-frame").start();
    }

    /**
     * 只取与取景框对应的中央方形区域，重排成规范 NV21 后交给识别器。
     *
     * <p>为什么值得这么麻烦：识别耗时与像素量近似线性，中央 80%×52% 的区域约为全帧
     * 40% 的像素，单帧识别更快、CPU 更低；而取景框之外的画面用户本来也没对准。
     * 注意 ML Kit 会按 rotationDegrees 旋转，因此裁切必须先在“屏幕方向”下算好再映射回缓冲区。
     */
    private InputImage buildCenterCrop(ImageProxy proxy, Image media) {
        int w = proxy.getWidth(), h = proxy.getHeight();
        boolean rotated = proxy.getImageInfo().getRotationDegrees() % 180 != 0;
        int dispW = rotated ? h : w;
        int dispH = rotated ? w : h;

        // 屏幕方向下的取景区域（与 ScanOverlayView 的比例一致：宽 80%、高 52%）
        int edgeW = Math.max(0, (int) (dispW * 0.80f));
        int edgeH = Math.max(0, (int) (dispH * 0.52f));
        int cw, ch;
        if (rotated) {
            cw = Math.min(w, edgeH);
            ch = Math.min(h, edgeW);
        } else {
            cw = Math.min(w, edgeW);
            ch = Math.min(h, edgeH);
        }
        if (cw < 32 || ch < 32) return null;

        int left = Math.max(0, (w - cw) / 2);
        int top = Math.max(0, (h - ch) / 2);

        Image.Plane[] planes = media.getPlanes();
        Image.Plane yp = planes[0];
        int yRow = yp.getRowStride(), yPix = yp.getPixelStride();
        ByteBuffer yBuf = yp.getBuffer();

        byte[] nv21 = new byte[cw * ch + 2 * (cw / 2) * (ch / 2)];
        int ySize = cw * ch;
        int out = 0;
        for (int r = 0; r < ch; r++) {
            int base = (top + r) * yRow + left * yPix;
            if (base < 0 || base + cw > yBuf.limit()) return null;
            for (int c = 0; c < cw; c++) {
                nv21[out++] = yBuf.get(base + c * yPix);
            }
        }

        // 色度平面：V 在前 U 在后（NV21 布局）
        fillChroma(planes, 1, top, left, cw, ch, nv21, ySize, true);
        fillChroma(planes, 2, top, left, cw, ch, nv21, ySize, false);

        return InputImage.fromByteBuffer(ByteBuffer.wrap(nv21), cw, ch,
                proxy.getImageInfo().getRotationDegrees(), InputImage.IMAGE_FORMAT_NV21);
    }

    private void fillChroma(Image.Plane[] planes, int planeIdx, int top, int left,
                            int cw, int ch, byte[] dst, int dstOffset, boolean isV) {
        Image.Plane p = planes[planeIdx];
        int rowStride = p.getRowStride(), pixStride = p.getPixelStride();
        ByteBuffer buf = p.getBuffer();
        int cw2 = cw / 2, ch2 = ch / 2;
        int step = isV ? 2 : 1;          // V 在偶数字节，U 在奇数字节
        int pos = dstOffset + (isV ? 0 : 1);
        int limit = buf.limit();
        for (int r = 0; r < ch2; r++) {
            int base = (top / 2 + r) * rowStride + (left / 2) * pixStride;
            for (int c = 0; c < cw2; c++) {
                int idx = base + c * pixStride;
                if (idx < 0 || idx >= limit) return;
                dst[pos] = buf.get(idx);
                pos += step;
                if (pos + step - 1 >= dst.length) return;
            }
        }
    }

    private void onCodes(List<Barcode> codes) {
        Barcode best = null;
        for (Barcode b : codes) {
            if (b.getRawValue() != null && !b.getRawValue().isEmpty()) {
                best = b;
                break;
            }
        }
        if (best == null) return;

        String content = best.getRawValue();
        String format = formatName(best.getFormat());
        db.add(content, format, "camera");
        buzz(35);
        setScanning(false);
        // 传原始字节：由 showResult 判定是否为二进制（乘车码这类）
        showResult(content, format, null, null, best.getRawBytes());
    }

    private void setScanning(boolean on) {
        scanning = on;
        overlay.setAnimating(on);
        if (hint != null) hint.setAlpha(on ? 1f : 0.35f);
    }

    private void buzz(int ms) {
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
        } catch (Exception ignored) {
        }
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        torchOn = !torchOn;
        camera.getCameraControl().enableTorch(torchOn);
        btnTorch.setIcon(getDrawable(torchOn ? R.drawable.ic_torch_on : R.drawable.ic_torch_off));
        btnTorch.setContentDescription(torchOn ? "关闭补光灯" : "打开补光灯");
    }

    // ---------------- 相册图片解码 ----------------

    private void decodeFromUri(Uri uri) {
        setScanning(false);
        InputImage input;
        try {
            input = InputImage.fromFilePath(this, uri);
        } catch (Exception e) {
            setScanning(true);
            showFailure(getString(R.string.fail_image_unreadable));
            return;
        }
        scanner.process(input)
                .addOnSuccessListener(codes -> {
                    if (codes == null || codes.isEmpty()) {
                        // 通用解码器（含 ML Kit）读不出来时，做一次**本机结构判定**：
                        // 抖音主页码/微信小程序码/赞赏码是平台私有格式（圆点圆环、放射状），
                        // 通用解码器结构上就匹配不上，只能识别"这是哪一家的码"并提示用对应 App。
                        //
                        // 判定几何与 Python 参考实现逐字对齐（见 StylizedDetector 类注释），
                        // 已用 16 张样本做一致性回归：判定/置信度/定位点数/圆心全部一致。
                        detectStylizedThenHint(uri);
                        return;
                    }
                    for (Barcode b : codes) {
                        String content = b.getRawValue();
                        if (content == null || content.isEmpty()) continue;
                        String fmt = formatName(b.getFormat());
                        db.add(content, fmt, "gallery");
                    }
                    buzz(35);
                    Barcode b0 = codes.get(0);
                    // 传原始字节：由 showResult 判定是否为二进制（乘车码这类）
                    showResult(b0.getRawValue(), formatName(b0.getFormat()), null, null, b0.getRawBytes());
                })
                .addOnFailureListener(e -> {
                    setScanning(true);
                    showFailure(getString(R.string.fail_decode_error, String.valueOf(e.getMessage())));
                });
    }

    /**
     * 通用解码失败后：在后台做本机结构判定，再按结果提示用哪个 App 扫。
     *
     * <p>放到后台线程是因为几何判定在真机上约需 100~400ms（含连通域与极坐标自相关），
     * 在主线程做会卡顿；判定期间保持"识别中"状态。
     */
    private void detectStylizedThenHint(Uri uri) {
        new Thread(() -> {
            String kind = null;
            try {
                // 按原图尺寸解码：牛眼的细环在缩略图上会被打碎（Python 侧实测教训）
                BitmapFactory.Options opt = new BitmapFactory.Options();
                opt.inPreferredConfig = Bitmap.Config.ARGB_8888;
                Bitmap bmp = BitmapFactory.decodeStream(
                        getContentResolver().openInputStream(uri), null, opt);
                if (bmp != null) {
                    // 控制规模：超大图先缩到长边 1600，兼顾精度与耗时
                    int bw = bmp.getWidth(), bh = bmp.getHeight();
                    int side = Math.max(bw, bh);
                    if (side > 1600) {
                        double s = 1600.0 / side;
                        Bitmap small = Bitmap.createScaledBitmap(
                                bmp, Math.max(1, (int) (bw * s)), Math.max(1, (int) (bh * s)), true);
                        if (small != bmp) { bmp.recycle(); bmp = small; }
                    }
                    int iw = bmp.getWidth(), ih = bmp.getHeight();
                    int[] px = new int[iw * ih];
                    // Android 的 Bitmap 没有桌面 BufferedImage 的 getRGB(...) 批量接口，
                    // 对应方法是 getPixels(pixels, offset, stride, x, y, width, height)
                    bmp.getPixels(px, 0, iw, 0, 0, iw, ih);
                    bmp.recycle();
                    StylizedDetector.Info info = new StylizedDetector(px, iw, ih).classify();
                    kind = info.isActionable() ? info.kind : null;
                    Log.i("QRSuite", "stylized 判定: " + info);
                }
            } catch (Throwable t) {
                Log.w("QRSuite", "stylized 判定失败: " + t);
            }
            final String k = kind;
            new Handler(Looper.getMainLooper()).post(() -> {
                setScanning(true);
                // 一律用结果组件展示（不再弹 toast）：
                // 识别出厂商 -> 显示厂商标签 + 对应提示；
                // 认不出厂商 -> 归为「第三方 / 未知来源」并说明这是私有样式码。
                if (k != null) {
                    showResult(null, null, vendorLabel(k), vendorNotice(k));
                } else {
                    // 既不是已知厂商，也不像已知的异形码结构 → 就是没找到码。
                    // 仍用同一个结果组件展示（按需求：失败也弹组件，不用 toast）。
                    showFailure(getString(R.string.fail_nothing_found));
                }
            });
        }, "stylized-detect").start();
    }


    // ---------------- 语言切换 ----------------

    private static final String PREF_LANG = "lang_override";   // 空 = 跟随系统

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(wrapLang(newBase));
    }

    /**
     * 按用户选择套用界面语言。
     *
     * <p>为什么不用 `AppCompatDelegate.setApplicationLocales()`：它在部分设备/版本上
     * 不生效（实测切换后界面没变），而且依赖 AndroidX 是否接管了 per-app language。
     * 这里改为自己持久化 + 重建 Activity + 覆写 Configuration，行为在所有 API 上一致。
     */
    private static Context wrapLang(Context base) {
        String code = base.getSharedPreferences("qrsuite", MODE_PRIVATE)
                .getString(PREF_LANG, "");
        if (code == null || code.isEmpty()) return base;       // 未选择 -> 跟随系统
        java.util.Locale loc = new java.util.Locale(code);
        java.util.Locale.setDefault(loc);
        android.content.res.Configuration cfg =
                new android.content.res.Configuration(base.getResources().getConfiguration());
        cfg.setLocale(loc);
        return base.createConfigurationContext(cfg);
    }

    private String currentLangCode() {
        String saved = getSharedPreferences("qrsuite", MODE_PRIVATE).getString(PREF_LANG, "");
        if (saved != null && !saved.isEmpty()) return saved;
        return Locale.getDefault().getLanguage();               // 跟随系统
    }

    /** 切换按钮显示的是"切过去的目标语言"，所以当前中文时显示 English。 */
    private void updateLangButton() {
        if (btnLang == null) return;
        boolean zh = "zh".equalsIgnoreCase(currentLangCode());
        btnLang.setText(zh ? "English" : "中文");
        btnLang.setContentDescription(zh ? "Switch to English" : "切换到中文");
    }

    private void toggleLang() {
        boolean zh = "zh".equalsIgnoreCase(currentLangCode());
        getSharedPreferences("qrsuite", MODE_PRIVATE).edit()
                .putString(PREF_LANG, zh ? "en" : "zh").apply();
        // 重建 Activity 让新语言生效（不依赖 AndroidX 的自动重建）
        recreate();
    }


    // ---------------- 结果面板 ----------------

    /**
     * 统一的结果组件（BottomSheet）。
     *
     * <p>成功与失败**都用这一个组件**展示（按需求：不再用 toast 提示成败）：
     * <ul>
     *   <li>成功：显示码制标签 + 厂商标签 + 内容 + 复制/分享/打开等操作。</li>
     *   <li>失败：隐藏内容与操作，只显示一段说明（resNotice）。</li>
     * </ul>
     *
     * @param content 成功时的内容；失败传 null
     * @param format  码制（如 "QR Code"）；失败传 null
     * @param vendor  厂商标签文案；无则隐藏
     * @param notice  失败说明；非 null 时进入失败态
     */
    private void showResult(String content, String format, String vendor, String notice) {
        showResult(content, format, vendor, notice, null);
    }

    /**
     * 统一结果组件（含二进制 payload 支持）。
     *
     * @param rawBytes ML Kit 的 {@code getRawBytes()}。传入后若判定为二进制，
     *                 界面改为「二进制数据」形态：显示字节数与可读片段，
     *                 复制走 Base64（无损），分享发送原始 .bin 文件。
     *                 直接显示 getRawValue() 的字符串会是满屏控制字符（乱码）。
     */
    private void showResult(String content, String format, String vendor, String notice, byte[] rawBytes) {
        BottomSheetDialog dlg = new BottomSheetDialog(this, R.style.Theme_QRSuite_Sheet);
        View v = LayoutInflater.from(this).inflate(R.layout.sheet_result, null, false);

        TextView tvFormat = v.findViewById(R.id.resFormat);
        TextView tvVendor = v.findViewById(R.id.resVendor);
        TextView tvContent = v.findViewById(R.id.resContent);
        TextView tvNotice = v.findViewById(R.id.resNotice);
        TextView tvMeta = v.findViewById(R.id.resMeta);
        MaterialButton bCopy = v.findViewById(R.id.resCopy);
        MaterialButton bShare = v.findViewById(R.id.resShare);
        MaterialButton bOpen = v.findViewById(R.id.resOpen);
        MaterialButton bSearch = v.findViewById(R.id.resSearch);
        MaterialButton bClose = v.findViewById(R.id.resClose);
        View openDivider = v.findViewById(R.id.resDivider);
        View rowMain = v.findViewById(R.id.resRowMain);
        View rowSub = v.findViewById(R.id.resRowSub);

        boolean failed = (notice != null);
        // 二进制判定基于**原始字节**（getRawBytes），不是解码后的字符串
        boolean binary = !failed && PayloadClassifier.isBinary(rawBytes);

        // ---- 标签区 ----
        if (failed) {
            tvFormat.setText(R.string.fail_title);
        } else if (binary) {
            tvFormat.setText(R.string.binary_title);
        } else {
            tvFormat.setText(format == null ? "" : format);
        }
        if (vendor != null && !vendor.isEmpty()) {
            tvVendor.setText(vendor);
            tvVendor.setVisibility(View.VISIBLE);
        } else {
            tvVendor.setVisibility(View.GONE);
        }

        // ---- 主体 ----
        if (failed) {
            tvNotice.setText(notice);
            tvNotice.setVisibility(View.VISIBLE);
            tvContent.setVisibility(View.GONE);
            tvMeta.setVisibility(View.GONE);
            rowMain.setVisibility(View.GONE);
            rowSub.setVisibility(View.GONE);
            if (openDivider != null) openDivider.setVisibility(View.GONE);
        } else {
            tvNotice.setVisibility(View.GONE);
            tvContent.setVisibility(View.VISIBLE);
            tvMeta.setVisibility(View.VISIBLE);
            rowMain.setVisibility(View.VISIBLE);
            rowSub.setVisibility(View.VISIBLE);

            if (binary) {
                // —— 二进制形态 ——
                tvContent.setText(PayloadClassifier.describe(rawBytes));
                tvMeta.setText(String.format(Locale.ROOT, "%d 字节 · 二进制 · 已存入历史", rawBytes.length));
                // 二进制没有可打开的链接 / 搜索意义不大，但搜索仍可用于核对片段
                bOpen.setVisibility(View.GONE);
                if (openDivider != null) openDivider.setVisibility(View.GONE);

                bCopy.setText(R.string.copy_b64);
                bCopy.setOnClickListener(x -> {
                    // 用 Android 的 Base64 实现注入给分类器（分类器本身不依赖 android.*，便于纯 JVM 测试）
                    copy(PayloadClassifier.toBase64(rawBytes,
                            r -> android.util.Base64.encodeToString(r, android.util.Base64.NO_WRAP)));
                    Toast.makeText(this, R.string.copied_b64, Toast.LENGTH_SHORT).show();
                });
                bShare.setText(R.string.share_raw);
                bShare.setOnClickListener(x -> shareRawBytes(rawBytes));
            } else {
                tvContent.setText(content);
                tvMeta.setText(content.length() + " 字符 · 已存入历史");

                boolean isUrl = looksLikeUrl(content);
                bOpen.setVisibility(isUrl ? View.VISIBLE : View.GONE);
                if (openDivider != null) openDivider.setVisibility(isUrl ? View.VISIBLE : View.GONE);

                bCopy.setOnClickListener(x -> {
                    copy(content);
                    Toast.makeText(this, R.string.copied, Toast.LENGTH_SHORT).show();
                });
                bShare.setOnClickListener(x -> {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, content);
                    startActivity(Intent.createChooser(i, getString(R.string.share)));
                });
            }
            bOpen.setOnClickListener(x -> openUrl(content));
            bSearch.setOnClickListener(x -> {
                Intent i = new Intent(Intent.ACTION_VIEW,
                        Uri.parse("https://www.google.com/search?q=" + Uri.encode(content)));
                startActivity(i);
            });
        }

        bClose.setOnClickListener(x -> dlg.dismiss());
        v.findViewById(R.id.resContinue).setOnClickListener(x -> dlg.dismiss());

        dlg.setContentView(v);
        dlg.setOnDismissListener(d -> {
            if (hasCamera()) setScanning(true);
        });
        dlg.show();
    }

    /**
     * 分享原始字节为 .bin 文件。
     *
     * <p>为什么用文件而不是文本：剪贴板/文本分享会把 {@code \n} 规范化成 {@code \r\n}，
     * 对二进制是真损坏。落成文件才能保证字节不变。
     */
    private void shareRawBytes(byte[] raw) {
        try {
            File dir = new File(getCacheDir(), "payload");
            if (!dir.exists() && !dir.mkdirs()) { return; }
            File f = new File(dir, "qrsuite-payload-" + raw.length + "B.bin");
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(raw);
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("application/octet-stream");
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(i, getString(R.string.share_raw)));
        } catch (Exception e) {
            Log.w(TAG, "分享原始数据失败", e);
            Toast.makeText(this, R.string.share_raw_failed, Toast.LENGTH_SHORT).show();
        }
    }

    /** 兼容旧调用：成功态、无厂商。 */
    private void showResult(String content, String format) {
        showResult(content, format, null, null);
    }

    /** 以结果组件展示失败（替代原来的 toast）。 */
    private void showFailure(String notice) {
        showResult(null, null, null, notice);
    }

    /** 厂商 kind -> 显示标签。知名厂商分类；识别不出则归为「第三方 / 未知来源」。 */
    private String vendorLabel(String kind) {
        if (StylizedDetector.KIND_DOUYIN.equals(kind)) return getString(R.string.vendor_bytedance_douyin);
        if (StylizedDetector.KIND_WECHAT_MINIPROGRAM.equals(kind)
                || StylizedDetector.KIND_WECHAT_REWARD.equals(kind)) return getString(R.string.vendor_tencent_wechat);
        return getString(R.string.vendor_thirdparty);
    }

    /** 厂商 kind -> 提示文案。 */
    private String vendorNotice(String kind) {
        if (StylizedDetector.KIND_DOUYIN.equals(kind)) return getString(R.string.stylized_douyin);
        if (StylizedDetector.KIND_WECHAT_MINIPROGRAM.equals(kind)) return getString(R.string.stylized_wechat_mp);
        if (StylizedDetector.KIND_WECHAT_REWARD.equals(kind)) return getString(R.string.stylized_wechat_reward);
        return getString(R.string.stylized_thirdparty);
    }

    private void copy(String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("QRSuite", text));
    }

    private void openUrl(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "没有可打开该链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean looksLikeUrl(String s) {
        if (s == null || s.length() > 2048) return false;
        String t = s.trim().toLowerCase(Locale.ROOT);
        return t.startsWith("http://") || t.startsWith("https://")
                || t.startsWith("mailto:") || t.startsWith("tel:")
                || t.startsWith("geo:") || t.startsWith("market://");
    }

    // ---------------- 历史 ----------------

    private void showHistory() {
        BottomSheetDialog dlg = new BottomSheetDialog(this, R.style.Theme_QRSuite_Sheet);
        View v = LayoutInflater.from(this).inflate(R.layout.sheet_history, null, false);
        LinearLayout list = v.findViewById(R.id.histList);
        TextView empty = v.findViewById(R.id.histEmpty);
        TextView count = v.findViewById(R.id.histCount);
        MaterialButton clear = v.findViewById(R.id.histClear);

        List<HistoryStore.Entry> items = db.recent(100);
        count.setText(String.valueOf(items.size()));
        empty.setVisibility(items.isEmpty() ? View.VISIBLE : View.GONE);

        for (HistoryStore.Entry e : items) {
            View row = LayoutInflater.from(this).inflate(R.layout.item_history, list, false);
            TextView tvContent = row.findViewById(R.id.itemContent);
            TextView tvMeta = row.findViewById(R.id.itemMeta);
            MaterialButton btnShare = row.findViewById(R.id.itemShare);
            MaterialButton btnDelete = row.findViewById(R.id.itemDelete);

            tvContent.setText(e.content);
            tvMeta.setText(e.format + " · " + timeAgo(e.ts) + " · "
                    + ("camera".equals(e.source) ? "相机" : "相册"));
            row.setOnClickListener(x -> {
                copy(e.content);
                Toast.makeText(this, R.string.copied, Toast.LENGTH_SHORT).show();
            });
            btnShare.setOnClickListener(x -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, e.content);
                startActivity(Intent.createChooser(i, getString(R.string.share)));
            });
            btnDelete.setOnClickListener(x -> {
                db.delete(e.id);
                list.removeView(row);
                int n = list.getChildCount();
                count.setText(String.valueOf(n));
                empty.setVisibility(n == 0 ? View.VISIBLE : View.GONE);
            });
            list.addView(row);
        }

        clear.setOnClickListener(x -> {
            db.clear();
            list.removeAllViews();
            count.setText("0");
            empty.setVisibility(View.VISIBLE);
            Toast.makeText(this, R.string.cleared, Toast.LENGTH_SHORT).show();
        });

        dlg.setContentView(v);
        dlg.show();
    }

    private static final SimpleDateFormat FULL =
            new SimpleDateFormat("MM-dd HH:mm", Locale.getDefault());

    private String timeAgo(long ts) {
        long diff = System.currentTimeMillis() - ts;
        if (diff < 60_000L) return "刚刚";
        if (diff < 3_600_000L) return (diff / 60_000L) + " 分钟前";
        if (diff < 86_400_000L) return (diff / 3_600_000L) + " 小时前";
        return FULL.format(new Date(ts));
    }

    // ---------------- 条码格式名 ----------------

    private String formatName(int format) {
        switch (format) {
            case Barcode.FORMAT_QR_CODE: return "QR Code";
            case Barcode.FORMAT_DATA_MATRIX: return "Data Matrix";
            case Barcode.FORMAT_AZTEC: return "Aztec";
            case Barcode.FORMAT_PDF417: return "PDF417";
            case Barcode.FORMAT_CODE_128: return "Code 128";
            case Barcode.FORMAT_CODE_39: return "Code 39";
            case Barcode.FORMAT_CODE_93: return "Code 93";
            case Barcode.FORMAT_EAN_13: return "EAN-13";
            case Barcode.FORMAT_EAN_8: return "EAN-8";
            case Barcode.FORMAT_UPC_A: return "UPC-A";
            case Barcode.FORMAT_UPC_E: return "UPC-E";
            case Barcode.FORMAT_ITF: return "ITF";
            case Barcode.FORMAT_CODABAR: return "Codabar";
            default: return "未知格式";
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasCamera() && cameraProvider != null) {
            setScanning(true);
            busy.set(false);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        setScanning(false);
        if (torchOn) toggleTorch();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (analysisExecutor != null) analysisExecutor.shutdown();
        if (scanner != null) scanner.close();
        if (db != null) db.close();
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
    }
}
