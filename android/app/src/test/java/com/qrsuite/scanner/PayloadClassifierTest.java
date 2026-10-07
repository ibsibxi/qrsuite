package com.qrsuite.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNull;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/**
 * {@link PayloadClassifier} 的纯 JVM 单元测试。
 *
 * <p>为什么必须有这个测试：手机不可用时，**这是唯一能验证判定逻辑正确性的手段**。
 * 只"编译通过"证明不了判定对不对，而判错了的后果很糟——
 * 正常文本被当成二进制（用户拿不到内容），或二进制被当文本（显示乱码）。
 *
 * <p>测试数据取自真实样本：Alipay 乘车码解出的 317 字节 payload，
 * 其中能抽出 16 位凭证 ID {@code 2088732564945072}。
 * 这与 Python 端 {@code qrsuite/binary.py}、网页端 {@code docs/app.js} 的行为一致。
 */
public class PayloadClassifierTest {

    /** 用 java.util.Base64 注入，验证分类器不依赖 android.util.Base64。 */
    private static final PayloadClassifier.Encoder B64 =
            raw -> Base64.getEncoder().encodeToString(raw);

    /** 拼一段接近真实的乘车码二进制：控制字符 + 可读 ID + 更多控制字符。 */
    private static byte[] rideCodePayload() throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(new byte[]{(byte) 0x81, 0x01, 'I', '$', 0x01, 0x01, 0x00, 0x00, 0x01, 0x12});
        o.write(" \u0012)\u0000\u0000\u0001\u0004\u0004\u0000!".getBytes(StandardCharsets.ISO_8859_1));
        o.write(0x02);
        o.write("2088732564945072".getBytes(StandardCharsets.US_ASCII));
        o.write(new byte[]{0x0E, 0x1C, 0x00, 0x00, 0x00});
        return o.toByteArray();
    }

    /* ------------------------------ 判定：正例 ------------------------------ */

    @Test
    public void rideCodeIsBinary() throws Exception {
        assertTrue("乘车码 payload 必须判定为二进制", PayloadClassifier.isBinary(rideCodePayload()));
    }

    @Test
    public void nulByteAloneIsBinary() {
        assertTrue(PayloadClassifier.isBinary(new byte[]{'a', 0x00, 'b'}));
    }

    @Test
    public void highControlRatioIsBinary() {
        // 10 个字符里 5 个控制符（50% > 10%）
        assertTrue(PayloadClassifier.isBinary(new byte[]{1, 2, 3, 4, 5, 'a', 'b', 'c', 'd', 'e'}));
    }

    /* ------------------------------ 判定：反例（关键！） ------------------------------ */

    @Test
    public void plainAsciiIsNotBinary() {
        assertFalse(PayloadClassifier.isBinary("hello world".getBytes(StandardCharsets.US_ASCII)));
    }

    @Test
    public void chineseTextIsNotBinary() {
        // 中文经 UTF-8 是合法多字节序列，绝不能被误判为二进制
        assertFalse(PayloadClassifier.isBinary("中文内容测试".getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    public void urlIsNotBinary() {
        assertFalse(PayloadClassifier.isBinary(
                "https://github.com/ibsibxi/qrsuite".getBytes(StandardCharsets.US_ASCII)));
    }

    @Test
    public void newlinesAndTabsAreNotBinary() {
        // \t \n \r 是合法文本字符，不能计入控制字符比例
        assertFalse(PayloadClassifier.isBinary("a\tb\nc\r\nd".getBytes(StandardCharsets.US_ASCII)));
    }

    @Test
    public void emptyAndNullAreNotBinary() {
        assertFalse(PayloadClassifier.isBinary(new byte[0]));
        assertFalse(PayloadClassifier.isBinary(null));
    }

    @Test
    public void singleControlInLongTextIsNotBinary() {
        // 300 字符里 1 个控制符 ≈ 0.33%，低于阈值，不应误判
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 300; i++) sb.append('x');
        sb.setCharAt(150, (char) 0x01);
        assertFalse(PayloadClassifier.isBinary(sb.toString().getBytes(StandardCharsets.ISO_8859_1)));
    }

    /* ------------------------------ 可读片段提取 ------------------------------ */

    @Test
    public void extractsRideCodeId() throws Exception {
        List<String> runs = PayloadClassifier.readableRuns(rideCodePayload(), 4);
        assertTrue("必须能抽出 16 位凭证 ID，实得: " + runs, runs.contains("2088732564945072"));
    }

    @Test
    public void stripsTrailingJunkFromDigits() {
        // "2088732564945072j" → 干净的 "2088732564945072"
        byte[] raw = ("\u0001\u0002" + "2088732564945072j" + "\u0003").getBytes(StandardCharsets.ISO_8859_1);
        List<String> runs = PayloadClassifier.readableRuns(raw, 4);
        assertTrue(runs.contains("2088732564945072"));
        assertFalse("不应带尾巴", runs.contains("2088732564945072j"));
    }

    @Test
    public void ignoresMeaninglessShortMix() {
        // 二进制里常见的无信息量混排，不应作为"可读片段"展示给用户
        byte[] raw = ("\u0001" + "We~z%5" + "\u0002" + "AdWS" + "\u0003").getBytes(StandardCharsets.ISO_8859_1);
        List<String> runs = PayloadClassifier.readableRuns(raw, 4);
        assertTrue("无信息量的短串应被过滤掉，实得: " + runs, runs.isEmpty());
    }

    @Test
    public void acceptsLongAlnumCode() {
        byte[] raw = ("\u0001" + "hH2088732564945072K0000GKFEF" + "\u0002").getBytes(StandardCharsets.ISO_8859_1);
        List<String> runs = PayloadClassifier.readableRuns(raw, 4);
        // 该串含 16 位数字，按 ① 规则会抽出纯数字部分
        assertTrue("实得: " + runs, runs.contains("2088732564945072"));
    }

    @Test
    public void respectsLimit() throws Exception {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (int i = 0; i < 6; i++) {
            o.write(0x01);
            o.write(("100000000000000" + i).getBytes(StandardCharsets.US_ASCII));
        }
        List<String> runs = PayloadClassifier.readableRuns(o.toByteArray(), 2);
        assertEquals("limit 必须生效", 2, runs.size());
    }

    @Test
    public void noDuplicates() {
        byte[] raw = ("\u0001" + "1111111111" + "\u0002" + "1111111111").getBytes(StandardCharsets.ISO_8859_1);
        List<String> runs = PayloadClassifier.readableRuns(raw, 4);
        assertEquals("重复片段只保留一次", 1, runs.size());
    }

    @Test
    public void nullAndEmptyAreSafe() {
        assertTrue(PayloadClassifier.readableRuns(null, 4).isEmpty());
        assertTrue(PayloadClassifier.readableRuns(new byte[0], 4).isEmpty());
        assertEquals(0.0, PayloadClassifier.printableRatio(null), 0.0001);
        assertEquals(0.0, PayloadClassifier.printableRatio(new byte[0]), 0.0001);
        assertEquals("", PayloadClassifier.toBase64(null, B64));
    }

    /* ------------------------------ 工具方法 ------------------------------ */

    @Test
    public void longestDigitsWorks() {
        assertEquals("2088732564945072", PayloadClassifier.longestDigits("hH2088732564945072K", 8));
        assertNull("不足 8 位应返回 null", PayloadClassifier.longestDigits("abc123", 8));
        assertNull(PayloadClassifier.longestDigits("nodigits", 8));
        assertEquals("12345678", PayloadClassifier.longestDigits("a12345678b", 8));
        // 多个数字串取最长的
        assertEquals("999999999", PayloadClassifier.longestDigits("123-999999999", 8));
    }

    @Test
    public void printableRatioIsCorrect() {
        assertEquals(1.0, PayloadClassifier.printableRatio("ABC".getBytes(StandardCharsets.US_ASCII)), 0.0001);
        assertEquals(0.0, PayloadClassifier.printableRatio(new byte[]{0x01, 0x02}), 0.0001);
        // "AB" + 2 个控制符 = 50%
        assertEquals(0.5, PayloadClassifier.printableRatio(new byte[]{'A', 'B', 0x01, 0x02}), 0.0001);
    }

    /* ------------------------------ Base64 无损失 ------------------------------ */

    @Test
    public void base64RoundTripsExactly() throws Exception {
        byte[] raw = rideCodePayload();
        String b64 = PayloadClassifier.toBase64(raw, B64);
        byte[] back = Base64.getDecoder().decode(b64);
        assertTrue("Base64 必须能无损还原原始字节", java.util.Arrays.equals(raw, back));
        // 纯 ASCII，不含 NUL/控制字符 —— 这正是它能经剪贴板安全传递的原因
        for (int i = 0; i < b64.length(); i++) {
            char c = b64.charAt(i);
            assertTrue("Base64 字符必须可打印", c > 0x20 && c < 0x7F);
        }
    }

    @Test
    public void base64SurvivesNewlineNormalisation() throws Exception {
        // 反例说明：原始字节里的 \n 若走"复制原文"，剪贴板会变成 \r\n 而损坏数据。
        // Base64 不含 \n，因此不受剪贴板规范化影响。
        byte[] withNewline = {0x01, '\n', 0x02};
        String b64 = PayloadClassifier.toBase64(withNewline, B64);
        assertFalse("Base64 输出不应含换行", b64.contains("\n") || b64.contains("\r"));
        assertTrue(java.util.Arrays.equals(withNewline, Base64.getDecoder().decode(b64)));
    }

    /* ------------------------------ 摘要文案 ------------------------------ */

    @Test
    public void describeMentionsBytesAndRuns() throws Exception {
        String s = PayloadClassifier.describe(rideCodePayload());
        assertTrue("摘要应含字节数: " + s, s.contains("字节的二进制数据"));
        assertTrue("摘要应含可读片段: " + s, s.contains("2088732564945072"));
        assertTrue("摘要应说明复制策略: " + s, s.contains("Base64"));
    }
}
