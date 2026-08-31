const fs = require('fs');

let svg = fs.readFileSync('tmp/appstore/stockly-appstore-1284x2778.svg', 'utf8');

svg = svg.replace('통합 매장 재고관리 솔루션', '재고 현황 · 발주 관리 솔루션');
svg = svg.replace('>재고 확인부터</text>', '>매장 재고를</text>');
svg = svg.replace('x="94" y="700" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#081238">발주까지,</text>', 'x="94" y="700" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#5757ff">한눈에 확인</text>');
svg = svg.replace('  <text x="94" y="830" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="104" font-weight="800" letter-spacing="-3" fill="#5757ff">한곳에서</text>\n', '');
svg = svg.replace('x="98" y="946" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">매장 재고 업무를 한 화면에서</text>', 'x="98" y="846" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">품목별 수량과 재고 상태를</text>');
svg = svg.replace('x="98" y="1000" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">빠르게 관리하세요.</text>', 'x="98" y="900" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="38" font-weight="500" fill="#475569">빠르게 파악하세요.</text>');
svg = svg.replaceAll('y="1048"', 'y="968"').replaceAll('y="1087"', 'y="1007"');
svg = svg.replace('>바코드 스캔</text>', '>상태별 확인</text>');
svg = svg.replace('>발주 관리</text>', '>빠른 검색</text>');

// Match the phone frame proportions from the original “재고 확인부터 발주까지” page.
svg = svg.replace(
  '<g filter="url(#phoneShadow)">',
  '<g transform="matrix(1.026483 0 0 1.079114 -34.502 -6.012)" filter="url(#phoneShadow)">',
);

fs.writeFileSync('tmp/appstore/stockly-appstore-overview-1284x2778.svg', svg);
