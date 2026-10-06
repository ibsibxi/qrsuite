# -*- coding: utf-8 -*-
"""把 Documentation/MANUAL.md 渲染成 docs/manual.html（与站点同风格，可直接被 GitHub Pages 访问）

用法: python tools/build_manual.py
依赖: pip install markdown
"""
import os, sys, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Documentation', 'MANUAL.md')
DST = os.path.join(ROOT, 'docs', 'manual.html')

# 手册里的文档间链接是相对路径（在 GitHub 上直接可点）；生成的 HTML 放在 docs/ 下由 Pages 访问，
# 相对链接会 404，因此统一改写成仓库页面地址。fork 后请改这一行。
REPO = 'https://github.com/ibsibxi/qrsuite/blob/main/'
DOCDIR = 'Documentation/'   # 裸文件名链接相对 MANUAL.md 自己的目录解析


def _rewrite_md_links(html: str) -> str:
    """`ARCHITECTURE.md` → REPO/Documentation/…，`../android/README.md` → REPO/android/…"""
    def repl(m):
        rel = m.group(1)
        target = rel[3:] if rel.startswith('../') else DOCDIR + rel
        return 'href="%s%s%s"' % (REPO, target, m.group(2) or '')

    return re.sub(r'href="(?!https?:|#)((?:\.\./)?[A-Za-z0-9_.\-/]+\.md)(#[^"]*)?"', repl, html)


TPL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QRSuite v2 使用手册</title>
<style>
:root{{--bg:#0e1320;--card:#171f30;--line:#26314a;--fg:#e8eef7;--mut:#8ea0bd;--acc:#3ea6ff;--ok:#31c48d}}
*{{box-sizing:border-box}}
body{{margin:0;background:radial-gradient(1200px 600px at 50% -12%,#1c2942,#0e1320 62%);color:var(--fg);
     font:15.5px/1.75 "Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif}}
.wrap{{max-width:920px;margin:0 auto;padding:32px 22px 90px;background:transparent}}
a{{color:var(--acc)}} a:hover{{text-decoration:underline}}
h1{{font-size:28px;margin:0 0 6px}} h2{{font-size:21px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}}
h3{{font-size:17px;margin:24px 0 8px;color:#cfe4ff}} h4{{font-size:15px;margin:18px 0 6px;color:#bcd3f2}}
p,li{{color:#dbe6f5}} li{{margin:4px 0}}
code{{background:#0c1220;border:1px solid #1e2a40;border-radius:5px;padding:1px 6px;color:#9fd2ff;
      font-family:Consolas,ui-monospace,monospace;font-size:13.5px}}
pre{{background:#0b111d;border:1px solid var(--line);border-radius:12px;padding:14px 16px;overflow:auto}}
pre code{{background:none;border:none;padding:0;color:#cfe9dc;font-size:13.5px;line-height:1.6}}
blockquote{{margin:14px 0;padding:8px 14px;border-left:3px solid var(--acc);background:#131c2b;color:var(--mut);border-radius:0 8px 8px 0}}
table{{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;display:block;overflow-x:auto}}
th,td{{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}}
th{{background:#1a2437;color:#cfe4ff;white-space:nowrap}}
tr:nth-child(even) td{{background:#141c2b}}
hr{{border:none;border-top:1px solid var(--line);margin:28px 0}}
.top{{display:flex;align-items:center;gap:12px;margin-bottom:18px}}
.top a{{font-size:13.5px}}
.badge{{font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:2px 10px}}
</style>
</head>
<body><div class="wrap">
<div class="top"><a href="./">← 返回识别页</a><span class="badge">QRSuite v2 使用手册</span></div>
{body}
</div></body></html>
"""


def main():
    try:
        import markdown
    except ImportError:
        print('缺少依赖，请先执行: python -m pip install markdown', file=sys.stderr)
        return 1
    md = open(SRC, encoding='utf-8').read()
    html = markdown.markdown(md, extensions=['tables', 'fenced_code', 'toc', 'sane_lists'])
    # 文档间的相对 .md 链接在 GitHub 上能点，在 Pages 上会 404（文件不在 docs/ 里）——改写成仓库地址
    html = _rewrite_md_links(html)
    html = re.sub(r'<h([1-3])>(.*?)</h\1>', lambda m: f'<h{m.group(1)} id="{re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", "-", m.group(2)).strip("-").lower()}">{m.group(2)}</h{m.group(1)}>', html)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    open(DST, 'w', encoding='utf-8').write(TPL.format(body=html))
    print(f'已生成 {DST}  ({os.path.getsize(DST)//1024} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
