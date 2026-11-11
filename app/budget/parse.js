// 가계부: 카드사 이용내역 엑셀(표 한 장)을 읽어서 가계부 줄로 바꾸는 부분.
// 화면(index.html)과 나중에 만들 PC 프로그램이 같이 쓸 수 있게 따로 둔다.
// 입력: 표 한 장을 2차원 배열로 (rows[행][칸]). 값은 숫자 · 글자 · 빈칸.
(function (root) {
  'use strict';

  var CARDS = {
    hyundai: '현대카드',
    shinhan: '신한카드',
    samsung: '삼성카드',
    manual: '직접 입력',
  };

  // 칸 이름 → 어떤 항목인지. 앞에 있는 패턴일수록 더 확실함. skip 에 걸리면 그 항목이 아님
  var FIELDS = [
    { key: 'date', label: '이용일', need: true,
      pats: [/^(이용|승인|거래|매출|사용)(일자|일|일시|날짜)$/, /(이용|승인|거래|매출|사용)(일|날짜)/, /일자|날짜|일시/],
      skip: /결제|청구|취소일|입금|출금/ },
    { key: 'amount', label: '이용금액', need: true,
      pats: [/^(이용|승인|매출|사용|거래)금액(\(원\))?$/, /(이용|승인|매출|사용|거래)금액|원화/, /금액/],
      skip: /현지|외화|달러|usd|\$|수수료|이자|잔액|포인트|할인|적립|누적|결제예정|회차|월납/ },
    { key: 'merchant', label: '가맹점명', need: true,
      pats: [/^(이용)?가맹점(명)?$/, /가맹점|이용처|사용처|이용하신곳|상호/, /내용|적요/],
      skip: /번호|주소|업종|전화|사업자|국가|도시/ },
    { key: 'installment', label: '할부개월',
      pats: [/^할부(개월|기간|개월수)?$/, /할부/, /이용구분|결제방법|결제구분|거래구분|매출구분/],
      skip: /잔액|이자|수수료|금액|원금|남은/ },
    { key: 'approval', label: '승인번호', pats: [/승인번호/] },
    { key: 'cardno', label: '카드(끝자리)',
      pats: [/카드번호|이용카드|카드끝자리/, /카드명|카드구분|카드종류|카드/], skip: /카드사/ },
    { key: 'cancel', label: '취소 여부',
      pats: [/취소(여부|구분)|승인(구분|상태)|매출상태/, /상태|취소/], skip: /취소일|금액/ },
    { key: 'overseas', label: '국내/해외',
      pats: [/국내외|국내\/해외|해외(여부|구분)?$/, /해외/], skip: /금액|수수료/ },
    { key: 'currency', label: '통화', pats: [/^(현지)?통화(코드)?$|결제통화/, /통화/] },
  ];

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
  }

  // 칸 이름 하나가 어떤 항목에 얼마나 잘 맞는지 (0 = 가장 확실, Infinity = 아님)
  function rank(field, header) {
    var h = norm(header);
    if (!h || h.length > 30) return Infinity;
    if (field.skip && field.skip.test(h)) return Infinity;
    for (var i = 0; i < field.pats.length; i++) if (field.pats[i].test(h)) return i;
    return Infinity;
  }

  // 칸 이름 줄 하나로 항목 → 칸 번호 짝 짓기
  function autoMap(headers) {
    var map = {};
    var used = {};
    FIELDS.forEach(function (f) {
      var best = -1;
      var bestRank = Infinity;
      headers.forEach(function (h, i) {
        if (used[i]) return;
        var r = rank(f, h);
        if (r < bestRank) { bestRank = r; best = i; }
      });
      if (best >= 0) { map[f.key] = best; used[best] = true; }
    });
    return map;
  }

  // 위쪽 40줄 중에서 칸 이름 줄 찾기 (이용일 · 금액 · 가맹점이 다 있는 줄 중 가장 많이 맞는 줄)
  function findHeader(rows) {
    var bestRow = -1;
    var bestScore = 0;
    for (var r = 0; r < Math.min(rows.length, 40); r++) {
      var row = rows[r] || [];
      var m = autoMap(row);
      if (m.date == null || m.amount == null || m.merchant == null) continue;
      var score = Object.keys(m).length;
      if (score > bestScore) { bestScore = score; bestRow = r; }
    }
    return bestRow;
  }

  // 카드사 알아내기: 파일 이름 → 칸 이름 줄 위쪽의 제목 글자
  function detectCard(fileName, rows, headerRow) {
    var text = String(fileName || '');
    for (var r = 0; r < Math.max(0, Math.min(headerRow, 15)); r++) text += ' ' + (rows[r] || []).join(' ');
    text = text.toLowerCase();
    if (/현대카드|hyundai|현대/.test(text)) return 'hyundai';
    if (/신한카드|shinhan|신한/.test(text)) return 'shinhan';
    if (/삼성카드|samsung|삼성/.test(text)) return 'samsung';
    return '';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function validYMD(y, m, d) {
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  // 날짜: 엑셀 날짜 숫자 · 2026.11.03 · 2026-11-03 · 26/11/03 · 20261103 · 2026년 11월 3일
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return validYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      if (v > 19000000 && v < 21001232) return parseDate(String(Math.floor(v)));
      if (v > 20000 && v < 80000) {
        var dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
        return validYMD(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      }
      return null;
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{2,4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (m) {
      var y = +m[1];
      if (y < 100) y += 2000;
      return validYMD(y, +m[2], +m[3]);
    }
    return null;
  }

  // 금액: 12,300 · -12,300 · (12,300) · 12,300원 · ₩12,300
  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v) : NaN;
    var s = String(v == null ? '' : v).trim();
    if (!s) return NaN;
    var neg = /^\(.*\)$/.test(s) || /^-|^△|^▲/.test(s);
    s = s.replace(/[^\d.]/g, '');
    if (!s) return NaN;
    var n = Math.round(parseFloat(s));
    return neg ? -n : n;
  }

  // 할부: 일시불 → 0, 3개월 · 03 · 할부(3) · 3 → 3, 1 → 0
  function parseInstallment(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || /일시불|일시|lump/i.test(s)) return 0;
    var m = s.match(/(\d{1,2})/);
    if (!m) return 0;
    var n = +m[1];
    return n >= 2 && n <= 60 ? n : 0;
  }

  function cardLast(v) {
    var m = String(v == null ? '' : v).match(/(\d{3,4})\D*$/);
    return m ? m[1] : null;
  }

  function cleanText(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  // 표 한 장 → 가계부 줄. map 을 안 주면 자동으로 짝 지음
  // 돌려주는 것: { headerRow, headers, map, card, rows: [...], skipped }
  function parseSheet(rows, opts) {
    opts = opts || {};
    var headerRow = opts.headerRow != null ? opts.headerRow : findHeader(rows);
    if (headerRow < 0) return { headerRow: -1, headers: [], map: {}, card: '', rows: [], skipped: 0 };
    var headers = (rows[headerRow] || []).map(cleanText);
    var map = opts.map || autoMap(headers);
    var card = opts.card || detectCard(opts.fileName, rows, headerRow) || '';
    var text = opts.text || rows; // 화면에 보이는 글자 그대로의 표 (승인번호 앞자리 0 등)
    var out = [];
    var skipped = 0;
    var seen = {};

    function cell(r, key, useText) {
      if (map[key] == null) return '';
      var src = useText ? text : rows;
      return (src[r] || [])[map[key]];
    }

    for (var r = headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      if (!row.some(function (c) { return c !== '' && c != null; })) continue;
      var date = parseDate(cell(r, 'date')) || parseDate(cell(r, 'date', true));
      var amount = parseAmount(cell(r, 'amount'));
      var merchant = cleanText(cell(r, 'merchant', true));
      if (!date || isNaN(amount) || /^(합계|소계|총계|총\s*합계|계)$/.test(merchant)) { skipped++; continue; }

      var cancelText = cleanText(cell(r, 'cancel', true));
      var isCancel = /취소|환불|반품/.test(cancelText) || amount < 0;
      if (isCancel) amount = -Math.abs(amount);

      var ovText = cleanText(cell(r, 'overseas', true));
      var cur = cleanText(cell(r, 'currency', true)).toUpperCase();
      var isOverseas = /해외|^y$|^o$/i.test(ovText) || (!!cur && !/^(KRW|원|￦|₩)$/.test(cur));

      var approval = cleanText(cell(r, 'approval', true)).replace(/\s/g, '') || null;
      var last4 = cardLast(cell(r, 'cardno', true));

      var base = [card || '?', last4 || '', approval || '', date, amount, isCancel ? 1 : 0,
        approval ? '' : merchant.replace(/\s/g, '')].join('|');
      seen[base] = (seen[base] || 0) + 1;

      out.push({
        date: date,
        card: card || 'other',
        card_last4: last4,
        merchant: merchant,
        amount: amount,
        installment: parseInstallment(cell(r, 'installment', true)),
        approval_no: approval,
        is_cancel: isCancel,
        is_overseas: isOverseas,
        // 같은 파일 안에서 똑같은 줄이 여러 개면(같은 날 같은 가게 같은 금액) 몇 번째인지 붙여서 구분
        dedup_key: base + '#' + seen[base],
      });
    }
    return { headerRow: headerRow, headers: headers, map: map, card: card, rows: out, skipped: skipped };
  }

  // 분류 규칙: 가맹점명에 keyword 가 들어 있으면(띄어쓰기 · 대소문자 무시) 그 분류. 여러 개 맞으면 긴 keyword 우선
  function categorize(merchant, rules) {
    var m = norm(merchant);
    if (!m) return '';
    var best = null;
    (rules || []).forEach(function (r) {
      var k = norm(r.keyword);
      if (k && m.indexOf(k) >= 0 && (!best || k.length > norm(best.keyword).length)) best = r;
    });
    return best ? best.category : '';
  }

  var DEFAULT_RULES = {
    '식비': ['배달의민족', '배민', '쿠팡이츠', '요기요', '맥도날드', '버거킹', '롯데리아', '맘스터치', '서브웨이', '김밥', '분식', '식당', '치킨', '피자', '국밥', '고기', '반점', '스시', '라멘', '도시락'],
    '카페·간식': ['스타벅스', '투썸', '이디야', '메가엠지씨', '메가커피', '빽다방', '컴포즈', '할리스', '폴바셋', '커피', '카페', '베이커리', '파리바게뜨', '뚜레쥬르', '배스킨', '설빙'],
    '편의점': ['GS25', '지에스25', '씨유', '세븐일레븐', '코리아세븐', '이마트24', '미니스톱'],
    '장보기': ['이마트', '홈플러스', '롯데마트', '코스트코', '하나로마트', '노브랜드', '마트', '컬리'],
    '교통': ['택시', '카카오T', '티머니', '코레일', 'KTX', 'SRT', '버스', '지하철', '주유', 'GS칼텍스', 'SK에너지', 'S-OIL', '오일뱅크', '주차', '하이패스', '쏘카', '따릉이'],
    '쇼핑': ['쿠팡', '11번가', 'G마켓', '지마켓', '옥션', '무신사', '올리브영', '다이소', 'SSG', '알리익스프레스', 'ALIEXPRESS', '테무', 'TEMU', '아마존', 'AMAZON'],
    '구독·통신': ['넷플릭스', 'NETFLIX', '유튜브', 'YOUTUBE', '스포티파이', 'SPOTIFY', 'APPLE.COM', '애플', 'GOOGLE', '구글', 'ADOBE', '어도비', 'ANTHROPIC', 'OPENAI', '디즈니', '티빙', '웨이브', '왓챠', 'SKT', 'LG유플러스', '알뜰폰'],
    '의료': ['병원', '의원', '약국', '치과', '한의원', '안과', '피부과'],
    '문화·여가': ['CGV', '메가박스', '롯데시네마', '영화', '교보문고', 'YES24', '예스24', '알라딘', '서점', 'STEAM', '스팀', '닌텐도', 'NINTENDO', '노래', 'PC방'],
    '생활·공과금': ['한국전력', '도시가스', '관리비', '수도', '보험', '세탁', '미용실', '헤어'],
  };

  root.BudgetParse = {
    CARDS: CARDS,
    FIELDS: FIELDS,
    DEFAULT_RULES: DEFAULT_RULES,
    autoMap: autoMap,
    findHeader: findHeader,
    detectCard: detectCard,
    parseDate: parseDate,
    parseAmount: parseAmount,
    parseInstallment: parseInstallment,
    parseSheet: parseSheet,
    categorize: categorize,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.BudgetParse;
})(typeof window !== 'undefined' ? window : globalThis);
