"""midorichart.com 메인(포트폴리오)에 새 작업을 넣고 빼는 스크립트.

이미지를 웹용 webp(큰 것 1600px + 썸네일 720px)로 줄여 assets/portfolio/ 에 넣고,
assets/portfolio/works.js 의 배경(BACKGROUNDS) · 그 밖의 작업(ETC) 목록을 날짜 순으로 고친다.
필요한 것: Python 3 + Pillow (pip install pillow)

허브 폴더에서 실행:

  # 목록 보기
  python scripts/portfolio.py list

  # 새 배경: BOOTH 상품 번호만 있으면 이름 · 출시일 · 상품 이미지를 가져온다
  python scripts/portfolio.py add-bg --booth 8927967 --key salt2 ^
      --desc "한국어 소개" --desc-ja "日本語の紹介" --desc-en "English intro" ^
      --post 2105931502844588543 --photo 작업샷1.png --photo https://pbs.twimg.com/media/XXXX?format=jpg

  # 그 밖의 작업 (소품 · 셰이더 · 세팅): 사진 파일이나 이미지 주소
  python scripts/portfolio.py add-etc --title "네온사인" --date 2026-11-20 --photo neon.png ^
      --post 1957938638622454124 --desc "X 에 쓴 글" --title-en "Neon sign" --desc-en "..."

  # 빼기 (배경은 key, 그 밖의 작업은 id)
  python scripts/portfolio.py remove salt2

옵션을 빼먹은 번역(--desc-ja 등)은 한국어가 그대로 나온다. 나중에 works.js 를 직접 고쳐도 된다.
X 사진 주소는 X 에서 이미지를 열고 「이미지 주소 복사」로 얻을 수 있다 (pbs.twimg.com/media/...).
"""
import argparse
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "portfolio"
WORKS = OUT / "works.js"
UA = {"User-Agent": "Mozilla/5.0"}


# ---------- works.js 읽기 · 쓰기 ----------
def load():
    s = WORKS.read_text(encoding="utf-8")
    head, rest = s.split("window.BACKGROUNDS = ", 1)
    bgs, etc = rest.split(";\nwindow.ETC = ", 1)
    return head, json.loads(bgs), json.loads(etc.rstrip().rstrip(";"))


def save(head, bgs, etc):
    bgs.sort(key=lambda g: g["date"], reverse=True)
    etc.sort(key=lambda w: w["date"], reverse=True)
    WORKS.write_text(head + "window.BACKGROUNDS = " + json.dumps(bgs, ensure_ascii=False, indent=1)
                     + ";\nwindow.ETC = " + json.dumps(etc, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")


# ---------- 이미지 ----------
def fetch(url, referer=None):
    h = dict(UA)
    if referer:
        h["Referer"] = referer
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60) as r:
        return r.read()


def open_image(src, referer=None):
    if re.match(r"https?://", src):
        if "pbs.twimg.com/media/" in src and "name=" not in src:
            src += ("&" if "?" in src else "?") + "name=large"
        return Image.open(io.BytesIO(fetch(src, referer)))
    return Image.open(src)


def save_image(im, name, video=False):
    """큰 이미지 + 썸네일을 webp 로. works.js 에 넣을 항목을 돌려준다."""
    (OUT / "t").mkdir(parents=True, exist_ok=True)
    im = im.convert("RGB")
    full = im.copy(); full.thumbnail((1600, 1600)); full.save(OUT / f"{name}.webp", "WEBP", quality=82, method=6)
    th = im.copy(); th.thumbnail((720, 720)); th.save(OUT / "t" / f"{name}.webp", "WEBP", quality=76, method=6)
    item = {"src": name, "w": full.size[0], "h": full.size[1]}
    if video:
        item["video"] = True
    return item


def i18n(args, *fields):
    out = {}
    for lang in ("ja", "en"):
        d = {f: getattr(args, f"{f}_{lang}") for f in fields if getattr(args, f"{f}_{lang}", None)}
        if d:
            out[lang] = d
    return out


# ---------- 명령 ----------
def cmd_list(_):
    _, bgs, etc = load()
    print("[배경]")
    for g in bgs:
        print(f"  {g['date']}  {g['key']:<12} {g['name']}  (사진 {len(g['imgs'])})")
    print("[그 밖의 작업]")
    for w in etc:
        print(f"  {w['date']}  {w['id']:<20} {w['title']}  (사진 {len(w['imgs'])})")


def cmd_add_bg(a):
    head, bgs, etc = load()
    info = {}
    if a.booth:
        info = json.loads(fetch(f"https://booth.pm/ja/items/{a.booth}.json"))
    key = a.key or f"bg{int(time.time())}"
    if any(g["key"] == key for g in bgs):
        sys.exit(f"이미 있는 key 예요: {key}  (remove 로 먼저 지우거나 다른 --key 를 주세요)")
    name = a.name or re.sub(r"^\[[^\]]*\]\s*", "", info.get("name", key))  # [Standard/PRO] 같은 앞머리 떼기
    date = a.date or (info.get("published_at", "")[:10]) or time.strftime("%Y-%m-%d")
    imgs = []
    if info:
        urls = [im["original"] for im in info.get("images", [])]
        pick = [int(x) for x in a.booth_images.split(",")] if a.booth_images else list(range(min(6, len(urls))))
        for n in pick:
            print("BOOTH 이미지", n)
            imgs.append(save_image(open_image(urls[n], "https://booth.pm/"), f"b-{key}-{n}"))
    for n, src in enumerate(a.photo or []):
        print("사진", src)
        item = save_image(open_image(src), f"x-{key}-p{n + 1}")
        if a.post:
            item["post"] = a.post
        imgs.append(item)
    if not imgs:
        sys.exit("사진이 하나도 없어요. --booth 나 --photo 를 주세요.")
    g = {"key": key, "name": name, "sub": a.sub or "Standard / PRO", "date": date,
         "booth": f"https://raming.booth.pm/items/{a.booth}" if a.booth else None,
         "imgs": imgs, "desc": a.desc or "", "qpost": a.post, "qdate": date}
    tr = i18n(a, "desc", "sub")
    if tr:
        g["i18n"] = tr
    bgs.append(g)
    save(head, bgs, etc)
    print(f"추가했어요: {name} ({date}) · 사진 {len(imgs)}장")


def cmd_add_etc(a):
    head, bgs, etc = load()
    wid = a.post or f"w{int(time.time())}"
    if any(w["id"] == wid for w in etc):
        sys.exit(f"이미 있는 작업이에요: {wid}")
    imgs = [save_image(open_image(src), f"x-{wid}-{n + 1}") for n, src in enumerate(a.photo or [])]
    if a.video_poster:
        imgs.append(save_image(open_image(a.video_poster), f"x-{wid}-v", video=True))
    if not imgs:
        sys.exit("사진이 하나도 없어요. --photo 나 --video-poster 를 주세요.")
    for it in imgs:
        if a.post:
            it["post"] = a.post
    w = {"id": wid, "date": a.date or time.strftime("%Y-%m-%d"), "title": a.title, "desc": a.desc or "", "imgs": imgs}
    tr = i18n(a, "title", "desc")
    if tr:
        w["i18n"] = tr
    etc.append(w)
    save(head, bgs, etc)
    print(f"추가했어요: {a.title} ({w['date']}) · 사진 {len(imgs)}장")


def cmd_remove(a):
    head, bgs, etc = load()
    gone = [x for x in bgs if x["key"] == a.target] + [x for x in etc if x["id"] == a.target]
    if not gone:
        sys.exit(f"못 찾았어요: {a.target}")
    bgs = [x for x in bgs if x["key"] != a.target]
    etc = [x for x in etc if x["id"] != a.target]
    used = {i["src"] for x in bgs + etc for i in x["imgs"]}
    for x in gone:
        for i in x["imgs"]:
            if i["src"] not in used:
                (OUT / f"{i['src']}.webp").unlink(missing_ok=True)
                (OUT / "t" / f"{i['src']}.webp").unlink(missing_ok=True)
    save(head, bgs, etc)
    print("뺐어요:", a.target)


def main():
    p = argparse.ArgumentParser(description="midorichart 포트폴리오 작업 추가 · 삭제")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="목록 보기").set_defaults(fn=cmd_list)

    b = sub.add_parser("add-bg", help="배경 추가")
    b.add_argument("--booth", help="BOOTH 상품 번호 (이름 · 출시일 · 상품 이미지를 가져옴)")
    b.add_argument("--booth-images", help="가져올 BOOTH 이미지 번호, 예: 0,1,2 (기본: 앞에서 6장)")
    b.add_argument("--key", help="영문 짧은 이름 (주소 · 파일 이름에 쓰임)")
    b.add_argument("--name", help="배경 이름 (기본: BOOTH 상품명)")
    b.add_argument("--sub", help="부제, 예: Standard / PRO · Day / Night")
    b.add_argument("--date", help="YYYY-MM-DD (기본: BOOTH 공개일)")
    b.add_argument("--photo", action="append", help="작업하면서 찍은 사진 (파일 경로나 주소, 여러 번 가능)")
    b.add_argument("--post", help="X 게시물 번호 (작업 글 링크)")
    for f in ("desc", "desc_ja", "desc_en", "sub_ja", "sub_en"):
        b.add_argument("--" + f.replace("_", "-"), dest=f)
    b.set_defaults(fn=cmd_add_bg)

    e = sub.add_parser("add-etc", help="그 밖의 작업 추가 (소품 · 셰이더 · 세팅)")
    e.add_argument("--title", required=True)
    e.add_argument("--date", help="YYYY-MM-DD (기본: 오늘)")
    e.add_argument("--photo", action="append", help="사진 (파일 경로나 주소, 여러 번 가능)")
    e.add_argument("--video-poster", help="영상 표지 이미지 (누르면 X 에서 영상 보기)")
    e.add_argument("--post", help="X 게시물 번호")
    for f in ("desc", "title_ja", "title_en", "desc_ja", "desc_en"):
        e.add_argument("--" + f.replace("_", "-"), dest=f)
    e.set_defaults(fn=cmd_add_etc)

    r = sub.add_parser("remove", help="빼기 (배경 key 또는 작업 id)")
    r.add_argument("target")
    r.set_defaults(fn=cmd_remove)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
