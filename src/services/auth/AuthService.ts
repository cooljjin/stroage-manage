import type { AuthChangeEvent, Provider, Session, SignInWithPasswordCredentials, SignUpWithPasswordCredentials } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../../lib/supabase";

export type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";

const NATIVE_AUTH_CALLBACK_URL = "com.jinkim.storeinventory.poc://auth/callback";

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
    return signInWithOAuthProvider("kakao", "profile_image profile_nickname account_email");
  }
};
