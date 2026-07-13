import type { AuthChangeEvent, Provider, Session, SignInWithPasswordCredentials, SignUpWithPasswordCredentials, UserIdentity } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../../lib/supabase";

export type { AuthChangeEvent, Session, User, UserIdentity } from "@supabase/supabase-js";

const NATIVE_AUTH_CALLBACK_URL = "com.jinkim.storeinventory.poc://auth/callback";
export const ACCOUNT_LINK_RETURN_STORAGE_KEY = "store-inventory-account-link-return";

function getOAuthRedirectUrl() {
  if (Capacitor.isNativePlatform()) {
    return NATIVE_AUTH_CALLBACK_URL;
  }
  return window.location.origin;
}

function signInWithOAuthProvider(provider: Provider, scopes?: string) {
  return supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getOAuthRedirectUrl(),
      scopes
    }
  });
}

function getOAuthScopes(provider: Provider) {
  if (provider === "kakao") {
    return "profile_image profile_nickname account_email";
  }
  return undefined;
}

function getOAuthOptions(provider: Provider) {
  return {
    redirectTo: getOAuthRedirectUrl(),
    scopes: getOAuthScopes(provider)
  };
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
    const callbackUrl = new URL(url);
    const searchParams = callbackUrl.searchParams;
    const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
    const code = searchParams.get("code");
    const accessToken = hashParams.get("access_token") ?? searchParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token") ?? searchParams.get("refresh_token");

    if (code) {
      return supabase.auth.exchangeCodeForSession(code);
    }

    if (accessToken && refreshToken) {
      return supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
    }

    return {
      data: { session: null, user: null },
      error: new Error("OAuth callback URL에 세션 정보가 없습니다.")
    };
  },

  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },

  loginWithGoogle() {
    return signInWithOAuthProvider("google");
  },

  loginWithApple() {
    return signInWithOAuthProvider("apple");
  },

  loginWithKakao() {
    return signInWithOAuthProvider("kakao", getOAuthScopes("kakao"));
  },

  getUserIdentities() {
    return supabase.auth.getUserIdentities();
  },

  linkOAuthIdentity(provider: "google" | "kakao") {
    localStorage.setItem(ACCOUNT_LINK_RETURN_STORAGE_KEY, provider);
    return supabase.auth.linkIdentity({
      provider,
      options: getOAuthOptions(provider)
    });
  },

  unlinkIdentity(identity: UserIdentity) {
    return supabase.auth.unlinkIdentity(identity);
  }
};
