const fs = require('fs');

const width = 1284;
const height = 2778;
const logoPath = 'public/stockly-login-logo.png';
const logoData = fs.readFileSync(logoPath).toString('base64');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7f7ff"/>
      <stop offset="0.55" stop-color="#f1efff"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4d4dff"/>
      <stop offset="0.52" stop-color="#6c5cff"/>
      <stop offset="1" stop-color="#9b83ff"/>
    </linearGradient>
    <linearGradient id="brandSoft" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dcd9ff"/>
      <stop offset="1" stop-color="#bdb7ff"/>
    </linearGradient>
    <radialGradient id="violetGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#d3ceff" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#d3ceff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-35%" y="-35%" width="170%" height="190%">
      <feDropShadow dx="0" dy="28" stdDeviation="30" flood-color="#4a43b8" flood-opacity="0.2"/>
    </filter>
    <filter id="softShadow" x="-35%" y="-35%" width="170%" height="190%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#5a4df0" flood-opacity="0.16"/>
    </filter>
  </defs>

  <rect width="1284" height="2778" fill="url(#bg)"/>
  <circle cx="1115" cy="260" r="470" fill="url(#violetGlow)"/>
  <circle cx="80" cy="2500" r="540" fill="#e7e5ff" opacity="0.66"/>
  <circle cx="1205" cy="2230" r="320" fill="#f0efff" opacity="0.88"/>

  <image href="data:image/png;base64,${logoData}" x="92" y="118" width="430" height="176" preserveAspectRatio="xMinYMid meet"/>

  <text x="96" y="700" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="36" font-weight="700" fill="#5656f6" letter-spacing="-1.2">매장 재고 관리 솔루션</text>
  <text x="92" y="900" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="116" font-weight="800" fill="#0b143c" letter-spacing="-5.5">재고 확인부터</text>
  <text x="92" y="1048" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="116" font-weight="800" fill="#0b143c" letter-spacing="-5.5">발주까지,</text>
  <text x="92" y="1196" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="116" font-weight="800" fill="url(#brand)" letter-spacing="-5.5">한곳에서</text>

  <text x="98" y="1340" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">매장 재고와 발주 업무를</text>
  <text x="98" y="1404" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="42" font-weight="500" fill="#4b5874" letter-spacing="-1.5">빠르게 관리하세요.</text>

  <g transform="translate(86 1584)" filter="url(#softShadow)">
    <rect x="0" y="0" width="1112" height="716" rx="132" fill="#ffffff" opacity="0.74"/>
    <rect x="30" y="30" width="1052" height="656" rx="112" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.86"/>
    <g transform="translate(126 144) rotate(-7 430 190)">
      <rect x="18" y="146" width="860" height="258" rx="88" fill="#7068e8" opacity="0.24"/>
      <rect x="0" y="88" width="860" height="258" rx="88" fill="url(#brandSoft)" opacity="0.82"/>
      <rect x="0" y="28" width="860" height="258" rx="88" fill="url(#brand)" filter="url(#shadow)"/>
      <rect x="84" y="112" width="48" height="100" rx="24" fill="#ffffff" opacity="0.94"/>
      <rect x="190" y="112" width="48" height="100" rx="24" fill="#ffffff" opacity="0.94"/>
      <circle cx="720" cy="154" r="26" fill="#ffffff" opacity="0.34"/>
      <circle cx="790" cy="154" r="14" fill="#ffffff" opacity="0.22"/>
    </g>
    <text x="556" y="596" text-anchor="middle" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="32" font-weight="700" fill="#5656f6" letter-spacing="-1">STOCKLY</text>
  </g>

  <g transform="translate(92 2448)">
    <rect x="0" y="0" width="296" height="66" rx="33" fill="#e2e0ff"/>
    <text x="148" y="43" text-anchor="middle" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="28" font-weight="700" fill="#5656f6">재고 현황</text>
    <rect x="316" y="0" width="296" height="66" rx="33" fill="#e2e0ff"/>
    <text x="464" y="43" text-anchor="middle" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="28" font-weight="700" fill="#5656f6">발주 관리</text>
    <rect x="632" y="0" width="296" height="66" rx="33" fill="#e2e0ff"/>
    <text x="780" y="43" text-anchor="middle" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="28" font-weight="700" fill="#5656f6">작업 기록</text>
  </g>

  <text x="96" y="2670" font-family="Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif" font-size="30" font-weight="600" fill="#7b82a4" letter-spacing="-0.5">매장 운영을 더 단순하게, Stockly</text>
</svg>`;

fs.writeFileSync('tmp/appstore/stockly-appstore-main-brand-1284x2778.svg', svg);
fs.writeFileSync('tmp/appstore/stockly-appstore-main-brand-editable-1284x2778.svg', svg);
