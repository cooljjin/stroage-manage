# App Store 재심사 답변

대상 심사:

- Submission ID: `0480694c-21e9-4bc6-b450-e56244a98d44`
- Review date: 2026-08-26
- Version reviewed: 1.0 (10)
- 수정 빌드 후보: 1.0 (40)

## App Review 답변

```text
Hello App Review Team,

Thank you for your feedback.

Guideline 4 – Design

We revised all social sign-in and account-registration flows in the iOS app. Google, Kakao, and Apple authentication are now presented inside the app using SFSafariViewController. Users can inspect the webpage URL and certificate, dismiss the authentication view, and return directly to Stockly after authentication. The app no longer opens the default Safari app for social authentication.

Email/password sign-in and account creation continue to be completed directly inside the app.

Account deletion is available inside the app at:
Settings > Account Deletion

Guideline 2.1(b) – Business Model Information

1. There are no users of paid subscriptions or paid services. Stockly is currently provided free of charge to store administrators and their staff.

2. Subscriptions or services cannot be purchased anywhere. There is no purchasing, pricing, subscription, upgrade, checkout, or external payment flow in the app or on a website.

3. Users cannot access any previously purchased subscriptions or paid services because Stockly does not currently offer any.

4. No paid content, subscriptions, or features are unlocked without In-App Purchase. All available inventory and store-management features are provided free of charge after creating an account or joining a store.

Stockly is an operational inventory-management tool for physical stores. It does not sell digital content or services and contains no calls to action directing users to an external purchase method.

Please review the updated build.

Thank you.
```

## 제출 전 확인

- App Store Connect의 심사 대상 빌드를 1.0 (40) 또는 그보다 높은 실제 업로드 빌드로 교체한다.
- Review Notes에 정상 동작하는 심사용 이메일/비밀번호 계정을 입력한다.
- Google, Kakao, Apple 인증 화면이 `SFSafariViewController` 안에서 열리는지 iPhone과 iPad에서 확인한다.
- 인증 성공, 사용자 취소 후 재시도, 앱 종료 상태 callback을 각각 확인한다.
- `설정 > 계정 탈퇴`에서 심사용 테스트 계정의 탈퇴 가능 여부를 확인한다.
- 운영 Supabase에 계정 탈퇴 migration과 `manage-account-deletion` Edge Function이 배포돼 있는지 확인한다.
