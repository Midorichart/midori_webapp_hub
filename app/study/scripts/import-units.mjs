// Obsidian 의 EJU 진도 체크리스트(md)를 science/data/units-<과목>.json 단원 트리로 바꾼다.
// 체크리스트를 고친 뒤 허브 폴더에서 `node app/study/scripts/import-units.mjs` 로 다시 만들면 된다.
//   node app/study/scripts/import-units.mjs [체크리스트 폴더]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || 'D:/midori/Obsidian_Vault/일본유학/EJU시험 범위, 진도';
const OUT = path.join(import.meta.dirname, '..', 'science', 'data');
const FILES = { math: '수학 진도 체크리스트.md', physics: '물리 진도 체크리스트.md', chemistry: '화학 진도 체크리스트.md' };

// 결과: [{ t: 제목, c: [하위 단원] }]
function parse(md) {
  const root = { c: [] };
  const stack = [{ depth: 0, node: root }]; // depth: 제목 #=1, ##=2 … / 목록은 마지막 제목 깊이 + 들여쓰기
  let headingDepth = 0;
  const push = (depth, t) => {
    while (stack.at(-1).depth >= depth) stack.pop();
    const node = { t, c: [] };
    stack.at(-1).node.c.push(node);
    stack.push({ depth, node });
  };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) {
      if (/체크리스트$/.test(h[2])) continue; // 문서 제목
      headingDepth = h[1].length;
      push(headingDepth, h[2]);
      continue;
    }
    const li = line.match(/^(\s*)- \[[ xX]\]\s+(.+?)\s*$/);
    if (li) push(headingDepth + 1 + Math.floor(li[1].replace(/\t/g, '  ').length / 2), li[2]);
  }
  // 빈 c 는 지워서 파일을 작게
  const clean = (n) => (n.c.length ? { t: n.t, c: n.c.map(clean) } : { t: n.t });
  return root.c.map(clean);
}

for (const [subject, file] of Object.entries(FILES)) {
  const tree = parse(readFileSync(path.join(SRC, file), 'utf8'));
  writeFileSync(path.join(OUT, `units-${subject}.json`), JSON.stringify(tree, null, 1) + '\n');
  const count = (list) => list.reduce((n, x) => n + 1 + count(x.c || []), 0);
  console.log(`${subject}: ${count(tree)}개 단원`);
}
