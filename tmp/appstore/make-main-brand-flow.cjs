const fs = require('fs');

const W = 1284;
const H = 2778;
const logo = fs.readFileSync('public/stockly-login-logo.png').toString('base64');
const font = 'Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8f8ff"/>
      <stop offset="0.58" stop-color="#efedff"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4d4dff"/>
      <stop offset="0.55" stop-color="#6b5cff"/>
      <stop offset="1" stop-color="#9b83ff"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5d5cff"/>
      <stop offset="1" stop-color="#9a85ff"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#c9c3ff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#c9c3ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="cardShadow" x="-25%" y="-25%" width="150%" height="170%">
      <feDropShadow dx="0" dy="22" stdDeviation="30" flood-color="#5048bb" flood-opacity="0.18"/>
    </filter>
    <filter id="iconShadow" x="-40%" y="-40%" width="180%" height="200%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#5a4df0" flood-opacity="0.2"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="1114" cy="280" r="470" fill="url(#glow)" opacity="0.72"/>
  <circle cx="76" cy="2480" r="500" fill="#e5e3ff" opacity="0.64"/>
  <circle cx="1215" cy="2250" r="300" fill="#f0efff"/>

  <image href="data:image/png;base64,${logo}" x="92" y="112" width="430" height="176" preserveAspectRatio="xMinYMid meet"/>

  <text x="96" y="690" font-family="${font}" font-size="36" font-weight="700" fill="#5656f6" letter-spacing="-1.2">매장 재고 관리 솔루션</text>
  <text x="92" y="900" font-family="${font}" font-size="116" font-weight="800" fill="#0b143c" letter-spacing="-5.5">재고 확인부터</text>
  <text x="92" y="1048" font-family="${font}" font-size="116" font-weight="800" fill="#0b143c" letter-spacing="-5.5">발주까지,</text>
  <text x="92" y="1196" font-family="${font}" font-size="116" font-weight="800" fill="url(#brand)" letter-spacing="-5.5">한곳에서</text>

  <text x="98" y="1340" font-family="${font}" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">매장 재고와 발주 업무를</text>
  <text x="98" y="1404" font-family="${font}" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">빠르게 관리하세요.</text>

  <g transform="translate(62 1572)" filter="url(#cardShadow)">
    <rect width="1160" height="746" rx="136" fill="#ffffff" opacity="0.96"/>
    <text x="580" y="92" text-anchor="middle" font-family="${font}" font-size="27" font-weight="800" fill="#7d82a4" letter-spacing="3">STOCKLY WORKFLOW</text>
    <path d="M298 302H430M626 302H752" fill="none" stroke="url(#line)" stroke-width="8" stroke-linecap="round" opacity="0.42"/>
    <path d="M430 302l-22-16M430 302l-22 16M752 302l-22-16M752 302l-22 16" fill="none" stroke="#7064ff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.78"/>

    <g transform="translate(76 156)">
      <circle cx="130" cy="146" r="88" fill="#ecebff"/>
      <circle cx="130" cy="146" r="88" fill="none" stroke="#d9d6ff" stroke-width="3"/>
      <text x="130" y="160" text-anchor="middle" font-family="${font}" font-size="44" font-weight="800" fill="#5656f6">01</text>
      <g transform="translate(80 248)" filter="url(#iconShadow)">
        <path d="M6 42L50 16L94 42V102H6Z" fill="#6c5eff"/>
        <path d="M6 42L50 16L94 42L50 68Z" fill="#9185ff"/>
        <path d="M50 68V102M27 54V90M73 54V90" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
      </g>
      <text x="130" y="390" text-anchor="middle" font-family="${font}" font-size="38" font-weight="800" fill="#0b143c">재고 확인</text>
      <text x="130" y="440" text-anchor="middle" font-family="${font}" font-size="25" font-weight="500" fill="#717a95">품목별 수량을</text>
      <text x="130" y="478" text-anchor="middle" font-family="${font}" font-size="25" font-weight="500" fill="#717a95">한눈에 파악</text>
    </g>

    <g transform="translate(398 156)">
      <circle cx="130" cy="146" r="88" fill="#ecebff"/>
      <circle cx="130" cy="146" r="88" fill="none" stroke="#d9d6ff" stroke-width="3"/>
      <text x="130" y="160" text-anchor="middle" font-family="${font}" font-size="44" font-weight="800" fill="#5656f6">02</text>
      <g transform="translate(80 244)" filter="url(#iconShadow)">
        <path d="M50 12L100 100H0Z" fill="#ffb43d"/>
        <path d="M50 39V69" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/>
        <circle cx="50" cy="86" r="7" fill="#ffffff"/>
      </g>
      <text x="130" y="390" text-anchor="middle" font-family="${font}" font-size="38" font-weight="800" fill="#0b143c">부족 품목 확인</text>
      <text x="130" y="440" text-anchor="middle" font-family="${font}" font-size="25" font-weight="500" fill="#717a95">알림으로 놓치지</text>
      <text x="130" y="478" text-anchor="middle" font-family="${font}" font-size="25" font-weight="500" fill="#717a95">않게 확인</text>
    </g>

    <g transform="translate(720 156)">
      <circle cx="130" cy="146" r="88" fill="#ecebff"/>
      <circle cx="130" cy="146" r="88" fill="none" stroke="#d9d6ff" stroke-width="3"/>
      <text x="130" y="160" text-anchor="middle" font-family="${font}" font-size="44" font-weight="800" fill="#5656f6">03</text>
      <g transform="translate(76 246)" filter="url(#iconShadow)">
        <rect x="2" y="8" width="102" height="86" rx="18" fill="#4fcaad"/>
        <path d="M28 50l18 18 34-38" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <text x="130" y="390" text-anchor="middle" font-family="${font}" font-size="38" font-weight="800" fill="#0b143c">바로 발주</text>
      <text x="130" y="440" text-anchor="middle" font-family="${font}" font-size="25" font-weight="500" fill="#717a95">필요한 만큼</text>
      <text x="130" y="478" text-anchor="middle" font-family="${font}" font-size="25" font-weight="500" fill="#717a95">간편하게 발주</text>
    </g>

    <rect x="170" y="648" width="820" height="58" rx="29" fill="#f0efff"/>
    <text x="580" y="687" text-anchor="middle" font-family="${font}" font-size="26" font-weight="700" fill="#5656f6">재고 현황  ·  발주 관리  ·  작업 기록</text>
  </g>

  <text x="96" y="2670" font-family="${font}" font-size="30" font-weight="600" fill="#7b82a4">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

fs.writeFileSync('tmp/appstore/stockly-appstore-main-brand-flow-1284x2778.svg', svg);
fs.writeFileSync('tmp/appstore/stockly-appstore-main-brand-flow-editable-1284x2778.svg', svg);
