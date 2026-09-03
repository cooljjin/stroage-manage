# App Store 재심사 답변

대상 심사:

- Submission ID: `0480694c-21e9-4bc6-b450-e56244a98d44`
- Review date: 2026-08-26
- Version reviewed: 1.0 (10)
- 수정 빌드: App Store Connect에서 대상 앱·기존 업로드 번호를 확인한 뒤, 아직 사용하지 않은 새 build 번호로 업로드

## App Review 답변

```text
Hello App Review Team,

Thank you for your feedback.

Guideline 4 – Design

We revised the iOS social sign-in and account-registration flows. Google and Kakao authentication are presented inside the app using SFSafariViewController, so users can inspect the webpage URL and certificate, dismiss the authentication view, and return directly to Stockly after authentication. The app no longer opens the default Safari app for these sign-in flows.

Sign in with Apple uses Apple's native AuthenticationServices interface inside the app.

Email/password sign-in and account creation continue to be completed directly inside the app.

Account deletion is available inside the app at:
Settings > Account Deletion

Guideline 2.1(b) – Business Model Information

1. There are no users of paid subscriptions or paid end-user services. Stockly is currently provided free of charge to store administrators and their staff.

2. Subscriptions or services cannot be purchased anywhere. There is no purchasing, pricing, subscription, upgrade, checkout, or external payment flow in the app or on a website.

3. Users cannot access any previously purchased subscriptions or paid services because Stockly does not currently offer any.

4. No paid content, subscriptions, or features are unlocked without In-App Purchase. All available inventory and store-management features are provided free of charge after creating an account or joining a store. The optional recipe-import analysis uses an AI API as an operational cost paid by the developer. Users cannot purchase, subscribe to, or unlock that feature, and the app does not display pricing or provide an external payment flow for it.

Stockly is an operational inventory-management tool for physical stores. It does not sell digital content or services and contains no calls to action directing users to an external purchase method.

Please review the updated build.

Thank you.
```

## Review Notes 입력용 초안

```text
Test account
Email: <심사용 이메일>
Password: <심사용 비밀번호>

How to verify the sign-in experience
1. Open the app and use the email/password test account above, or tap Google, Kakao, or Apple on the login screen.
2. Google and Kakao sign-in are displayed in the in-app Safari view. Apple sign-in is displayed with Apple's native sign-in interface.
3. After authentication, the app returns directly to Stockly.

Account deletion
After signing in, open Settings > Account Deletion. The test account can request account deletion from this screen.

Business model
The app has no subscriptions, in-app purchases, external checkout, or paid feature unlocks. The optional AI recipe-import analysis is provided without a user payment flow; any AI API cost is paid by the developer as an operating expense.
```

## 제출 전 확인

- App Store Connect에서 심사 대상 앱을 확인한 뒤, 해당 앱에서 아직 사용하지 않은 새 build 번호로 업로드한다.
- 위 Review Notes의 심사용 이메일/비밀번호 placeholder를 실제 심사 계정으로 교체한다.
- Google·Kakao 인증 화면은 `SFSafariViewController` 안에서, Apple 로그인은 네이티브 Apple 인증 화면에서 열리는지 iPhone과 iPad에서 확인한다.
- 인증 성공, 사용자 취소 후 재시도, 앱 종료 상태 callback을 각각 확인한다.
- `설정 > 계정 탈퇴`에서 심사용 테스트 계정의 탈퇴 가능 여부를 확인한다.
- 운영 Supabase에 계정 탈퇴 migration과 `manage-account-deletion` Edge Function이 배포돼 있는지 확인한다.
