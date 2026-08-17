# 레시피 자동 가져오기 배포 설정

레시피 자동 가져오기는 `recipe-import` Edge Function을 사용합니다. 배포 전에 다음 시크릿을 Supabase Edge Functions에 등록해야 합니다.

- `GEMINI_API_KEY`: Google AI Studio 또는 Google Cloud에서 발급한 Gemini API 키
- `GEMINI_RECIPE_MODEL` (선택): 기본값 `gemini-2.5-flash-lite`
- `RECIPE_IMPORT_CLEANUP_SECRET`: 원본 파일 정리 호출을 인증할 임의의 긴 문자열

`supabase/migrations/067_recipe_import.sql`을 적용하면 `recipe-imports` private Storage bucket과 가져오기/스테이징 테이블이 생성됩니다. 원본 파일은 작업 생성 시점부터 7일의 만료 시간이 기록됩니다.

원본 자동 삭제를 활성화하려면 하루 한 번 외부 스케줄러 또는 Supabase Cron에서 다음 요청을 호출하세요.

```text
POST /functions/v1/recipe-import
x-cleanup-secret: <RECIPE_IMPORT_CLEANUP_SECRET>
Content-Type: application/json

{"action":"cleanup"}
```

정리 함수는 만료된 Storage 객체를 삭제하고 작업의 `storage_path`만 비워 분석 결과와 검토 이력은 남깁니다.
