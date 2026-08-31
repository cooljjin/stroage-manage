import { Capacitor, registerPlugin } from "@capacitor/core";

type NativeAppleSignInResponse = {
  cancelled?: boolean;
  identityToken?: string;
  authorizationCode?: string;
  email?: string;
  givenName?: string;
  familyName?: string;
};

type NativeAppleSignInPlugin = {
  authorize: (options: { nonce: string }) => Promise<NativeAppleSignInResponse>;
};

const nativeAppleSignIn = registerPlugin<NativeAppleSignInPlugin>("NativeAppleSignIn");

export type NativeAppleCredential = {
  identityToken: string;
  nonce: string;
  email?: string;
  givenName?: string;
  familyName?: string;
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requestNativeAppleCredential(): Promise<NativeAppleCredential | { cancelled: true }> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") {
    throw new Error("이 기기에서는 네이티브 Apple 로그인을 사용할 수 없습니다.");
  }

  const nonce = crypto.randomUUID();
  const hashedNonce = await sha256(nonce);
  const response = await nativeAppleSignIn.authorize({ nonce: hashedNonce });
  if (response.cancelled) return { cancelled: true };
  if (!response.identityToken) {
    throw new Error("Apple 인증 토큰을 확인하지 못했습니다.");
  }

  return {
    identityToken: response.identityToken,
    nonce,
    email: response.email,
    givenName: response.givenName,
    familyName: response.familyName
  };
}
