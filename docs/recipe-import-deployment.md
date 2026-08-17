# 레시피 자동 가져오기 배포 설정

레시피 자동 가져오기는 `recipe-import` Edge Function을 사용합니다. Gemini API 키는 브라우저나 Vercel 환경변수가 아니라 Supabase Edge Function secret으로만 등록해야 합니다.

- `GEMINI_API_KEY`: Google AI Studio에서 생성한 Gemini API 인증 키. Gemini API 전용으로 제한된 키를 사용하세요.
- `GEMINI_RECIPE_MODEL` (선택): 기본값 `gemini-2.5-flash-lite`
- `RECIPE_IMPORT_CLEANUP_SECRET`: 원본 파일 정리 호출을 인증할 임의의 긴 문자열

## Gemini 키 등록

Google AI Studio에서 Gemini API 전용 인증 키를 만든 뒤, Supabase 프로젝트에 등록합니다. 키를 Git, `.env`, 프런트엔드 코드에 넣지 마세요.

```powershell
npx supabase secrets set GEMINI_API_KEY=<발급받은-키> --project-ref <project-ref>
npx supabase secrets set GEMINI_RECIPE_MODEL=gemini-2.5-flash-lite --project-ref <project-ref>
```

키 등록 후 Edge Function을 재배포하지 않아도 다음 호출부터 secret이 사용됩니다. 실제 연결 확인은 앱에서 작은 레시피 파일을 선택하고 비용 승인 후 분석을 실행하는 방식으로 진행합니다.

기본 모델의 비용 승인은 보수적으로 유료 표준 요금(입력 1M 토큰당 $0.18, 출력 1M 토큰당 $0.72)을 기준으로 계산합니다. 프로젝트가 무료 사용량 범위에 있으면 실제 청구액은 더 낮을 수 있습니다.

`supabase/migrations/067_recipe_import.sql`을 적용하면 `recipe-imports` private Storage bucket과 가져오기/스테이징 테이블이 생성됩니다. 원본 파일은 작업 생성 시점부터 7일의 만료 시간이 기록됩니다.

원본 자동 삭제를 활성화하려면 하루 한 번 외부 스케줄러 또는 Supabase Cron에서 다음 요청을 호출하세요.

```text
POST /functions/v1/recipe-import
x-cleanup-secret: <RECIPE_IMPORT_CLEANUP_SECRET>
Content-Type: application/json

{"action":"cleanup"}
```

정리 함수는 만료된 Storage 객체를 삭제하고 작업의 `storage_path`만 비워 분석 결과와 검토 이력은 남깁니다.
