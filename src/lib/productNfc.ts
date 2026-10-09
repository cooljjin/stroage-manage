const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANDROID_PACKAGE = "com.jinkim.stockly";
const encoder = new TextEncoder();
type ProductTagChannel = "production" | "development";

export function productTagUrl(productId: string, host: string, channel: ProductTagChannel = "production") {
  if (!PRODUCT_ID_PATTERN.test(productId)) throw new Error("유효한 품목을 선택해 주세요.");
  const origin = new URL(`https://${host}`);
  if (origin.host !== host || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("품목 NFC 링크 호스트가 올바르지 않습니다.");
  }
  const prefix = channel === "development" ? "/nfc/dev/product/" : "/nfc/product/";
  return new URL(`${prefix}${productId}`, origin).toString();
}

export function parseProductTagUrl(rawUrl: string, allowedHost: string, channel: ProductTagChannel = "production") {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.host !== allowedHost || url.username || url.password || url.search || url.hash) return null;
    const path = channel === "development" ? url.pathname.replace(/^\/nfc\/dev\/product\//, "/nfc/product/") : url.pathname;
    const match = path.match(/^\/nfc\/product\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function urlNdefRecord(url: string) {
  if (!url.startsWith("https://")) throw new Error("NFC에 기록할 URL은 HTTPS여야 합니다.");
  return {
    tnf: 0x01,
    type: [0x55],
    id: [],
    payload: [0x04, ...Array.from(encoder.encode(url.slice("https://".length)))]
  };
}

export function productNfcNdefRecords(url: string) {
  const parsedUrl = new URL(url);
  if (!parseProductTagUrl(url, parsedUrl.host, "development")) throw new Error("올바른 품목 NFC 링크가 아닙니다.");
  return [
    urlNdefRecord(url),
    {
      tnf: 0x04,
      type: Array.from(encoder.encode("android.com:pkg")),
      id: [],
      payload: Array.from(encoder.encode(ANDROID_PACKAGE))
    }
  ];
}
