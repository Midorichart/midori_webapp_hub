"""CSS · JS 주소 끝에 ?v=<내용 해시> 를 붙여서, 파일이 바뀌면 브라우저가 캐시 대신 새 파일을 받게 한다.

GitHub Pages 는 파일을 10분 동안 캐시해도 된다고 알려 주기 때문에, 그냥 두면 push 한 뒤에도
한동안 예전 CSS · JS 가 보일 수 있다. 주소가 바뀌면 새 파일로 취급되므로 새로고침 한 번이면 반영된다.

- HTML 의 <script src> · <link href>, JS 의 import, CSS 의 @import 를 고친다 (외부 주소는 그대로).
- 버전은 파일 내용 + 그 파일이 불러오는 파일들의 버전으로 정한다. 내용이 그대로면 버전도 그대로라
  여러 번 돌려도 바뀌는 게 없다.
- 커밋할 때 자동으로 돈다 (.git/hooks/pre-commit). 직접 돌리려면 허브 폴더에서: python scripts/stamp.py
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VER = re.compile(r"\?v=[0-9a-f]*")

# (패턴, 주소가 들어 있는 그룹 번호). 주소 뒤의 ?v=... 는 패턴에 함께 잡아서 갈아 끼운다.
PATTERNS = {
    ".html": [re.compile(r'''(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?#]+\.(?:js|css))((?:\?v=[0-9a-f]*)?)(")''')],
    ".js": [
        re.compile(r'''(\bfrom\s*['"])(\.{1,2}/[^'"?#]+\.js)((?:\?v=[0-9a-f]*)?)(['"])'''),
        re.compile(r'''(\bimport\s*\(?\s*['"])(\.{1,2}/[^'"?#]+\.js)((?:\?v=[0-9a-f]*)?)(['"])'''),
    ],
    ".css": [re.compile(r'''(@import\s+url\(\s*['"]?)([^'")?#]+\.css)((?:\?v=[0-9a-f]*)?)(['"]?\s*\))''')],
}


def files():
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    return [ROOT / f for f in out if Path(f).suffix in PATTERNS]


def resolve(src, ref):
    if re.match(r"^(?:[a-z]+:)?//", ref):
        return None  # 외부 주소
    p = (ROOT / ref.lstrip("/")) if ref.startswith("/") else (src.parent / ref)
    p = p.resolve()
    return p if p.is_file() and ROOT in p.parents else None


def refs(path, text):
    for pat in PATTERNS[path.suffix]:
        for m in pat.finditer(text):
            dep = resolve(path, m.group(2))
            if dep:
                yield dep


memo = {}


def version(path, stack=()):
    if path in memo:
        return memo[path]
    text = path.read_bytes().decode("utf-8")
    h = hashlib.sha1(VER.sub("", text).encode("utf-8"))
    if path.suffix in PATTERNS and path not in stack:
        for dep in sorted(set(refs(path, text))):
            if dep not in stack:
                h.update(version(dep, stack + (path,)).encode())
    memo[path] = h.hexdigest()[:8]
    return memo[path]


def stamp(path):
    text = path.read_bytes().decode("utf-8")
    new = text
    for pat in PATTERNS[path.suffix]:
        def sub(m):
            dep = resolve(path, m.group(2))
            if not dep:
                return m.group(0)
            return f"{m.group(1)}{m.group(2)}?v={version(dep)}{m.group(4)}"
        new = pat.sub(sub, new)
    if new != text:
        path.write_bytes(new.encode("utf-8"))  # 줄바꿈(CRLF/LF)은 그대로
        return True
    return False


def main():
    sys.stdout.reconfigure(newline=chr(10))  # 훅이 파일 이름을 읽을 때 끝에 CR 이 붙지 않게
    changed = [p for p in files() if p.exists() and stamp(p)]  # 지웠지만 아직 커밋 안 한 파일은 건너뜀
    for p in changed:
        print(p.relative_to(ROOT).as_posix())
    return 0


if __name__ == "__main__":
    sys.exit(main())
