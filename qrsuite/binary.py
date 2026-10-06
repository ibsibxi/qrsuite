# -*- coding: utf-8 -*-
"""qrsuite.binary —— 二进制 payload 的检测与可读呈现。

## 为什么需要

有些二维码（乘车码、电子票据、加密令牌）里装的**不是文本**，而是一段二进制。
标准 QR 只是**容器**，它完全允许任意字节；解码器也能正确解出这些字节。
问题出在**呈现层**：把二进制当文本显示，满屏控制字符，用户看到的就是"乱码"，
于是误以为"没解析出来"。

实测（支付宝乘车码照片，用户提供）：
    同一张码，各引擎解出长度差很多 ——
        zxing 942 字节 / zbar 460 字节 / cv2 7 字节
    原因是**二进制里含 NUL**，不同引擎对 NUL 的截断与编码处理不同。
    而 payload 里嵌着一段可读的 16 位数字（用户/凭证 ID）。
    => 正确做法不是丢掉它，而是**明确标注这是二进制**，并给出可读部分。

判定标准（保守，宁可漏判也不要误判普通文本为二进制）：
    1. 含 NUL → 必为二进制（文本里不会出现 NUL）
    2. 控制字符/代理转义占比 > 20% → 二进制
URL、中文、普通文本都不会触发，因此不会影响常见场景。
"""
from __future__ import annotations

import re

# 允许出现在"正常文本"里的空白字符
_TEXT_WS = {'\t', '\n', '\r', '\x0b', '\x0c'}

# zxing-cpp 把不可打印字节渲染成的转义写法，例如 "<SOH>"、"<U+81>"、"<NUL>"。
# 实测：支付宝乘车码里 zxing 给出的 payload **不含任何真实控制字节**，
# 而是把二进制字节逐个写成这种转义文本；因此要把它当作"这是二进制"的信号。
_ESCAPE_TOKEN_RE = re.compile(r'<(?:U\+[0-9A-Fa-f]{2,6}|NUL|SOH|STX|ETX|EOT|ENQ|ACK|BEL|BS|HT|LF|VT|FF|CR|'
                              r'SO|SI|DLE|DC[1-4]|NAK|SYN|ETB|CAN|EM|SUB|ESC|FS|GS|RS|US|DEL)>')

# 连续可打印片段（长度 >= 4），用于从二进制里捞出可能有意义的字符串
_RUN_RE = re.compile(r'[\x20-\x7e]{4,}')
# 按字节匹配的版本（extract_runs 在原始字节上找片段）
_RUN_BYTES_RE = re.compile(rb'[\x20-\x7e]{4,}')


def looks_binary(s: str) -> bool:
    """判断解码结果是否为二进制（而非可读文本）。

    实测校准依据（支付宝乘车码，同一张码各引擎结果不同）：

        zxing  854 字符 / 942 字节 : 89.7% ASCII + 10.3% 高位，**0% 控制字符**
        zbar   332 字符 / 460 字节 : 36% ASCII + 26.5% 高位 + 36.7% 控制字符
        cv2      6 字符 /   7 字节 : 66.7% 控制字符（被 NUL 截断）

    注意 zxing 那条**没有控制字符**，只有控制字符判据会漏判它 ——
    那 10.3% 高位字符是无效 UTF-8 被替换后的残留，本质仍是二进制。
    所以要三个维度一起看：NUL / 控制字符 / 非 ASCII 占比。
    """
    if not s:
        return False
    if '\x00' in s:
        return True                      # 文本里不会有 NUL
    # zxing-cpp 的转义文本形态（如 "<SOH>"、"<U+81>"）：说明上游解出的是二进制字节。
    # 实测支付宝乘车码：zxing 那条 0% 真实控制字节，全靠这条判据识别。
    if _ESCAPE_TOKEN_RE.search(s):
        return True

    ctrl = 0        # 控制字符与无效字节
    non_ascii = 0   # 非 ASCII
    fffd = 0        # U+FFFD 替换字符 = 解码时遇到无效字节的残留
    latin1_ish = 0  # U+0080..U+00FF：单字节直译后的残留（关键信号）
    for c in s:
        o = ord(c)
        if c in _TEXT_WS:
            continue
        if o == 0xFFFD:
            fffd += 1
        elif 0x80 <= o <= 0xFF:
            # 这一段是"原始字节被按单字节编码直译"的痕迹（含 C1 控制符 0x80-0x9F）。
            # 真实文本里出现 Latin-1 补充字符是可能的（如 é、°，但很稀少）；
            # 而二进制被直译时这一区会**成片集中出现**。
            latin1_ish += 1
            non_ascii += 1
        elif o < 32 or o == 127 or 0xDC80 <= o <= 0xDCFF:
            # 注意：这里**不能**写成 `o <= 0x9F` —— 那会把 0x20-0x7E 的所有
            # ASCII 可打印字符都算成控制字符，导致任何普通文本都被误判为二进制。
            # C1 控制符 0x80-0x9F 已由上面的 latin1 分支覆盖。
            ctrl += 1
        elif o > 127:
            non_ascii += 1

    n = len(s)
    # 含替换字符 -> 上游遇到过无效字节
    if fffd > 0:
        return True
    # 控制字符占比高
    if ctrl / n > 0.10:
        return True
    # 关键判据：Latin-1 补充区字符占比高，且整段里没有 CJK 语义
    # （实测支付宝乘车码：zxing 那条 88/854 = 10.3% 全部落在 U+00A1..U+00FF）
    if latin1_ish / n > 0.03 and not _has_cjk(s):
        return True
    if (non_ascii + ctrl) / n > 0.05 and ctrl > 0 and not _has_cjk(s):
        return True
    if non_ascii / n > 0.80 and not _has_cjk(s):
        return True
    return False


def _has_cjk(s: str) -> bool:
    """是否含中日韩文字（用来区分"合法的中文文本"与"乱码高位字节"）。"""
    return any(
        0x4E00 <= ord(c) <= 0x9FFF or      # CJK 统一表意
        0x3040 <= ord(c) <= 0x30FF or      # 日文假名
        0xAC00 <= ord(c) <= 0xD7AF or      # 韩文
        0x3000 <= ord(c) <= 0x303F         # CJK 标点
        for c in s
    )


def to_hex_dump(s: str, limit: int = 512) -> str:
    """把二进制转成十六进制 dump（每行 16 字节，带偏移）。"""
    raw = s.encode('utf-8', 'surrogatepass')
    lines = []
    for off in range(0, min(len(raw), limit), 16):
        chunk = raw[off:off + 16]
        hexs = ' '.join(f'{b:02x}' for b in chunk)
        asc = ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)
        lines.append(f'{off:08x}  {hexs:<47}  {asc}')
    if len(raw) > limit:
        lines.append(f'...（共 {len(raw)} 字节，此处只显示前 {limit} 字节）')
    return '\n'.join(lines)


def extract_runs(s: str, min_len: int = 4, limit: int = 12) -> list:
    """从二进制里捞出连续可打印片段（用户唯一可能看懂的内容）。

    注意：必须先还原成**原始字节**再找，否则会把 repr 出来的字面量
    （如 '<SOH>'、'<U+81>'）当成可读文本 —— 那些是转义写法，不是内容。
    这里按 Latin-1 逐字符还原为单字节（解码器直译字节时正是这个映射）。
    """
    raw = bytearray()
    for c in s:
        o = ord(c)
        if 0xDC80 <= o <= 0xDCFF:          # 代理转义（surrogateescape）
            raw.append(o - 0xDC00)
        elif o <= 0xFF:
            raw.append(o)                  # 含 Latin-1 直译与普通 ASCII
        else:
            raw.extend(c.encode('utf-8', 'replace'))
    out = []
    seen = set()
    for m in _RUN_BYTES_RE.finditer(bytes(raw)):
        r = m.group().decode('ascii')
        # 过滤掉明显是转义写法的片段（zxing-cpp 会把不可打印字节渲染成
        # "<SOH>"、"<U+81>" 这类字面文本，它们不是可读内容）。
        if len(r) < min_len or r in seen:
            continue
        if _ESCAPE_TOKEN_RE.search(r):
            continue
        # 片段里若混有大量 "<XXX>" 形式的记号，也不给用户看
        if re.search(r'<[A-Z][A-Z0-9]{1,5}>', r) or re.search(r'<U\+[0-9A-Fa-f]{2,6}>', r):
            continue
        # 要求足够比例的字母/数字，纯符号片段没有信息量
        alnum = sum(1 for c in r if c.isalnum())
        if alnum / len(r) < 0.4:
            continue
        seen.add(r)
        out.append(r)
        if len(out) >= limit:
            break
    return out


def describe(s: str) -> dict:
    """给二进制 payload 生成可读摘要，供 CLI / API / 网页端展示。"""
    raw = s.encode('utf-8', 'surrogatepass')
    return {
        'binary': True,
        'bytes': len(raw),
        'hex_head': raw[:32].hex(),
        'printable_ratio': round(sum(1 for b in raw if 32 <= b < 127) / max(len(raw), 1), 3),
        'ascii_runs': extract_runs(s),
        'hex_dump': to_hex_dump(s),
    }
