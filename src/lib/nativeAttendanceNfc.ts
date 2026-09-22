import { Capacitor } from "@capacitor/core";
import { CapacitorNfc } from "@capgo/capacitor-nfc";

export function isNativeNfcAvailable() {
  return Capacitor.isNativePlatform();
}

export function attendanceUrlNdefRecord(url: string) {
  const prefix = "https://";
  if (!url.startsWith(prefix)) throw new Error("NFC에 기록할 URL은 HTTPS여야 합니다.");
  return {
    tnf: 0x01,
    type: [0x55],
    id: [],
    payload: [0x04, ...Array.from(new TextEncoder().encode(url.slice(prefix.length)))]
  };
}

export async function writeAttendanceUrlToNfc(url: string) {
  if (!isNativeNfcAvailable()) throw new Error("NFC 기록은 iOS 또는 Android 앱에서만 사용할 수 있습니다.");

  return new Promise<void>((resolve, reject) => {
    let listener: { remove: () => Promise<void> } | undefined;
    let settled = false;
    const finish = async (error?: unknown) => {
      if (settled) return;
      settled = true;
      await listener?.remove().catch(() => undefined);
      await CapacitorNfc.stopScanning().catch(() => undefined);
      if (error) reject(error instanceof Error ? error : new Error("NFC 태그 기록에 실패했습니다."));
      else resolve();
    };
    void (async () => {
      try {
        listener = await CapacitorNfc.addListener("nfcEvent", () => {
          void CapacitorNfc.write({ allowFormat: true, records: [attendanceUrlNdefRecord(url)] }).then(() => finish(), finish);
        });
        await CapacitorNfc.startScanning({
          invalidateAfterFirstRead: false,
          alertMessage: "NFC 태그를 휴대폰 상단에 가까이 대세요."
        });
      } catch (error) {
        await finish(error);
      }
    })();
  });
}
