const fs = require('fs');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="778" height="1453" viewBox="0 0 778 1453">
  <defs>
    <linearGradient id="scan-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1E2352"/>
      <stop offset="1" stop-color="#393A8A"/>
    </linearGradient>
    <linearGradient id="scan-glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8B87FF" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#C6C5FF" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#8B87FF" stop-opacity="0"/>
    </linearGradient>
    <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#6670A8" flood-opacity="0.14"/>
    </filter>
    <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#10133D" flood-opacity="0.22"/>
    </filter>
  </defs>

  <rect width="778" height="1453" fill="#F7F9FD"/>

  <!-- Status bar -->
  <text x="30" y="38" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="20" font-weight="700" fill="#111827">9:41</text>
  <path d="M657 28h6M667 25h6M677 21h6M687 17h6" stroke="#111827" stroke-width="3" stroke-linecap="round"/>
  <path d="M711 25c6-8 18-8 24 0M716 30c4-5 10-5 14 0M723 35h1" fill="none" stroke="#111827" stroke-width="3" stroke-linecap="round"/>
  <rect x="744" y="17" width="28" height="18" rx="5" fill="#111827"/>
  <rect x="772" y="23" width="3" height="7" rx="1.5" fill="#111827"/>

  <!-- Brand header -->
  <g transform="translate(30 72)">
    <rect x="0" y="14" width="40" height="30" rx="10" fill="#5B54FF" opacity="0.8"/>
    <rect x="5" y="7" width="40" height="30" rx="10" fill="#6E69FF" opacity="0.9"/>
    <rect x="10" y="0" width="40" height="30" rx="10" fill="#817DFF"/>
    <path d="M25 10h10M25 17h10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    <text x="63" y="28" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="28" font-weight="800" fill="#101943">Stockly</text>
  </g>
  <path d="M28 139H750" stroke="#E1E6F1" stroke-width="2"/>

  <!-- Page header -->
  <path d="M43 187l-10 10 10 10" fill="none" stroke="#101943" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="68" y="205" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="28" font-weight="800" fill="#101943">바코드 스캔</text>
  <text x="665" y="203" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="16" font-weight="700" fill="#5B54FF">도움말</text>

  <!-- Scanner card -->
  <rect x="28" y="238" width="722" height="440" rx="30" fill="#FFFFFF" filter="url(#card-shadow)"/>
  <text x="389" y="289" text-anchor="middle" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="25" font-weight="800" fill="#101943">상품 바코드를 스캔하세요</text>
  <text x="389" y="322" text-anchor="middle" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="17" font-weight="500" fill="#6B7895">바코드가 화면 안에 오도록 맞춰주세요</text>

  <rect x="87" y="354" width="604" height="246" rx="26" fill="url(#scan-bg)" filter="url(#soft-shadow)"/>
  <rect x="108" y="375" width="104" height="34" rx="17" fill="#5B54FF"/>
  <circle cx="128" cy="392" r="6" fill="#B9B7FF"/>
  <text x="143" y="398" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="14" font-weight="700" fill="#FFFFFF">스캔 준비</text>

  <!-- Scanner brackets -->
  <path d="M159 436v-16h16M603 436v-16h-16M159 518v16h16M603 518v16h-16" fill="none" stroke="#C6C5FF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="255" y="434" width="252" height="91" rx="10" fill="#0D1233" opacity="0.28"/>
  <g transform="translate(289 450)">
    <rect x="0" y="0" width="6" height="58" rx="3" fill="#FFFFFF"/>
    <rect x="13" y="0" width="3" height="58" rx="1.5" fill="#B9B7FF"/>
    <rect x="23" y="0" width="8" height="58" rx="4" fill="#FFFFFF"/>
    <rect x="38" y="0" width="3" height="58" rx="1.5" fill="#B9B7FF"/>
    <rect x="48" y="0" width="11" height="58" rx="5" fill="#FFFFFF"/>
    <rect x="67" y="0" width="4" height="58" rx="2" fill="#B9B7FF"/>
    <rect x="78" y="0" width="6" height="58" rx="3" fill="#FFFFFF"/>
    <rect x="92" y="0" width="3" height="58" rx="1.5" fill="#B9B7FF"/>
    <rect x="103" y="0" width="10" height="58" rx="5" fill="#FFFFFF"/>
    <rect x="121" y="0" width="4" height="58" rx="2" fill="#B9B7FF"/>
    <rect x="132" y="0" width="8" height="58" rx="4" fill="#FFFFFF"/>
    <rect x="148" y="0" width="3" height="58" rx="1.5" fill="#B9B7FF"/>
    <rect x="159" y="0" width="11" height="58" rx="5" fill="#FFFFFF"/>
    <rect x="178" y="0" width="5" height="58" rx="2.5" fill="#B9B7FF"/>
    <rect x="190" y="0" width="7" height="58" rx="3.5" fill="#FFFFFF"/>
  </g>
  <rect x="142" y="484" width="494" height="3" rx="1.5" fill="url(#scan-glow)"/>
  <text x="389" y="565" text-anchor="middle" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="15" font-weight="600" fill="#D9D8FF">상품을 자동으로 인식합니다</text>

  <rect x="217" y="617" width="340" height="52" rx="26" fill="#E9E9FF"/>
  <path d="M256 641h16M264 633v16" stroke="#5B54FF" stroke-width="3" stroke-linecap="round"/>
  <text x="389" y="648" text-anchor="middle" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="17" font-weight="700" fill="#504AF2">갤러리에서 선택</text>

  <!-- Scan result -->
  <rect x="28" y="718" width="722" height="292" rx="30" fill="#FFFFFF" filter="url(#card-shadow)"/>
  <circle cx="72" cy="766" r="19" fill="#E4F8F0"/>
  <path d="M63 766l7 7 12-14" fill="none" stroke="#18A979" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="105" y="773" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="18" font-weight="800" fill="#101943">상품을 찾았어요</text>
  <text x="54" y="833" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="31" font-weight="800" fill="#101943">우유</text>
  <text x="54" y="864" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="16" font-weight="500" fill="#6B7895">바코드 8801234567890 · 냉장</text>
  <rect x="54" y="893" width="116" height="36" rx="18" fill="#FFF0F0"/>
  <text x="112" y="917" text-anchor="middle" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="15" font-weight="700" fill="#D83C4A">부족 재고</text>
  <text x="194" y="917" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="16" font-weight="600" fill="#48566F">현재 6개 · 최소 10개</text>
  <path d="M54 953H724" stroke="#EDF0F6" stroke-width="2"/>
  <text x="54" y="986" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="16" font-weight="700" fill="#6B7895">최근 스캔 품목</text>
  <text x="724" y="986" text-anchor="end" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="16" font-weight="700" fill="#5B54FF">다시 스캔</text>

  <!-- Quick actions -->
  <text x="28" y="1071" font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="21" font-weight="800" fill="#101943">바로 작업하기</text>
  <g font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="18" font-weight="800">
    <rect x="28" y="1093" width="346" height="76" rx="22" fill="#E4F8F0"/>
    <circle cx="67" cy="1131" r="18" fill="#18A979"/>
    <path d="M67 1122v18M59 1132l8 8 8-8" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="104" y="1138" fill="#107A5A">입고</text>

    <rect x="404" y="1093" width="346" height="76" rx="22" fill="#FFF3E3"/>
    <circle cx="443" cy="1131" r="18" fill="#F09A2B"/>
    <path d="M435 1129h16M443 1121v18" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
    <text x="480" y="1138" fill="#A35A10">출고</text>

    <rect x="28" y="1181" width="346" height="76" rx="22" fill="#EAF1FF"/>
    <circle cx="67" cy="1219" r="18" fill="#4C8DFF"/>
    <path d="M58 1219h18M67 1210v18" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
    <text x="104" y="1226" fill="#2B65C7">이동</text>

    <rect x="404" y="1181" width="346" height="76" rx="22" fill="#F0EDFF"/>
    <circle cx="443" cy="1219" r="18" fill="#746DFF"/>
    <path d="M435 1219h16M443 1211v16" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
    <text x="480" y="1226" fill="#504AF2">조정</text>
  </g>

  <!-- Bottom navigation -->
  <rect x="0" y="1330" width="778" height="123" fill="#FFFFFF"/>
  <path d="M0 1330H778" stroke="#E1E6F1" stroke-width="2"/>
  <g font-family="Apple SD Gothic Neo, Inter, sans-serif" font-size="14" font-weight="700" text-anchor="middle">
    <g transform="translate(76 1356)" fill="none" stroke="#71809A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-14 0L0-12 14 0v19H-14z"/>
      <path d="M-5 19V6h10v13"/>
    </g>
    <text x="76" y="1418" fill="#71809A">홈</text>
    <g transform="translate(232 1356)" fill="none" stroke="#71809A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-14 3L0-10 14 3 0 16z"/>
      <path d="M0-10v26M-14 3h28"/>
    </g>
    <text x="232" y="1418" fill="#71809A">재고현황</text>
    <g transform="translate(389 1356)" fill="none" stroke="#5B54FF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-15-7v-8h8M15-7v-8H7M-15 7v8h8M15 7v8H7"/>
      <path d="M-8 0h16M0-8v16"/>
    </g>
    <text x="389" y="1418" fill="#5B54FF">스캔</text>
    <g transform="translate(545 1356)" fill="none" stroke="#71809A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M0-16l15 28H-15z"/>
      <path d="M0-7v8M0 7h.1"/>
    </g>
    <text x="545" y="1418" fill="#71809A">부족재고</text>
    <g transform="translate(702 1356)" fill="none" stroke="#71809A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="-13" y="-13" width="26" height="28" rx="4"/>
      <path d="M-6-18h12M-7-5h14M-7 3h14M-7 11h8"/>
    </g>
    <text x="702" y="1418" fill="#71809A">작업로그</text>
  </g>
</svg>
`;

fs.writeFileSync('tmp/appstore/stockly-scan-operation-screen-778x1453.svg', svg.trim());
