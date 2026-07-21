# 계정 탈퇴 만료 정리

`manage-account-deletion` 함수는 사용자의 탈퇴·복구 요청과 30일이 지난 개인 매장 정리를 처리합니다.

배포 후 `ACCOUNT_PURGE_SECRET`을 함수 secret으로 설정하고, Supabase Scheduled Edge Functions 또는 외부 스케줄러에서 하루 한 번 아래 요청을 보냅니다.

```text
POST https://<project-ref>.supabase.co/functions/v1/manage-account-deletion
apikey: <anon-key>
Authorization: Bearer <anon-key>
x-account-purge-secret: <ACCOUNT_PURGE_SECRET>
Content-Type: application/json

{"action":"purge"}
```

이 호출이 없으면 30일이 지난 개인 매장은 자동으로 영구 삭제되지 않습니다. 배포 및 스케줄 등록은 운영 환경에서 별도로 수행합니다.
