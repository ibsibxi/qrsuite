package com.qrsuite.scanner;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 二进制 payload 的判定与可读呈现。
 *
 * <h3>为什么需要</h3>
 * 有些二维码（乘车码、电子票据）里装的**不是文本**，而是二进制。标准 QR 只是容器，
 * 允许任意字节；ML Kit 的 {@code Barcode.getRawValue()} 会把它们当字符串返回，
 * 界面直接显示就是满屏控制字符，用户以为"没解析出来"。
 *
 * <h3>数据来源：必须用 getRawBytes()</h3>
 * ML Kit 提供两个原始数据入口：
 * <ul>
 *   <li>{@code getRawBytes()} —— <b>原始字节</b>，无编码损失。判定必须基于它。</li>
 *   <li>{@code getRawValue()} —— 按 UTF-8 解码后的字符串，无效序列会变成 U+FFFD，
 *       且可能在 NUL 处截断。只用于展示可读文本，不能用于判定。</li>
 * </ul>
 *
 * <h3>为什么复制走 Base64 而不是原文</h3>
 * 剪贴板把文本按纯文本传输，会把 {@code \n} 规范化成 {@code \r\n}
 * （实测：源 317 字节 → 剪贴板 318 字节，第 86 字节 0x0A 变成 0x0D 0x0A）。
 * 对二进制这是<b>真损坏</b>，因此二进制只提供 Base64 与原始文件两条无损路径。
 * 与网页端（docs/app.js 的 payloadBase64）和 Python 端（qrsuite/binary.py）策略一致。
 *
 * <h3>为什么这个类不引用任何 android.* </h3>
 * 为了能被 <b>纯 JVM 单元测试</b>直接覆盖（见 {@code src/test/.../PayloadClassifierTest}）。
 * 手机不可用时，这是唯一能验证判定逻辑正确性的手段；依赖 android.util.Base64
 * 就必须跑 Robolectric 或真机，代价与不确定性都高得多。
 * Base64 由调用方通过 {@link Encoder} 注入，Android 侧传 {@code android.util.Base64}。
 */
public final class PayloadClassifier {

    private PayloadClassifier() { }

    /** 由调用方注入的 Base64 实现（纯 Java 侧用 java.util.Base64，Android 侧用 android.util.Base64）。 */
    public interface Encoder {
        String encode(byte[] raw);
    }

    /** 控制字符占比超过该比例即判为二进制。 */
    public static final double CONTROL_RATIO_THRESHOLD = 0.10;

    /**
     * 判定是否二进制。
     * <p>判据（与 Python qrsuite/binary.py、网页端 isBinaryText 对齐）：
     * <ol>
     *   <li>出现 NUL 字节 → 是（文本里不会出现 NUL）</li>
     *   <li>控制字符（C0 除 \t\n\r，以及 DEL）占比 &gt; 10% → 是</li>
     * </ol>
     */
    public static boolean isBinary(byte[] raw) {
        if (raw == null || raw.length == 0) return false;
        int ctrl = 0;
        for (byte b : raw) {
            int v = b & 0xFF;
            if (v == 0x00) return true;
            if (v < 0x20) {
                if (v != 0x09 && v != 0x0A && v != 0x0D) ctrl++;
            } else if (v == 0x7F) {
                ctrl++;
            }
        }
        return (ctrl / (double) raw.length) > CONTROL_RATIO_THRESHOLD;
    }

    /**
     * 提取**真正可读**的片段。
     *
     * <p>过滤条件（与网页端 binaryRuns 一致）：优先抽取长度 ≥8 的纯数字子串（凭证 ID / 票号），
     * 其次才接受长度 ≥12 且字母数字占比 ≥85% 的编码串。
     * 二进制里随便一段字母数字混排（如 "We~z%5"）没有信息量，展示出来用户仍会觉得是乱码。
     */
    public static List<String> readableRuns(byte[] raw, int limit) {
        List<String> out = new ArrayList<>();
        if (raw == null || raw.length == 0 || limit <= 0) return out;
        StringBuilder cur = new StringBuilder();
        for (byte b : raw) {
            int v = b & 0xFF;
            if (v >= 0x20 && v < 0x7F) {
                cur.append((char) v);
            } else {
                flushRun(cur, out, limit);
                if (out.size() >= limit) return out;
            }
        }
        flushRun(cur, out, limit);
        return out;
    }

    private static void flushRun(StringBuilder cur, List<String> out, int limit) {
        if (cur.length() == 0) return;
        String s = cur.toString();
        cur.setLength(0);
        if (out.size() >= limit) return;

        // ① 优先抽纯数字子串："2088732564945072j" → "2088732564945072"
        String digits = longestDigits(s, 8);
        if (digits != null) {
            if (!out.contains(digits)) out.add(digits);
            return;
        }
        // ② 长字母数字串（订单号之类）
        if (s.length() >= 12) {
            int alnum = 0;
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) alnum++;
            }
            if (alnum / (double) s.length() >= 0.85 && !out.contains(s)) out.add(s);
        }
    }

    /** 返回 s 中最长的连续数字子串；不足 minLen 时返回 null。 */
    static String longestDigits(String s, int minLen) {
        int bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= '0' && c <= '9') {
                if (curLen == 0) curStart = i;
                curLen++;
                if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
            } else {
                curLen = 0;
            }
        }
        return bestLen >= minLen ? s.substring(bestStart, bestStart + bestLen) : null;
    }

    /** 可打印 ASCII 占比，用于向用户说明"这是二进制"的证据。 */
    public static double printableRatio(byte[] raw) {
        if (raw == null || raw.length == 0) return 0;
        int p = 0;
        for (byte b : raw) {
            int v = b & 0xFF;
            if (v >= 0x20 && v < 0x7F) p++;
        }
        return p / (double) raw.length;
    }

    /** Base64 编码（无损、纯 ASCII，可安全经剪贴板与分享传递）。 */
    public static String toBase64(byte[] raw, Encoder encoder) {
        if (raw == null) return "";
        return encoder.encode(raw);
    }

    /** 供界面显示的一句话摘要（中文）。 */
    public static String describe(byte[] raw) {
        int n = raw == null ? 0 : raw.length;
        List<String> runs = readableRuns(raw, 4);
        StringBuilder sb = new StringBuilder();
        sb.append(String.format(Locale.ROOT,
                "解出了 %d 字节的二进制数据（可打印占比 %.0f%%）—— 这不是文本，无法按文字显示。",
                n, printableRatio(raw) * 100));
        if (!runs.isEmpty()) {
            sb.append("\n其中的可读片段: ").append(join(" | ", runs));
        }
        sb.append("\n（二进制只提供「复制 Base64」与「分享 .bin」：剪贴板会把换行规范化，直接复制原文会改变数据）");
        return sb.toString();
    }

    /** 小工具：替代 android.text.TextUtils.join，保持本类无 Android 依赖。 */
    static String join(String sep, List<String> items) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) sb.append(sep);
            sb.append(items.get(i));
        }
        return sb.toString();
    }
}
