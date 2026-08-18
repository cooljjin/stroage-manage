# Windows 작업 시작용 AI 에이전트 프롬프트

새 Windows 컴퓨터에서 이 저장소를 클론한 뒤, 아래 내용을 AI 에이전트에게 그대로 전달한다. `.env` 값, 로그인 정보, 서명키는 프롬프트나 Git에 넣지 않는다.

## 저장소 내려받기

저장소 주소는 다음과 같다.

```text
https://github.com/cooljjin/stroage-manage.git
```

WSL2 Ubuntu를 사용할 경우:

```bash
mkdir -p ~/projects
cd ~/projects
git clone https://github.com/cooljjin/stroage-manage.git stockly
cd stockly
```

Windows PowerShell에서 직접 받을 경우:

```powershell
git clone https://github.com/cooljjin/stroage-manage.git C:\dev\stockly
Set-Location C:\dev\stockly
```

처음에는 읽기 전용 clone만 하면 된다. GitHub 로그인이나 push 권한 설정은 Windows에서 변경 사항을 올릴 때에만 진행한다.

```text
Stockly 저장소에서 Windows 개발 환경을 시작하려고 한다.

저장소 주소는 https://github.com/cooljjin/stroage-manage.git 이다. 아직 clone하지 않았다면 WSL2에서는 다음을 실행해라.
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/cooljjin/stroage-manage.git stockly
cd stockly

Windows PowerShell을 사용할 경우에는 다음을 실행해라.
git clone https://github.com/cooljjin/stroage-manage.git C:\dev\stockly
Set-Location C:\dev\stockly

먼저 저장소 루트의 AGENTS.md와 README.md를 끝까지 읽고, git status --short --branch와 git remote -v로 현재 상태를 확인해라. 기존 변경은 사용자 작업이므로 되돌리거나 대규모 포맷팅을 하지 마라.

목표는 웹 기반 개발 환경을 안전하게 준비하고, 현재 소스가 실행·빌드되는지 확인하는 것이다. 배포, Supabase migration push, Edge Function deploy, Vercel 배포, TestFlight 업로드는 절대 실행하지 마라.

환경 원칙:
- Windows에서는 WSL2를 우선 사용한다. 웹 개발만 한다면 Docker는 필수가 아니다.
- Node.js와 npm을 설치한 뒤 package-lock.json 기준으로 npm ci를 사용한다.
- .env.example을 참고해 로컬 .env를 만들되, 실제 VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY는 나에게 요청한다. .env와 .env.local은 Git에 추가하지 마라.
- Docker Desktop은 로컬 Supabase가 필요할 때만 설치·사용한다. 현재 저장소에 로컬 Supabase 설정을 새로 만들거나 Docker 설정을 추가해야 한다면 먼저 제안하고 승인받아라.
- Android Studio, 에뮬레이터, USB Android 기기 검증은 Windows 호스트에서 한다. iOS Archive, 코드 서명, TestFlight, 실제 iPhone 검증은 Mac이 필요하므로 Windows에서 완료됐다고 주장하지 마라.
- Capacitor 앱은 dist를 로컬 번들로 사용한다. 웹 코드 변경은 설치된 앱에 자동 반영되지 않으며, native 반영에는 build와 cap sync/copy 후 재설치가 필요하다.

안전 규칙:
- 운영 매장이나 운영 품목을 검증용으로 변경하지 마라. 데이터 변경 검증은 Stockly 테스트 매장에서만 한다. 기본 매장을 사용해야 하면 대상·변경·복구 계획을 먼저 설명하고 내 승인을 받아라.
- React 컴포넌트, 페이지, 훅, 일반 helper에서 Supabase를 직접 import/call하지 말고 src/services 계층을 사용한다.
- src/App.tsx, ScanPage.tsx, InventoryOperationPage.tsx, LowStockPage.tsx의 동작을 변경할 때는 관련 흐름과 권한·매장 범위를 먼저 확인한다.
- tmp/, dist/, dist-admin/, node_modules/, .env, Android keystore와 key.properties는 임의로 Git에 추가하지 마라.

시작 확인 순서:
1. git status --short --branch
2. git switch main
3. git pull --ff-only origin main
4. npm ci
5. .env 설정 여부 확인
6. npm run build
7. npm run lint

전체 lint가 dist-admin/ 또는 tmp 생성물 때문에 실패하면 원인을 분리하고 npx eslint src 및 npx eslint admin-console/src 결과를 따로 보고해라.

마지막 보고에는 변경 파일, 실제로 실행한 검증과 결과, 실행하지 않은 검증과 이유를 한국어로 간결하게 정리해라.
```

## Windows에서 직접 준비할 항목

- Git, Node.js, VS Code
- WSL2 Ubuntu(권장)
- `.env.example`을 바탕으로 한 개인 `.env`
- 웹 개발만 할 경우: Chrome 또는 Edge
- Android 작업을 할 경우: Android Studio, Android SDK, 실제 Android 기기 또는 에뮬레이터
- 로컬 Supabase까지 필요할 경우: Docker Desktop의 WSL2 연동

Windows에서 iOS 배포는 하지 않는다. iOS 관련 변경은 Mac에서 별도 build·Capacitor copy·Xcode Archive·Apple 처리·기기 설치를 검증한다.
