const fs = require('fs');

const source = fs.readFileSync('tmp/appstore/stockly-appstore-1284x2778.svg', 'utf8');
const logo = fs.readFileSync('public/stockly-login-logo.png').toString('base64');
const screen = fs.readFileSync('/Users/jinkim/Downloads/IMG_6539.PNG').toString('base64');

let svg = source.replace(
  '</defs>',
  `    <clipPath id="screenClip"><rect x="219" y="1184" width="846" height="1482" rx="106"/></clipPath>\n  </defs>`,
);

svg = svg.replace(
  '  <text x="98" y="398"',
  `  <image id="stockly-logo" href="data:image/png;base64,${logo}" x="94" y="118" width="360" height="148" preserveAspectRatio="none"/>\n  <text x="98" y="398"`,
);
svg = svg.replace('통합 매장 재고관리 솔루션', '업무를 빠짐없이');
svg = svg.replace('>재고 확인부터</text>', '>할 일과</text>');
svg = svg.replace(
  'x="94" y="700" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#081238">발주까지,</text>',
  'x="94" y="700" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#081238">인수인계를</text>',
);
svg = svg.replace(
  '  <text x="94" y="830" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#5757ff">한곳에서</text>\n',
  '  <text x="94" y="830" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#5757ff">한곳에</text>\n',
);
svg = svg.replace(
  'x="98" y="946" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">매장 재고 업무를 한 화면에서</text>',
  'x="98" y="946" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">다음 근무자에게 필요한 내용을</text>',
);
svg = svg.replace(
  'x="98" y="1000" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">빠르게 관리하세요.</text>',
  'x="98" y="1000" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">정확하게 전달하세요</text>',
);

svg = svg.replace(
  /  <g font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="27" font-weight="700">[\s\S]*?  <\/g>\n\n  <g filter="url\(#phoneShadow\)">/,
  `  <g id="feature-pills" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="27" font-weight="700">
    <rect id="pill-1" x="98" y="1048" width="205" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-1" x="200.5" y="1087" text-anchor="middle" fill="#4948f7">할 일 관리</text>
    <rect id="pill-2" x="319" y="1048" width="205" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-2" x="421.5" y="1087" text-anchor="middle" fill="#4948f7">인수인계</text>
    <rect id="pill-3" x="540" y="1048" width="205" height="60" rx="30" fill="#e5e5ff"/>
    <text id="pill-text-3" x="642.5" y="1087" text-anchor="middle" fill="#4948f7">날짜별 기록</text>
  </g>

  <g filter="url(#phoneShadow)">`,
);

svg = svg.replace(
  '<g filter="url(#phoneShadow)">',
  '<g transform="matrix(1.026483 0 0 1.079114 -34.502 -6.012)" filter="url(#phoneShadow)">',
);

svg = svg.replace(
  '    <rect x="219" y="1184" width="846" height="1482" rx="106" fill="#ffffff" stroke="#0a0d1e" stroke-width="13"/>',
  `    <rect id="phone-glass" x="219" y="1184" width="846" height="1482" rx="106" fill="#ffffff" stroke="#0a0d1e" stroke-width="13"/>\n    <image id="app-screen" href="data:image/png;base64,${screen}" x="219" y="1184" width="846" height="1482" preserveAspectRatio="none" clip-path="url(#screenClip)"/>`,
);

fs.writeFileSync('tmp/appstore/stockly-appstore-handoff-feature-1284x2778.svg', svg);
fs.writeFileSync('tmp/appstore/stockly-appstore-handoff-feature-editable-1284x2778.svg', svg);
