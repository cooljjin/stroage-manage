import { Capacitor, registerPlugin } from "@capacitor/core";

type NativeAppConfigurationPlugin = {
  getNativeAuthCallbackUrl(): Promise<{ url: string }>;
};

const NativeAppConfiguration = registerPlugin<NativeAppConfigurationPlugin>("NativeAppConfiguration");
const DEFAULT_NATIVE_AUTH_CALLBACK_URL = "com.jinkim.stockly://auth/callback";

let nativeAuthCallbackUrlPromise: Promise<string> | null = null;

function isNativeAuthCallbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "auth" && url.pathname === "/callback" && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export function getNativeAuthCallbackUrl() {
  if (Capacitor.getPlatform() !== "ios") {
    return Promise.resolve(DEFAULT_NATIVE_AUTH_CALLBACK_URL);
  }

  if (!nativeAuthCallbackUrlPromise) {
    nativeAuthCallbackUrlPromise = NativeAppConfiguration.getNativeAuthCallbackUrl()
      .then(({ url }) => (isNativeAuthCallbackUrl(url) ? url : DEFAULT_NATIVE_AUTH_CALLBACK_URL))
      .catch(() => DEFAULT_NATIVE_AUTH_CALLBACK_URL);
  }

  return nativeAuthCallbackUrlPromise;
}
