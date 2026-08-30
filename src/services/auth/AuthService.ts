import type { AuthChangeEvent, Provider, Session, SignInWithPasswordCredentials, SignUpWithPasswordCredentials, UserIdentity } from "@supabase/supabase-js";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { requestNativeAppleCredential } from "../../lib/nativeAppleSignIn";
import { supabase } from "../../lib/supabase";

export type { AuthChangeEvent, Session, User, UserIdentity } from "@supabase/supabase-js";

const NATIVE_AUTH_CALLBACK_URL = "com.jinkim.stockly://auth/callback";
const NATIVE_AUTH_STATE_STORAGE_KEY = "stockly-native-auth-state";
const NATIVE_AUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
export const ACCOUNT_LINK_RETURN_STORAGE_KEY = "store-inventory-account-link-return";

type NativeAuthPurpose = "oauth" | "account-link" | "password-recovery";

type NativeAuthState = {
  value: string;
  purpose: NativeAuthPurpose;
  createdAt: number;
};

function createNativeAuthState(purpose: NativeAuthPurpose) {
  const state: NativeAuthState = {
    value: crypto.randomUUID(),
    purpose,
    createdAt: Date.now()
  };
  localStorage.setItem(NATIVE_AUTH_STATE_STORAGE_KEY, JSON.stringify(state));
  return state;
}

function getStoredNativeAuthState() {
  const storedValue = localStorage.getItem(NATIVE_AUTH_STATE_STORAGE_KEY);
  if (!storedValue) return null;

  try {
    const state = JSON.parse(storedValue) as Partial<NativeAuthState>;
    if (
      typeof state.value !== "string"
      || typeof state.createdAt !== "number"
      || !["oauth", "account-link", "password-recovery"].includes(state.purpose ?? "")
      || Date.now() - state.createdAt > NATIVE_AUTH_STATE_MAX_AGE_MS
    ) {
      localStorage.removeItem(NATIVE_AUTH_STATE_STORAGE_KEY);
      return null;
    }
    return state as NativeAuthState;
  } catch {
    localStorage.removeItem(NATIVE_AUTH_STATE_STORAGE_KEY);
    return null;
  }
}

function nativeRedirectUrl(state: NativeAuthState) {
  const callbackUrl = new URL(NATIVE_AUTH_CALLBACK_URL);
  callbackUrl.searchParams.set("stockly_state", state.value);
  return callbackUrl.toString();
}

function getAuthRedirectUrl(purpose: NativeAuthPurpose = "oauth") {
  if (Capacitor.isNativePlatform()) {
    return nativeRedirectUrl(createNativeAuthState(purpose));
  }
  return window.location.origin;
}

function getPasswordResetRedirectUrl() {
  if (Capacitor.isNativePlatform()) {
    return nativeRedirectUrl(createNativeAuthState("password-recovery"));
  }
  return `${window.location.origin}/password-reset`;
}

async function signInWithOAuthProvider(provider: Provider, scopes?: string) {
  const result = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getAuthRedirectUrl(),
      scopes,
      queryParams: getOAuthLoginQueryParams(provider),
      skipBrowserRedirect: Capacitor.isNativePlatform()
    }
  });

  if (result.error || !Capacitor.isNativePlatform()) {
    return result;
  }

  if (!result.data.url) {
    return {
      ...result,
      error: new Error("OAuth 인증 URL을 생성하지 못했습니다.")
    };
  }

  try {
    await Browser.open({ url: result.data.url });
    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error : new Error("인증 브라우저를 열지 못했습니다.")
    };
  }
}

function getOAuthQueryParams(provider: Provider) {
  if (provider === "google" || provider === "kakao") {
    return { prompt: "select_account" };
  }

  return undefined;
}

function getOAuthLoginQueryParams(provider: Provider) {
  if (provider === "kakao" && Capacitor.getPlatform() === "ios") {
    return { prompt: "login" };
  }

  return getOAuthQueryParams(provider);
}

async function signInWithNativeApple() {
  const credential = await requestNativeAppleCredential();
  if ("cancelled" in credential) {
    return {
      data: { session: null, user: null },
      error: null
    };
  }

  const result = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: credential.nonce
  });
  if (result.error || !result.data.user) return result;

  const existingMetadata = result.data.user.user_metadata ?? {};
  const fullName = [credential.givenName, credential.familyName].filter(Boolean).join(" ");
  const profileData: Record<string, string> = {};
  if (!existingMetadata.full_name && fullName) profileData.full_name = fullName;
  if (!existingMetadata.given_name && credential.givenName) profileData.given_name = credential.givenName;
  if (!existingMetadata.family_name && credential.familyName) profileData.family_name = credential.familyName;
  if (Object.keys(profileData).length > 0) {
    await supabase.auth.updateUser({ data: profileData });
  }

  return result;
}

function getOAuthScopes(provider: Provider) {
  if (provider === "kakao") {
    return "profile_image profile_nickname account_email";
  }
  return undefined;
}

function getOAuthOptions(provider: Provider) {
  return {
    redirectTo: getAuthRedirectUrl("account-link"),
    scopes: getOAuthScopes(provider),
    queryParams: getOAuthQueryParams(provider),
    skipBrowserRedirect: Capacitor.isNativePlatform()
  };
}

function parseNativeAuthCallback(url: string) {
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(url);
  } catch {
    return { callbackUrl: null, error: new Error("올바르지 않은 인증 callback URL입니다.") };
  }

  if (
    callbackUrl.protocol !== "com.jinkim.stockly:"
    || callbackUrl.hostname !== "auth"
    || callbackUrl.pathname !== "/callback"
    || callbackUrl.username
    || callbackUrl.password
    || callbackUrl.port
  ) {
    return { callbackUrl: null, error: new Error("허용되지 않은 인증 callback URL입니다.") };
  }

  const storedState = getStoredNativeAuthState();
  const callbackState = callbackUrl.searchParams.get("stockly_state");
  if (!storedState || !callbackState || callbackState !== storedState.value) {
    return { callbackUrl: null, error: new Error("인증 요청 상태가 일치하지 않거나 만료되었습니다.") };
  }

  return { callbackUrl, storedState, error: null };
}

export const AuthService = {
  login(email: string, password: string) {
    return supabase.auth.signInWithPassword({ email, password });
  },

  signInWithPassword(credentials: SignInWithPasswordCredentials) {
    return supabase.auth.signInWithPassword(credentials);
  },

  signUp(credentials: SignUpWithPasswordCredentials) {
    return supabase.auth.signUp(credentials);
  },

  resetPasswordForEmail(email: string) {
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl()
    });
  },

  updatePassword(password: string) {
    return supabase.auth.updateUser({ password });
  },

  logout() {
    return supabase.auth.signOut();
  },

  signOut() {
    return supabase.auth.signOut();
  },

  getCurrentUser() {
    return supabase.auth.getUser();
  },

  getUser() {
    return supabase.auth.getUser();
  },

  getSession() {
    return supabase.auth.getSession();
  },

  refreshSession() {
    return supabase.auth.refreshSession();
  },

  async handleOAuthCallbackUrl(url: string) {
    const parsedCallback = parseNativeAuthCallback(url);
    if (parsedCallback.error || !parsedCallback.callbackUrl) {
      return {
        data: { session: null, user: null },
        error: parsedCallback.error ?? new Error("인증 callback을 확인할 수 없습니다.")
      };
    }

    const code = parsedCallback.callbackUrl.searchParams.get("code");
    if (!code || parsedCallback.callbackUrl.hash) {
      return {
        data: { session: null, user: null },
        error: new Error("PKCE 인증 코드가 없거나 허용되지 않은 토큰 정보가 포함되어 있습니다.")
      };
    }

    if (Capacitor.isNativePlatform()) {
      await Browser.close().catch(() => undefined);
    }

    localStorage.removeItem(NATIVE_AUTH_STATE_STORAGE_KEY);
    const result = await supabase.auth.exchangeCodeForSession(code);
    if (result.error) {
      return result;
    }
    return result;

  },

  isNativeAuthCallbackUrl(url: string) {
    try {
      const callbackUrl = new URL(url);
      return callbackUrl.protocol === "com.jinkim.stockly:"
        && callbackUrl.hostname === "auth"
        && callbackUrl.pathname === "/callback"
        && !callbackUrl.username
        && !callbackUrl.password
        && !callbackUrl.port;
    } catch {
      return false;
    }
  },

  isPasswordRecoveryUrl(url: string) {
    const callbackUrl = new URL(url);
    const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
    return callbackUrl.searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery";
  },

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },

  loginWithGoogle() {
    return signInWithOAuthProvider("google");
  },

  loginWithApple() {
    if (Capacitor.getPlatform() === "ios") {
      return signInWithNativeApple();
    }
    return signInWithOAuthProvider("apple");
  },

  loginWithKakao() {
    return signInWithOAuthProvider("kakao", getOAuthScopes("kakao"));
  },

  getUserIdentities() {
    return supabase.auth.getUserIdentities();
  },

  async linkOAuthIdentity(provider: "google" | "kakao") {
    localStorage.setItem(ACCOUNT_LINK_RETURN_STORAGE_KEY, provider);
    const result = await supabase.auth.linkIdentity({
      provider,
      options: getOAuthOptions(provider)
    });

    if (result.error || !Capacitor.isNativePlatform()) return result;
    if (!result.data.url) {
      return {
        ...result,
        error: new Error("OAuth 인증 URL을 생성하지 못했습니다.")
      };
    }

    try {
      await Browser.open({ url: result.data.url });
      return result;
    } catch (error) {
      return {
        ...result,
        error: error instanceof Error ? error : new Error("인증 브라우저를 열지 못했습니다.")
      };
    }
  },

  unlinkIdentity(identity: UserIdentity) {
    return supabase.auth.unlinkIdentity(identity);
  }
};
