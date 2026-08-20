const fs = require('fs');

const W = 1284;
const H = 2778;
const logo = fs.readFileSync('public/stockly-login-logo.png').toString('base64');
const font = 'Pretendard, Apple SD Gothic Neo, Noto Sans KR, sans-serif';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5050ff"/>
      <stop offset="0.56" stop-color="#6d5dff"/>
      <stop offset="1" stop-color="#a283ff"/>
    </linearGradient>
    <linearGradient id="brandLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5554ff"/>
      <stop offset="1" stop-color="#a184ff"/>
    </linearGradient>
    <radialGradient id="ring" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#d9d3ff" stop-opacity="0.64"/>
      <stop offset="0.74" stop-color="#d9d3ff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#d9d3ff" stop-opacity="0"/>
    </radialGradient>
    <filter id="panelShadow" x="-24%" y="-35%" width="148%" height="180%">
      <feDropShadow dx="0" dy="18" stdDeviation="26" flood-color="#4b42ac" flood-opacity="0.12"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="#fbfbff"/>

  <!-- quiet 12-column grid -->
  <g stroke="#e8e6f6" stroke-width="2" opacity="0.44">
    <path d="M0 0V2778M107 0V2778M214 0V2778M321 0V2778M428 0V2778M535 0V2778M642 0V2778M749 0V2778M856 0V2778M963 0V2778M1070 0V2778M1177 0V2778M1284 0V2778"/>
    <path d="M0 360H1284M0 720H1284M0 1080H1284M0 1440H1284M0 1800H1284M0 2160H1284M0 2520H1284"/>
  </g>

  <circle cx="1036" cy="452" r="392" fill="url(#ring)"/>
  <circle cx="1036" cy="452" r="256" fill="none" stroke="#dedaff" stroke-width="3" opacity="0.66"/>
  <circle cx="1036" cy="452" r="184" fill="none" stroke="#d2ccff" stroke-width="2" opacity="0.45"/>
  <circle cx="128" cy="2512" r="430" fill="#f0efff" opacity="0.8"/>

  <image href="data:image/png;base64,${logo}" x="92" y="112" width="370" height="152" preserveAspectRatio="xMinYMid meet"/>
  <text x="1190" y="174" text-anchor="end" font-family="${font}" font-size="24" font-weight="700" fill="#9ba0b8" letter-spacing="2.2">STOCKLY / 01</text>

  <text x="96" y="642" font-family="${font}" font-size="33" font-weight="700" fill="#5656f6" letter-spacing="-1">매장 재고 관리 솔루션</text>
  <text x="92" y="872" font-family="${font}" font-size="112" font-weight="800" fill="#0b143c" letter-spacing="-5.2">재고 확인부터</text>
  <text x="92" y="1016" font-family="${font}" font-size="112" font-weight="800" fill="#0b143c" letter-spacing="-5.2">발주까지,</text>
  <text x="92" y="1160" font-family="${font}" font-size="112" font-weight="800" fill="url(#brand)" letter-spacing="-5.2">한곳에서</text>

  <text x="98" y="1302" font-family="${font}" font-size="39" font-weight="500" fill="#59637d" letter-spacing="-1.4">매장 운영을 한곳에서</text>
  <text x="98" y="1362" font-family="${font}" font-size="39" font-weight="500" fill="#59637d" letter-spacing="-1.4">간단하게 관리하세요.</text>

  <!-- subtle layered brand mark, used as a watermark rather than a character -->
  <g transform="translate(810 850) rotate(-12)" opacity="0.12">
    <rect x="54" y="112" width="356" height="126" rx="48" fill="#5c59ed"/>
    <rect x="28" y="72" width="356" height="126" rx="48" fill="#7669ef"/>
    <rect y="32" width="356" height="126" rx="48" fill="url(#brand)"/>
  </g>

  <g transform="translate(72 1640)" filter="url(#panelShadow)">
    <rect width="1140" height="500" rx="72" fill="#ffffff" opacity="0.92"/>
    <rect x="1" y="1" width="1138" height="498" rx="71" fill="none" stroke="#e6e3f8" stroke-width="2"/>
    <text x="570" y="82" text-anchor="middle" font-family="${font}" font-size="30" font-weight="800" fill="#9196ae" letter-spacing="2.9">ONE PLACE FOR EVERY SHIFT</text>

    <path d="M180 218H960" stroke="url(#brandLine)" stroke-width="10" stroke-linecap="round" opacity="0.46"/>
    <circle cx="180" cy="218" r="21" fill="#5756ff"/>
    <circle cx="570" cy="218" r="21" fill="#7d6dff"/>
    <circle cx="960" cy="218" r="21" fill="#9b83ff"/>

    <text x="180" y="324" text-anchor="middle" font-family="${font}" font-size="40" font-weight="800" fill="#0b143c">재고 현황</text>
    <text x="180" y="374" text-anchor="middle" font-family="${font}" font-size="29" font-weight="500" fill="#7b829c">수량을 한눈에</text>
    <text x="570" y="324" text-anchor="middle" font-family="${font}" font-size="40" font-weight="800" fill="#0b143c">부족 알림</text>
    <text x="570" y="374" text-anchor="middle" font-family="${font}" font-size="29" font-weight="500" fill="#7b829c">놓치지 않게</text>
    <text x="960" y="324" text-anchor="middle" font-family="${font}" font-size="40" font-weight="800" fill="#0b143c">발주 관리</text>
    <text x="960" y="374" text-anchor="middle" font-family="${font}" font-size="29" font-weight="500" fill="#7b829c">바로 실행</text>
  </g>

  <text x="96" y="2356" font-family="${font}" font-size="30" font-weight="700" fill="#5656f6">재고 · 발주 · 운영</text>
  <path d="M96 2418H1188" stroke="#dedcf0" stroke-width="2"/>
  <text x="96" y="2504" font-family="${font}" font-size="29" font-weight="600" fill="#8990ab">매장 운영을 더 단순하게, Stockly</text>
  <text x="1188" y="2504" text-anchor="end" font-family="${font}" font-size="25" font-weight="600" fill="#b0b4c7">STOCKLY</text>
</svg>`;

fs.writeFileSync('tmp/appstore/stockly-appstore-main-brand-soft-grid-refined-1284x2778.svg', svg);
fs.writeFileSync('tmp/appstore/stockly-appstore-main-brand-soft-grid-refined-editable-1284x2778.svg', svg);
