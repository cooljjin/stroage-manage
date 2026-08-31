const fs = require('fs');

const source = fs.readFileSync('tmp/appstore/stockly-appstore-1284x2778.svg', 'utf8');
const logo = fs.readFileSync('public/stockly-login-logo.png').toString('base64');
const stageScreen = fs.readFileSync('tmp/appstore/stockly-scan-stage-screen-778x1453.png').toString('base64');

let svg = source.replace(
  '</defs>',
  `    <clipPath id="screenClip"><rect x="219" y="1184" width="846" height="1482" rx="106"/></clipPath>\n  </defs>`,
);

svg = svg.replace(
  '  <text x="98" y="398"',
  `  <image id="stockly-logo" href="data:image/png;base64,${logo}" x="94" y="118" width="360" height="148" preserveAspectRatio="none"/>\n  <text x="98" y="398"`,
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
  `    <rect x="219" y="1184" width="846" height="1482" rx="106" fill="#171843" stroke="#0a0d1e" stroke-width="13"/>\n    <image id="app-screen" href="data:image/png;base64,${stageScreen}" x="219" y="1184" width="846" height="1482" preserveAspectRatio="none" clip-path="url(#screenClip)"/>`,
);

fs.writeFileSync('tmp/appstore/stockly-appstore-scan-feature-1284x2778.svg', svg);
