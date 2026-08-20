const fs = require('fs');

const encode = (path) => fs.readFileSync(path).toString('base64');
const logo = encode('public/stockly-login-logo.png');
const screen = encode('/Users/jinkim/Downloads/IMG_6534.PNG');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1284" height="2778" viewBox="0 0 1284 2778">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7f8ff"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#d1d0ff" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#d1d0ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="phoneShadow" x="-35%" y="-25%" width="170%" height="160%">
      <feDropShadow dx="0" dy="30" stdDeviation="34" flood-color="#171750" flood-opacity="0.22"/>
    </filter>
    <clipPath id="screenClip">
      <rect x="250" y="1215" width="784" height="1420" rx="84"/>
    </clipPath>
  </defs>

  <rect id="background" width="1284" height="2778" fill="url(#bg)"/>
  <ellipse id="right-glow" cx="1050" cy="760" rx="520" ry="620" fill="url(#glow)"/>
  <ellipse id="bottom-glow" cx="140" cy="2320" rx="440" ry="520" fill="#e5e5ff" opacity="0.48"/>
  <circle id="top-orb" cx="1220" cy="120" r="220" fill="#f1f1ff" opacity="0.9"/>
  <path id="accent-curve" d="M80 1000C280 930 470 930 640 1000" fill="none" stroke="#e5e5ff" stroke-width="3" opacity="0.8"/>

  <image id="stockly-logo" href="data:image/png;base64,${logo}" x="94" y="118" width="360" height="148" preserveAspectRatio="none"/>
  <text id="eyebrow" x="98" y="398" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="34" font-weight="700" fill="#5757ff">통합 매장 재고관리 솔루션</text>
  <text id="headline-1" x="94" y="570" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#081238">재고 확인부터</text>
  <text id="headline-2" x="94" y="700" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#081238">발주까지,</text>
  <text id="headline-3" x="94" y="830" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#5757ff">한곳에서</text>
  <text id="description-1" x="98" y="946" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">매장 재고 업무를 한 화면에서</text>
  <text id="description-2" x="98" y="1000" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">빠르게 관리하세요.</text>

  <g id="feature-pills" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="27" font-weight="700">
    <rect id="pill-1" x="98" y="1048" width="182" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-1" x="189" y="1087" text-anchor="middle" fill="#4948f7">재고 현황</text>
    <rect id="pill-2" x="298" y="1048" width="202" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-2" x="399" y="1087" text-anchor="middle" fill="#4948f7">바코드 스캔</text>
    <rect id="pill-3" x="518" y="1048" width="182" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-3" x="609" y="1087" text-anchor="middle" fill="#4948f7">발주 관리</text>
  </g>

  <g id="phone" filter="url(#phoneShadow)">
    <rect id="phone-back" x="170" y="1135" width="944" height="1580" rx="148" fill="#11152d"/>
    <rect id="phone-bezel" x="190" y="1155" width="904" height="1540" rx="130" fill="#34384c" stroke="#7e83a1" stroke-width="5"/>
    <rect id="phone-glass" x="219" y="1184" width="846" height="1482" rx="106" fill="#ffffff" stroke="#0a0d1e" stroke-width="13"/>
    <image id="app-screen" href="data:image/png;base64,${screen}" x="250" y="1215" width="784" height="1420" preserveAspectRatio="none" clip-path="url(#screenClip)"/>
    <rect id="dynamic-island" x="548" y="1200" width="188" height="44" rx="22" fill="#0a0d1e"/>
    <rect id="left-button-top" x="160" y="1535" width="18" height="136" rx="9" fill="#34384c"/>
    <rect id="left-button-bottom" x="160" y="1694" width="18" height="82" rx="9" fill="#34384c"/>
    <rect id="right-button" x="1106" y="1558" width="18" height="194" rx="9" fill="#34384c"/>
  </g>
</svg>`;

fs.writeFileSync('tmp/appstore/stockly-editable-portrait.svg', svg);
