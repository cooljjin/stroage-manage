import type { AuthChangeEvent, Provider, Session, SignInWithPasswordCredentials, SignUpWithPasswordCredentials } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

export type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";

function getOAuthRedirectUrl() {
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
