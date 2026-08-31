const fs = require('fs');

const W = 1284;
const H = 2778;
const logo = fs.readFileSync('public/stockly-login-logo.png').toString('base64');
const font = 'Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif';
const logoLight = `<image href="data:image/png;base64,${logo}" x="92" y="112" width="430" height="176" preserveAspectRatio="xMinYMid meet"/>`;
const logoDark = `<rect x="72" y="92" width="470" height="216" rx="108" fill="#ffffff"/><image href="data:image/png;base64,${logo}" x="104" y="112" width="410" height="176" preserveAspectRatio="xMinYMid meet"/>`;

const commonDefs = `
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c4cff"/>
      <stop offset="0.54" stop-color="#695cff"/>
      <stop offset="1" stop-color="#a184ff"/>
    </linearGradient>
    <linearGradient id="cyan" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4fddff"/>
      <stop offset="1" stop-color="#6d5cff"/>
    </linearGradient>
    <linearGradient id="darkBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111946"/>
      <stop offset="0.55" stop-color="#292272"/>
      <stop offset="1" stop-color="#5142aa"/>
    </linearGradient>
    <linearGradient id="softBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8f8ff"/>
      <stop offset="0.6" stop-color="#eeecff"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#c7c0ff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#c7c0ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-35%" y="-35%" width="170%" height="190%">
      <feDropShadow dx="0" dy="28" stdDeviation="30" flood-color="#4a43b8" flood-opacity="0.22"/>
    </filter>
    <filter id="softShadow" x="-35%" y="-35%" width="170%" height="190%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#5a4df0" flood-opacity="0.18"/>
    </filter>
  </defs>`;

const headline = (fill = '#0b143c', accent = 'url(#brand)', x = 92, y = 900, anchor = 'start') => `
  <text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="116" font-weight="800" fill="${fill}" letter-spacing="-5.5">재고 확인부터</text>
  <text x="${x}" y="${y + 148}" text-anchor="${anchor}" font-family="${font}" font-size="116" font-weight="800" fill="${fill}" letter-spacing="-5.5">발주까지,</text>
  <text x="${x}" y="${y + 296}" text-anchor="${anchor}" font-family="${font}" font-size="116" font-weight="800" fill="${accent}" letter-spacing="-5.5">한곳에서</text>`;

const variant1 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${commonDefs}
  <rect width="${W}" height="${H}" fill="url(#softBg)"/>
  <circle cx="1120" cy="280" r="450" fill="url(#glow)" opacity="0.75"/>
  <circle cx="80" cy="2540" r="520" fill="#e7e5ff" opacity="0.68"/>
  <circle cx="1210" cy="2290" r="300" fill="#f1efff"/>
  ${logoLight}
  <text x="96" y="690" font-family="${font}" font-size="36" font-weight="700" fill="#5656f6" letter-spacing="-1.2">매장 재고 관리 솔루션</text>
  ${headline()}
  <text x="98" y="1340" font-family="${font}" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">매장 재고와 발주 업무를</text>
  <text x="98" y="1404" font-family="${font}" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">빠르게 관리하세요.</text>
  <g transform="translate(78 1610)" filter="url(#softShadow)">
    <rect width="1128" height="630" rx="150" fill="#ffffff" opacity="0.8"/>
    <path d="M110 396C260 288 420 300 568 382S850 516 1022 300" fill="none" stroke="#d5d1ff" stroke-width="34" stroke-linecap="round" opacity="0.65"/>
    <g transform="translate(150 108) rotate(-8 420 170)">
      <rect x="14" y="132" width="830" height="230" rx="78" fill="#6f65db" opacity="0.23"/>
      <rect y="72" width="830" height="230" rx="78" fill="#b9b3ff" opacity="0.75"/>
      <rect y="12" width="830" height="230" rx="78" fill="url(#brand)" filter="url(#shadow)"/>
      <rect x="72" y="84" width="44" height="86" rx="22" fill="#fff" opacity="0.95"/>
      <rect x="166" y="84" width="44" height="86" rx="22" fill="#fff" opacity="0.95"/>
    </g>
    <text x="564" y="542" text-anchor="middle" font-family="${font}" font-size="31" font-weight="700" fill="#5656f6">매장 운영을 한곳에서</text>
  </g>
  <g transform="translate(94 2420)"><rect width="284" height="66" rx="33" fill="#e1dfff"/><text x="142" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">재고 현황</text><rect x="308" width="284" height="66" rx="33" fill="#e1dfff"/><text x="450" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">발주 관리</text><rect x="616" width="284" height="66" rx="33" fill="#e1dfff"/><text x="758" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">작업 기록</text></g>
  <text x="96" y="2670" font-family="${font}" font-size="30" font-weight="600" fill="#7b82a4">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

const variant2 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${commonDefs}
  <rect width="${W}" height="${H}" fill="url(#darkBg)"/>
  <circle cx="1040" cy="340" r="520" fill="#7569ff" opacity="0.22"/>
  <circle cx="130" cy="2440" r="450" fill="#4cddff" opacity="0.12"/>
  ${logoDark}
  <text x="96" y="690" font-family="${font}" font-size="36" font-weight="700" fill="#bcb6ff" letter-spacing="-1.2">매장 재고 관리 솔루션</text>
  ${headline('#ffffff', '#bcb6ff')}
  <text x="98" y="1340" font-family="${font}" font-size="42" font-weight="500" fill="#e8e6ff" letter-spacing="-1.5">재고와 발주를 더 빠르고</text>
  <text x="98" y="1404" font-family="${font}" font-size="42" font-weight="500" fill="#e8e6ff" letter-spacing="-1.5">정확하게 관리하세요.</text>
  <g transform="translate(72 1600)" filter="url(#shadow)">
    <rect width="1140" height="670" rx="160" fill="#ffffff" opacity="0.08" stroke="#ffffff" stroke-width="2"/>
    <g transform="translate(130 150) rotate(-8 430 170)">
      <rect x="18" y="132" width="860" height="242" rx="84" fill="#4b43a8" opacity="0.66"/>
      <rect y="72" width="860" height="242" rx="84" fill="#8779ff" opacity="0.68"/>
      <rect y="12" width="860" height="242" rx="84" fill="url(#cyan)"/>
      <rect x="76" y="88" width="48" height="94" rx="24" fill="#fff" opacity="0.92"/>
      <rect x="180" y="88" width="48" height="94" rx="24" fill="#fff" opacity="0.92"/>
      <circle cx="742" cy="136" r="29" fill="#fff" opacity="0.42"/>
    </g>
    <text x="570" y="572" text-anchor="middle" font-family="${font}" font-size="32" font-weight="700" fill="#d7d2ff">STOCKLY · SMART STORE OPERATIONS</text>
  </g>
  <g transform="translate(94 2420)"><rect width="284" height="66" rx="33" fill="#ffffff" opacity="0.16"/><text x="142" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#fff">재고 현황</text><rect x="308" width="284" height="66" rx="33" fill="#ffffff" opacity="0.16"/><text x="450" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#fff">발주 관리</text><rect x="616" width="284" height="66" rx="33" fill="#ffffff" opacity="0.16"/><text x="758" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#fff">작업 기록</text></g>
  <text x="96" y="2670" font-family="${font}" font-size="30" font-weight="600" fill="#c5c2ed">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

const variant3 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${commonDefs}
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <circle cx="642" cy="400" r="430" fill="#f0efff"/>
  <circle cx="642" cy="400" r="304" fill="#e2deff" opacity="0.68"/>
  <image href="data:image/png;base64,${logo}" x="318" y="202" width="648" height="266" preserveAspectRatio="xMidYMid meet"/>
  <text x="642" y="690" text-anchor="middle" font-family="${font}" font-size="35" font-weight="700" fill="#5656f6" letter-spacing="-1.2">매장 운영의 새로운 기준</text>
  ${headline('#0b143c', 'url(#brand)', 642, 902, 'middle')}
  <text x="642" y="1372" text-anchor="middle" font-family="${font}" font-size="40" font-weight="500" fill="#59627c" letter-spacing="-1.4">재고 확인부터 발주까지</text>
  <text x="642" y="1432" text-anchor="middle" font-family="${font}" font-size="40" font-weight="500" fill="#59627c" letter-spacing="-1.4">매장 업무를 한곳에서 관리하세요.</text>
  <g transform="translate(102 1640)" filter="url(#softShadow)">
    <rect width="1080" height="626" rx="164" fill="url(#brand)"/>
    <circle cx="180" cy="154" r="210" fill="#ffffff" opacity="0.1"/>
    <circle cx="908" cy="500" r="310" fill="#43ddff" opacity="0.12"/>
    <g transform="translate(170 114) rotate(8 370 180)">
      <rect x="14" y="140" width="740" height="214" rx="76" fill="#2e2a86" opacity="0.42"/>
      <rect y="80" width="740" height="214" rx="76" fill="#b4aaff" opacity="0.65"/>
      <rect y="20" width="740" height="214" rx="76" fill="#ffffff" opacity="0.96"/>
      <rect x="76" y="88" width="42" height="84" rx="21" fill="#6960ff"/>
      <rect x="166" y="88" width="42" height="84" rx="21" fill="#6960ff"/>
    </g>
    <text x="540" y="536" text-anchor="middle" font-family="${font}" font-size="31" font-weight="700" fill="#ffffff">STOCKLY</text>
  </g>
  <g transform="translate(120 2424)"><rect width="320" height="66" rx="33" fill="#eceaff"/><text x="160" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">재고 확인</text><rect x="352" width="320" height="66" rx="33" fill="#eceaff"/><text x="512" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">발주 관리</text><rect x="704" width="320" height="66" rx="33" fill="#eceaff"/><text x="864" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">간편 기록</text></g>
  <text x="642" y="2670" text-anchor="middle" font-family="${font}" font-size="30" font-weight="600" fill="#7b82a4">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

const variant4 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${commonDefs}
  <rect width="${W}" height="${H}" fill="#f8f8ff"/>
  <path d="M804 -80H1390V1840C1240 1770 1080 1690 892 1510C718 1340 650 1090 730 810C790 600 850 390 804 -80Z" fill="url(#brand)"/>
  <path d="M1000 70C1130 240 1160 460 1090 670C1020 880 1000 1060 1120 1210" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.24"/>
  <circle cx="1060" cy="1850" r="420" fill="#dfdcff" opacity="0.62"/>
  ${logoLight}
  <text x="96" y="690" font-family="${font}" font-size="36" font-weight="700" fill="#5656f6" letter-spacing="-1.2">더 단순한 매장 운영</text>
  <text x="92" y="900" font-family="${font}" font-size="112" font-weight="800" fill="#0b143c" letter-spacing="-5.2">재고 확인부터</text>
  <text x="92" y="1044" font-family="${font}" font-size="112" font-weight="800" fill="#0b143c" letter-spacing="-5.2">발주까지,</text>
  <text x="92" y="1188" font-family="${font}" font-size="112" font-weight="800" fill="#5656f6" letter-spacing="-5.2">한곳에서</text>
  <text x="98" y="1340" font-family="${font}" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">필요한 업무만 빠르게,</text>
  <text x="98" y="1404" font-family="${font}" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">Stockly로 시작하세요.</text>
  <g transform="translate(96 1630)" filter="url(#shadow)">
    <rect width="1060" height="618" rx="142" fill="#ffffff"/>
    <g transform="translate(142 126) rotate(-12 380 176)">
      <rect x="12" y="134" width="760" height="224" rx="80" fill="#6b61d9" opacity="0.28"/>
      <rect y="76" width="760" height="224" rx="80" fill="#c3bdff" opacity="0.84"/>
      <rect y="18" width="760" height="224" rx="80" fill="url(#brand)"/>
      <rect x="68" y="88" width="44" height="86" rx="22" fill="#ffffff" opacity="0.95"/>
      <rect x="162" y="88" width="44" height="86" rx="22" fill="#ffffff" opacity="0.95"/>
    </g>
    <text x="530" y="534" text-anchor="middle" font-family="${font}" font-size="31" font-weight="700" fill="#5656f6">재고 · 발주 · 기록</text>
  </g>
  <g transform="translate(96 2416)"><rect width="296" height="66" rx="33" fill="#e1dfff"/><text x="148" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">재고 현황</text><rect x="320" width="296" height="66" rx="33" fill="#e1dfff"/><text x="468" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">발주 관리</text><rect x="640" width="296" height="66" rx="33" fill="#e1dfff"/><text x="788" y="43" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="#5656f6">작업 기록</text></g>
  <text x="96" y="2670" font-family="${font}" font-size="30" font-weight="600" fill="#7b82a4">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

const variants = [variant1, variant2, variant3, variant4];
variants.forEach((svg, index) => {
  const n = index + 1;
  fs.writeFileSync(`tmp/appstore/stockly-appstore-main-brand-v${n}-1284x2778.svg`, svg);
  fs.writeFileSync(`tmp/appstore/stockly-appstore-main-brand-v${n}-editable-1284x2778.svg`, svg);
});
