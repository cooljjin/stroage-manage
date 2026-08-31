const fs = require('fs');

const W = 1284;
const H = 2778;
const logo = fs.readFileSync('public/stockly-login-logo.png').toString('base64');
const font = 'Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif';
const logoImg = `<image href="data:image/png;base64,${logo}" x="92" y="112" width="430" height="176" preserveAspectRatio="xMinYMid meet"/>`;
const logoCenter = `<image href="data:image/png;base64,${logo}" x="350" y="122" width="584" height="240" preserveAspectRatio="xMidYMid meet"/>`;

const defs = `
  <defs>
    <linearGradient id="violet" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f4dff"/>
      <stop offset="0.53" stop-color="#6c5cff"/>
      <stop offset="1" stop-color="#a084ff"/>
    </linearGradient>
    <linearGradient id="violetCyan" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#65e2ff"/>
      <stop offset="0.56" stop-color="#6e66ff"/>
      <stop offset="1" stop-color="#b188ff"/>
    </linearGradient>
    <linearGradient id="deep" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111740"/>
      <stop offset="1" stop-color="#3d2e91"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#d8d2ff" stop-opacity="0.82"/>
      <stop offset="1" stop-color="#d8d2ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="28" stdDeviation="30" flood-color="#433a99" flood-opacity="0.18"/>
    </filter>
  </defs>`;

const headlineLeft = (x, y, dark = '#0b143c', accent = 'url(#violet)', size = 116) => `
  <text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="800" fill="${dark}" letter-spacing="-5.5">재고 확인부터</text>
  <text x="${x}" y="${y + size * 1.28}" font-family="${font}" font-size="${size}" font-weight="800" fill="${dark}" letter-spacing="-5.5">발주까지,</text>
  <text x="${x}" y="${y + size * 2.56}" font-family="${font}" font-size="${size}" font-weight="800" fill="${accent}" letter-spacing="-5.5">한곳에서</text>`;

const v5 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}
  <rect width="${W}" height="${H}" fill="#f8f8fb"/>
  <circle cx="1130" cy="360" r="520" fill="url(#halo)" opacity="0.75"/>
  <circle cx="86" cy="2490" r="440" fill="#eceaff"/>
  ${logoImg}
  <text x="98" y="694" font-family="${font}" font-size="33" font-weight="700" fill="#5857f5" letter-spacing="-1">매장 운영을 더 단순하게</text>
  ${headlineLeft(92, 920)}
  <text x="98" y="1380" font-family="${font}" font-size="41" font-weight="500" fill="#59637d" letter-spacing="-1.5">재고 확인부터 발주까지</text>
  <text x="98" y="1442" font-family="${font}" font-size="41" font-weight="500" fill="#59637d" letter-spacing="-1.5">매장 업무를 한곳에서 관리하세요.</text>
  <path d="M98 1576H1188" stroke="#d7d5e7" stroke-width="2"/>
  <text x="98" y="1662" font-family="${font}" font-size="27" font-weight="700" fill="#868ca5" letter-spacing="2.2">STOCKLY / INVENTORY OPERATIONS</text>
  <g opacity="0.92">
    <path d="M96 2080C292 1940 500 1946 662 2078C830 2215 1003 2230 1188 2074" fill="none" stroke="#d8d4ff" stroke-width="36" stroke-linecap="round"/>
    <path d="M96 2148C288 2012 497 2018 662 2148C831 2282 1005 2298 1188 2144" fill="none" stroke="url(#violet)" stroke-width="12" stroke-linecap="round"/>
    <circle cx="214" cy="2088" r="22" fill="#5656f6"/>
    <circle cx="662" cy="2148" r="22" fill="#8d7dff"/>
    <circle cx="1066" cy="2118" r="22" fill="#65dfff"/>
  </g>
  <text x="98" y="2476" font-family="${font}" font-size="31" font-weight="600" fill="#737b9a">재고 · 발주 · 기록을 하나의 흐름으로</text>
  <text x="98" y="2552" font-family="${font}" font-size="29" font-weight="600" fill="#9aa0b5">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

const v6 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <path d="M798 -100H1370V2878H1020C1122 2420 1138 2014 1024 1650C912 1292 708 1070 734 704C750 484 842 210 798 -100Z" fill="url(#violet)"/>
  <path d="M1032 100C1140 350 1114 548 1028 792C940 1048 978 1252 1106 1472" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.28"/>
  <path d="M1164 38C1218 234 1172 448 1086 674C997 906 1034 1146 1174 1370" fill="none" stroke="#65ddff" stroke-width="3" opacity="0.33"/>
  ${logoImg}
  <text x="96" y="694" font-family="${font}" font-size="33" font-weight="700" fill="#5857f5" letter-spacing="-1">매장 재고 관리 솔루션</text>
  ${headlineLeft(92, 920, '#0b143c', '#5656f6', 109)}
  <text x="98" y="1372" font-family="${font}" font-size="40" font-weight="500" fill="#59637d" letter-spacing="-1.4">필요한 업무만 빠르게,</text>
  <text x="98" y="1432" font-family="${font}" font-size="40" font-weight="500" fill="#59637d" letter-spacing="-1.4">Stockly로 시작하세요.</text>
  <g transform="translate(92 1740)">
    <text x="0" y="0" font-family="${font}" font-size="27" font-weight="700" fill="#7e84a0" letter-spacing="2">ONE PLACE FOR EVERY SHIFT</text>
    <path d="M0 118H600" stroke="#dcd9ff" stroke-width="2"/>
    <text x="0" y="198" font-family="${font}" font-size="40" font-weight="800" fill="#0b143c">재고 현황</text>
    <text x="0" y="254" font-family="${font}" font-size="40" font-weight="800" fill="#0b143c">발주 관리</text>
    <text x="0" y="310" font-family="${font}" font-size="40" font-weight="800" fill="#0b143c">작업 기록</text>
    <path d="M0 356H600" stroke="#dcd9ff" stroke-width="2"/>
    <text x="0" y="434" font-family="${font}" font-size="29" font-weight="600" fill="#7b82a4">매장 운영을 한곳에서</text>
  </g>
  <g transform="translate(882 1820)" opacity="0.96">
    <rect x="0" y="0" width="232" height="232" rx="116" fill="#ffffff" opacity="0.18"/>
    <rect x="22" y="22" width="188" height="188" rx="94" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.5"/>
    <text x="116" y="137" text-anchor="middle" font-family="${font}" font-size="90" font-weight="800" fill="#ffffff">S</text>
  </g>
  <text x="96" y="2630" font-family="${font}" font-size="30" font-weight="600" fill="#7b82a4">Stockly</text>
</svg>`;

const v7 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}
  <rect width="${W}" height="${H}" fill="url(#deep)"/>
  <circle cx="1030" cy="350" r="570" fill="#7c70ff" opacity="0.14"/>
  <circle cx="150" cy="2520" r="470" fill="#5ddfff" opacity="0.08"/>
  <path d="M0 1710C270 1550 560 1600 804 1772C1000 1910 1130 1960 1284 1916" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.16"/>
  <path d="M0 1766C270 1606 560 1656 804 1828C1000 1966 1130 2016 1284 1972" fill="none" stroke="#8b82ff" stroke-width="5" opacity="0.42"/>
  <rect x="74" y="92" width="470" height="216" rx="108" fill="#ffffff"/>
  <image href="data:image/png;base64,${logo}" x="104" y="112" width="410" height="176" preserveAspectRatio="xMinYMid meet"/>
  <text x="96" y="694" font-family="${font}" font-size="33" font-weight="700" fill="#c5c0ff" letter-spacing="-1">매장 재고 관리 솔루션</text>
  ${headlineLeft(92, 920, '#ffffff', '#bdb6ff', 112)}
  <text x="98" y="1378" font-family="${font}" font-size="40" font-weight="500" fill="#e4e1ff" letter-spacing="-1.4">재고와 발주를 더 빠르고</text>
  <text x="98" y="1438" font-family="${font}" font-size="40" font-weight="500" fill="#e4e1ff" letter-spacing="-1.4">정확하게 관리하세요.</text>
  <g transform="translate(92 1770)">
    <text x="0" y="0" font-family="${font}" font-size="27" font-weight="700" fill="#9f98ef" letter-spacing="2.5">THE SIMPLE OPERATING SYSTEM</text>
    <path d="M0 96H1090" stroke="#ffffff" stroke-width="2" opacity="0.2"/>
    <text x="0" y="196" font-family="${font}" font-size="31" font-weight="700" fill="#ffffff">01  ·  재고 확인</text>
    <text x="0" y="278" font-family="${font}" font-size="31" font-weight="700" fill="#ffffff">02  ·  부족 품목 확인</text>
    <text x="0" y="360" font-family="${font}" font-size="31" font-weight="700" fill="#ffffff">03  ·  바로 발주</text>
    <path d="M0 442H1090" stroke="#ffffff" stroke-width="2" opacity="0.2"/>
    <text x="0" y="526" font-family="${font}" font-size="29" font-weight="600" fill="#c0bbf8">매장 운영을 더 단순하게, Stockly</text>
  </g>
  <g transform="translate(920 1800)" opacity="0.55">
    <circle cx="98" cy="98" r="98" fill="none" stroke="#8f88ff" stroke-width="2"/>
    <circle cx="98" cy="98" r="62" fill="none" stroke="#65ddff" stroke-width="2"/>
    <circle cx="98" cy="98" r="10" fill="#ffffff"/>
  </g>
</svg>`;

const v8 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}
  <rect width="${W}" height="${H}" fill="#fbfbff"/>
  <g opacity="0.55" stroke="#e9e7f8" stroke-width="2">
    <path d="M0 420H1284M0 700H1284M0 980H1284M0 1260H1284M0 1540H1284M0 1820H1284M0 2100H1284M0 2380H1284"/>
    <path d="M128 0V2778M384 0V2778M640 0V2778M896 0V2778M1152 0V2778"/>
  </g>
  <circle cx="1040" cy="560" r="430" fill="#efedff"/>
  <circle cx="1040" cy="560" r="300" fill="#e4e0ff" opacity="0.82"/>
  ${logoCenter}
  <text x="642" y="700" text-anchor="middle" font-family="${font}" font-size="33" font-weight="700" fill="#5857f5" letter-spacing="-1">재고 관리, 이제 더 가볍게</text>
  <text x="642" y="1010" text-anchor="middle" font-family="${font}" font-size="106" font-weight="800" fill="#0b143c" letter-spacing="-5">재고 확인부터</text>
  <text x="642" y="1144" text-anchor="middle" font-family="${font}" font-size="106" font-weight="800" fill="#0b143c" letter-spacing="-5">발주까지,</text>
  <text x="642" y="1278" text-anchor="middle" font-family="${font}" font-size="106" font-weight="800" fill="url(#violet)" letter-spacing="-5">한곳에서</text>
  <text x="642" y="1436" text-anchor="middle" font-family="${font}" font-size="39" font-weight="500" fill="#59637d" letter-spacing="-1.4">매장 업무를 한곳에서 간단하게 관리하세요.</text>
  <g transform="translate(120 1690)" filter="url(#shadow)">
    <rect width="1044" height="494" rx="150" fill="#ffffff"/>
    <path d="M176 206H868" stroke="url(#violet)" stroke-width="10" stroke-linecap="round" opacity="0.32"/>
    <g transform="translate(90 112)">
      <circle cx="90" cy="94" r="54" fill="#5d5cff"/><text x="90" y="110" text-anchor="middle" font-family="${font}" font-size="34" font-weight="800" fill="#ffffff">01</text>
      <text x="90" y="186" text-anchor="middle" font-family="${font}" font-size="28" font-weight="800" fill="#0b143c">확인</text>
    </g>
    <g transform="translate(420 112)">
      <circle cx="90" cy="94" r="54" fill="#7b6bff"/><text x="90" y="110" text-anchor="middle" font-family="${font}" font-size="34" font-weight="800" fill="#ffffff">02</text>
      <text x="90" y="186" text-anchor="middle" font-family="${font}" font-size="28" font-weight="800" fill="#0b143c">판단</text>
    </g>
    <g transform="translate(750 112)">
      <circle cx="90" cy="94" r="54" fill="#9a82ff"/><text x="90" y="110" text-anchor="middle" font-family="${font}" font-size="34" font-weight="800" fill="#ffffff">03</text>
      <text x="90" y="186" text-anchor="middle" font-family="${font}" font-size="28" font-weight="800" fill="#0b143c">실행</text>
    </g>
  </g>
  <text x="642" y="2452" text-anchor="middle" font-family="${font}" font-size="31" font-weight="700" fill="#5656f6">재고 현황  ·  발주 관리  ·  작업 기록</text>
  <text x="642" y="2584" text-anchor="middle" font-family="${font}" font-size="29" font-weight="600" fill="#8a90aa">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

[v5, v6, v7, v8].forEach((svg, index) => {
  const n = index + 5;
  fs.writeFileSync(`tmp/appstore/stockly-appstore-main-brand-v${n}-1284x2778.svg`, svg);
  fs.writeFileSync(`tmp/appstore/stockly-appstore-main-brand-v${n}-editable-1284x2778.svg`, svg);
});
