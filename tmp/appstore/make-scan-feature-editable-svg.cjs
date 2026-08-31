const fs = require('fs');

const source = fs.readFileSync('tmp/appstore/stockly-appstore-1284x2778.svg', 'utf8');
const stageSource = fs.readFileSync('tmp/appstore/stockly-scan-stage-screen-778x1453.svg', 'utf8');
const stageInner = stageSource
  .replace(/^\s*<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

let svg = source.replace(
  '</defs>',
  `    <clipPath id="screenClip"><rect x="219" y="1184" width="846" height="1482" rx="106"/></clipPath>\n  </defs>`,
);

svg = svg.replace(
  '  <text x="98" y="398"',
  `  <g id="stockly-logo" transform="translate(94 118)">
    <g transform="translate(0 14) scale(0.42)">
      <path d="M128 185L248 255 128 325 8 255Z" fill="#6A65F3" stroke="#5A55E9" stroke-width="2"/>
      <path d="M8 255v28c0 12 9 22 20 29l100 58 100-58c11-7 20-17 20-29v-28L128 325Z" fill="#5B56E8"/>
      <path d="M128 122L248 192 128 262 8 192Z" fill="none" stroke="#7773FF" stroke-width="30" stroke-linejoin="round"/>
      <path d="M8 192v26c0 10 7 19 16 25l104 60 104-60c9-6 16-15 16-25v-26L128 262Z" fill="#6863F1"/>
      <path d="M128 0L252 72c10 6 10 20 0 26l-104 61c-12 7-28 7-40 0L4 98c-10-6-10-20 0-26L128 0Z" fill="#7773FF" stroke="#8B87FF" stroke-width="2"/>
      <path d="M4 98v26c0 11 6 21 16 27l88 51c12 7 28 7 40 0l88-51c10-6 16-16 16-27V98l-104 61c-12 7-28 7-40 0L4 98Z" fill="#504BEA"/>
      <rect x="94" y="61" width="18" height="43" rx="9" fill="#FFFFFF"/>
      <rect x="144" y="61" width="18" height="43" rx="9" fill="#FFFFFF"/>
    </g>
    <text x="92" y="79" font-family="Inter, Apple SD Gothic Neo, sans-serif" font-size="58" font-weight="800" fill="#081238">Stockly</text>
  </g>
  <text x="98" y="398"`,
);
svg = svg.replace('통합 매장 재고관리 솔루션', '바코드로 더 빠르게');
svg = svg.replace('>재고 확인부터</text>', '>바코드 스캔으로</text>');
svg = svg.replace(
  'x="94" y="700" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#081238">발주까지,</text>',
  'x="94" y="700" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#5757ff">바로 재고 작업</text>',
);
svg = svg.replace(
  '  <text x="94" y="830" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#5757ff">한곳에서</text>\n',
  '',
);
svg = svg.replace(
  'x="98" y="946" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">매장 재고 업무를 한 화면에서</text>',
  'x="98" y="846" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">입고·출고·이동·조정을</text>',
);
svg = svg.replace(
  'x="98" y="1000" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">빠르게 관리하세요.</text>',
  'x="98" y="900" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">간편하게 기록하세요</text>',
);
svg = svg.replace(
  /  <g font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="27" font-weight="700">[\s\S]*?  <\/g>\n\n  <g filter="url\(#phoneShadow\)">/,
  `  <g id="feature-pills" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="27" font-weight="700">
    <rect id="pill-1" x="98" y="968" width="205" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-1" x="200.5" y="1007" text-anchor="middle" fill="#4948f7">바코드 인식</text>
    <rect id="pill-2" x="319" y="968" width="252" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-2" x="445" y="1007" text-anchor="middle" fill="#4948f7">입고·출고·이동</text>
    <rect id="pill-3" x="587" y="968" width="180" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-3" x="677" y="1007" text-anchor="middle" fill="#4948f7">재고 작업</text>
  </g>

  <g filter="url(#phoneShadow)">`,
);
svg = svg.replace(
  '<g filter="url(#phoneShadow)">',
  '<g transform="matrix(1.026483 0 0 1.079114 -34.502 -6.012)" filter="url(#phoneShadow)">',
);
svg = svg.replace(
  '    <rect x="219" y="1184" width="846" height="1482" rx="106" fill="#ffffff" stroke="#0a0d1e" stroke-width="13"/>',
  `    <rect x="219" y="1184" width="846" height="1482" rx="106" fill="#171843" stroke="#0a0d1e" stroke-width="13"/>\n    <svg id="app-screen" x="219" y="1184" width="846" height="1482" viewBox="0 0 778 1453" preserveAspectRatio="none" clip-path="url(#screenClip)">${stageInner}</svg>`,
);

fs.writeFileSync('tmp/appstore/stockly-appstore-scan-feature-editable-1284x2778.svg', svg);
