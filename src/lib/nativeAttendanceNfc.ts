import { Capacitor, registerPlugin } from "@capacitor/core";
import { CapacitorNfc, type NfcEvent } from "@capgo/capacitor-nfc";
import { productNfcNdefRecords, urlNdefRecord } from "./productNfc";

type NativeNfcConfirmationPlugin = {
  confirmOverwrite(options: { message: string }): Promise<{ confirmed: boolean }>;
};

const nativeNfcConfirmation = registerPlugin<NativeNfcConfirmationPlugin>("NativeNfcConfirmation");
const productNfcOverwriteMessage = "이 NFC 태그에는 기존 정보가 있습니다.\n기존 정보를 삭제하고 현재 품목 링크로 계속 기록할까요?";

export function isNativeNfcAvailable() {
  return Capacitor.isNativePlatform();
}

export function attendanceUrlNdefRecord(url: string) {
  return urlNdefRecord(url);
}

const productNfcUnknownMessage = "이 NFC 태그는 기록할 수 있지만, 비어 있거나 기존 정보를 읽지 못했습니다.\n현재 품목 링크를 기록하면 기존 정보가 있을 경우 삭제됩니다. 계속 기록할까요?";

async function confirmProductNfcOverwrite(message = productNfcOverwriteMessage) {
  if (Capacitor.getPlatform() === "ios") {
    const { confirmed } = await nativeNfcConfirmation.confirmOverwrite({ message });
    return confirmed;
  }
  return window.confirm(message);
}

async function writeNdefRecordsToNfc(
  records: Parameters<typeof CapacitorNfc.write>[0]["records"],
  confirmOverwrite?: (message: string) => boolean | Promise<boolean>
): Promise<boolean> {
  if (!isNativeNfcAvailable()) throw new Error("NFC 기록은 iOS 또는 Android 앱에서만 사용할 수 있습니다.");

  return new Promise<boolean>((resolve, reject) => {
    let listener: { remove: () => Promise<void> } | undefined;
    let sessionListener: { remove: () => Promise<void> } | undefined;
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let handlingEvent = false;
    let scanGeneration = 0;
    let sessionActive = false;
    let approvedTagId: string | null = null;
    const tagId = (event: NfcEvent) => {
      const id = event?.tag?.id;
      return Array.isArray(id) && id.length > 0 && id.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        ? id.join(":") : null;
    };
    const stopSession = async () => {
      sessionActive = false;
      scanGeneration += 1;
      clearTimeout(scanTimer);
      const oldListener = listener;
      const oldSessionListener = sessionListener;
      listener = undefined;
      sessionListener = undefined;
      await oldListener?.remove().catch(() => undefined);
      await oldSessionListener?.remove().catch(() => undefined);
      await CapacitorNfc.stopScanning();
    };
    const finish = async (result: { written: boolean } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      await stopSession().catch(() => undefined);
      if ("error" in result) reject(result.error instanceof Error ? result.error : new Error("NFC 태그 기록에 실패했습니다."));
      else resolve(result.written);
    };
    const handleEvent = async (event: NfcEvent) => {
      if (settled || handlingEvent) return;
      handlingEvent = true;
      clearTimeout(scanTimer);

      if (approvedTagId !== null) {
        if (tagId(event) !== approvedTagId) {
          await finish({ error: new Error("확인한 NFC 태그와 다른 태그입니다. 기록하지 않았습니다. 같은 태그로 다시 시도해 주세요.") });
          return;
        }
        if (event.tag.isWritable === false) {
          await finish({ error: new Error("읽기 전용 NFC 태그에는 기록할 수 없습니다.") });
          return;
        }
      } else if (confirmOverwrite) {
        const ndefMessage = event?.tag?.ndefMessage;
        const isFormatableBlankTag = event?.type === "ndef-formatable" && ndefMessage === undefined;
        // iOS emits a generic tag event for both blank NDEF tags and failed reads.
        // Writability is reliable, but missing records alone do not prove it is empty.
        const isIosWritableUnknownTag = Capacitor.getPlatform() === "ios"
          && event?.type === "tag"
          && ndefMessage == null
          && event?.tag?.isWritable === true
          && typeof event.tag.maxSize === "number"
          && event.tag.maxSize > 0;
        if (!Array.isArray(ndefMessage) && !isFormatableBlankTag && !isIosWritableUnknownTag) {
          await finish({ error: new Error("NFC 태그의 기존 NDEF 정보를 확인하지 못해 기록하지 않았습니다.") });
          return;
        }

        if ((Array.isArray(ndefMessage) && ndefMessage.length > 0) || isIosWritableUnknownTag) {
          try {
            const requiresRescan = Capacitor.getPlatform() === "ios";
            const originalTagId = tagId(event);
            if (requiresRescan && originalTagId === null) {
              await finish({ error: new Error("NFC 태그 식별자를 확인하지 못해 기록하지 않았습니다. 태그를 다시 대주세요.") });
              return;
            }
            // Dismiss the NFC system sheet before showing confirmation. That session
            // cannot be reused after the user responds; acquire the same tag anew.
            if (requiresRescan) await stopSession();
            const message = isIosWritableUnknownTag ? productNfcUnknownMessage : productNfcOverwriteMessage;
            if (!await confirmOverwrite(requiresRescan ? `${message}\n계속하려면 확인 후 같은 태그를 다시 대세요.` : message)) {
              await finish({ written: false });
              return;
            }
            if (requiresRescan) {
              approvedTagId = originalTagId;
              handlingEvent = false;
              await startScan("기존 정보를 바꿀 같은 NFC 태그를 다시 대세요.");
              return;
            }
          } catch (error) {
            await finish({ error });
            return;
          }
        }
      }

      try {
        await CapacitorNfc.write({ allowFormat: true, records });
        await finish({ written: true });
      } catch (error) {
        await finish({ error });
      }
    };
    async function startScan(alertMessage: string) {
      const generation = ++scanGeneration;
      sessionActive = false;
      sessionListener = await CapacitorNfc.addListener("nfcSessionEnd", (event) => {
        if (generation !== scanGeneration || !sessionActive || settled || handlingEvent) return;
        if (event.reason === "userCancelled") void finish({ written: false });
        else void finish({ error: new Error("NFC 읽기 시간이 끝났습니다. 태그를 다시 대고 시도해 주세요.") });
      });
      listener = await CapacitorNfc.addListener("nfcEvent", (event) => {
        // Native NFC retains events while listeners are removed. Registration can
        // replay the previous tag before startScanning has acquired a new session.
        if (generation === scanGeneration && sessionActive) void handleEvent(event);
      });
      scanTimer = setTimeout(() => {
        void finish({ error: new Error("NFC 태그를 인식하지 못했습니다. 태그를 다시 대고 시도해 주세요.") });
      }, 90_000);
      await CapacitorNfc.startScanning({
        iosSessionType: "tag",
        invalidateAfterFirstRead: false,
        alertMessage
      });
      if (generation === scanGeneration && !settled) sessionActive = true;
    }
    void startScan("NFC 태그를 휴대폰 상단에 가까이 대세요.").catch((error) => finish({ error }));
  });
}

export async function writeAttendanceUrlToNfc(url: string) {
  await writeNdefRecordsToNfc([attendanceUrlNdefRecord(url)]);
}

export function writeProductUrlToNfc(url: string, confirmOverwrite = confirmProductNfcOverwrite) {
  return writeNdefRecordsToNfc(productNfcNdefRecords(url), confirmOverwrite);
}
