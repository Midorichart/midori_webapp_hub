"""index.html(한국어 원본)로 언어별 페이지 ko/index.html · ja/index.html · en/index.html 을 만든다.

- 검색 결과에 언어별 제목 · 설명이 나오도록 <title> · description · og 문구 · canonical 을 언어마다 바꾼다.
- midorichart.com 으로 들어오면 index.html 의 lang-redirect 스크립트가 고른 언어 → 브라우저 언어 순으로 이 페이지들로 보낸다.
  만든 페이지에서는 그 스크립트를 빼고, 대신 window.PAGE_LANG 으로 언어를 정해 둔다.
- 화면 고정 문구(data-t)는 assets/portfolio.js 의 UI 문구로 미리 바꿔 둔다 (자바스크립트를 안 돌리는 검색 로봇용).
- 커밋할 때 자동으로 돈다 (.git/hooks/pre-commit). 직접 돌리려면 허브 폴더에서: python scripts/langs.py
  index.html 만 고치면 되고, ko/ · ja/ · en/ 폴더의 파일은 직접 고치지 않는다 (덮어써짐).
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://midorichart.com/"
TITLE = "MIDORI CHART (緑チャート)"
DESC = {
    "ko": "Studio Raming 소속 | 배경 · 소품 모델러 MIDORI CHART(緑チャート) 작업 포트폴리오",
    "ja": "Studio Raming所属 | 背景・小物モデラー MIDORI CHART(緑チャート)の作品ポートフォリオ",
    "en": "Studio Raming member | Background & prop modeler MIDORI CHART (緑チャート) — portfolio of works",
}
LOCALE = {"ko": "ko_KR", "ja": "ja_JP", "en": "en_US"}


def ui_strings():
    """portfolio.js 의 UI 사전에서 글자 그대로인 문구만 뽑는다 (함수로 된 것은 건너뜀)."""
    js = (ROOT / "assets" / "portfolio.js").read_bytes().decode("utf-8")
    out = {}
    for lang in DESC:
        block = re.search(rf"\n  {lang}: \{{(.*?)\n  \}},", js, re.S).group(1)
        out[lang] = dict(re.findall(r"(\w+): '([^']*)'", block))
    return out


def meta(lang):
    url = f"{SITE}{lang}/"
    d = html.escape(DESC[lang], quote=True)
    return "\n".join([
        f"<title>{html.escape(TITLE)}</title>",
        f'<meta name="description" content="{d}">',
        f'<meta property="og:title" content="{html.escape(TITLE, quote=True)}">',
        f'<meta property="og:description" content="{d}">',
        f'<meta property="og:locale" content="{LOCALE[lang]}">',
        f'<meta property="og:url" content="{url}">',
        f'<link rel="canonical" href="{url}">',
    ])


def build(src, lang, ui):
    nl = "\r\n" if "\r\n" in src else "\n"
    s = src.replace('<html lang="ko">', f'<html lang="{lang}">', 1)
    s = re.sub(r"<!-- lang-meta -->.*?<!-- /lang-meta -->", lambda m: meta(lang).replace("\n", nl), s, count=1, flags=re.S)
    s = re.sub(r"<!-- lang-redirect.*?<!-- /lang-redirect -->",
               f"<script>window.PAGE_LANG = '{lang}';</script>", s, count=1, flags=re.S)
    s = re.sub(r"<!-- 언어별 페이지.*?-->" + re.escape(nl), "", s, count=1, flags=re.S)
    s = s.replace("<!DOCTYPE html>" + nl, "<!DOCTYPE html>" + nl + f"<!-- 자동 생성: 고치지 말고 /index.html 을 고친 뒤 python scripts/langs.py (커밋할 때 자동) -->{nl}", 1)
    # 한 단계 아래 폴더라 같은 파일을 가리키도록 경로를 올린다
    s = re.sub(r'((?:src|href)=")(assets/)', r"\1../\2", s)
    # 고정 문구
    for key, text in ui[lang].items():
        s = re.sub(rf'(data-t="{key}"[^>]*>)[^<]*(<)', lambda m: m.group(1) + html.escape(text, quote=False) + m.group(2), s)
        s = re.sub(rf'(data-ph="{key}" placeholder=")[^"]*(")', lambda m: m.group(1) + html.escape(text, quote=True) + m.group(2), s)
    return s


def main():
    sys.stdout.reconfigure(newline=chr(10))
    src = (ROOT / "index.html").read_bytes().decode("utf-8")
    ui = ui_strings()
    for lang in DESC:
        out = ROOT / lang / "index.html"
        new = build(src, lang, ui)
        if not out.exists() or out.read_bytes().decode("utf-8") != new:
            out.parent.mkdir(exist_ok=True)
            out.write_bytes(new.encode("utf-8"))
            print(out.relative_to(ROOT).as_posix())
    return 0


if __name__ == "__main__":
    sys.exit(main())
