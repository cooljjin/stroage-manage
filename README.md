# Storage Manage

## Supabase Dependency Rule

This project should not call Supabase directly from React components, hooks, or stores.

Supabase access must go through the service layer under `src/services`.

## Allowed Structure

```text
React Component / Hook / Store
        |
        v
Service Layer
        |
        v
Supabase
```

Use service classes or functions such as:

```ts
import { AuthService, DatabaseService, EdgeFunctionService, StorageService } from "../services";
```

This project does not currently use a path alias such as `@/services`, so keep imports relative to the file location.

## Do Not Import Supabase Directly

Do not use this pattern outside `src/lib/supabase.ts` or `src/services/**`:

```ts
import { supabase } from "../lib/supabase";
```

Direct Supabase calls are only allowed inside `src/lib/supabase.ts` and `src/services/**`.

## Auth

Authentication features should use `AuthService`.

Examples:

```ts
await AuthService.login(email, password);
await AuthService.logout();
await AuthService.getCurrentUser();
await AuthService.getSession();
```

OAuth providers such as Google, Apple, and Kakao should also be called through `AuthService`.

```ts
await AuthService.loginWithGoogle();
await AuthService.loginWithKakao();
await AuthService.loginWithApple();
```

Before using OAuth in production, enable each provider in Supabase Auth and register the app URLs:

- Supabase callback URL in each provider console: `https://<project-id>.supabase.co/auth/v1/callback`
- Supabase Auth Site URL: production app URL
- Supabase Auth Redirect URLs: local and production app URLs

## Database

Database access should use `DatabaseService` or a domain service.

Simple shared access:

```ts
const items = await DatabaseService.select("inventory", "*");
```

The current service layer keeps Supabase's fluent query behavior intact:

```ts
const { data, error } = await DatabaseService.select("products", "*")
  .eq("store_id", currentStoreId)
  .order("name", { ascending: true });
```

Domain-specific access:

```ts
const items = await InventoryService.getInventoryItems();
```

If the same table query is repeated in multiple places, move it into a domain service such as `InventoryService`, `RecipeService`, or `PurchaseService`.

## Storage

File access should use `StorageService`.

Examples:

```ts
await StorageService.upload(bucket, path, file);
await StorageService.download(bucket, path);
await StorageService.remove(bucket, paths);
await StorageService.getPublicUrl(bucket, path);
```

## Edge Functions

Edge Function calls should use `EdgeFunctionService`.

Example:

```ts
await EdgeFunctionService.invoke("delete-auth-user", {
  body: { userId }
});
```

## Refactoring Principle

When replacing direct Supabase calls, keep behavior unchanged.

Do not change:

- UI
- Database schema
- Supabase settings
- Query meaning
- Authentication flow
- Storage bucket behavior

The goal is to move Supabase dependency into one layer, not to redesign the app.

## Long-Term Direction

The service layer should make it possible to keep using Supabase now while leaving room for a future API server, personal backend, or mock test environment.

Future target structure:

```text
React Component / Hook / Store
        |
        v
Domain Service
        |
        v
DatabaseService / API Client
        |
        v
Supabase or Backend Server
```
