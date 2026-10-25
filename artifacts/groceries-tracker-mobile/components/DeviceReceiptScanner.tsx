import { useEffect, useRef } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { cloudEnabled, setDeviceScanner } from "@workspace/api-client-react";

/** The embedded browser runs the same WASM OCR as the website, on this phone. */
export function DeviceReceiptScanner() {
  const webview = useRef<WebView>(null);
  const ready = useRef(false);
  const pending = useRef<{
    id: string;
    body: unknown;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
  const send = () => {
    const job = pending.current;
    if (ready.current && job)
      webview.current?.injectJavaScript(
        `window.groceryScan(${JSON.stringify(job.id)},${JSON.stringify(job.body)});true;`,
      );
  };
  useEffect(() => {
    if (!cloudEnabled()) return;
    setDeviceScanner(async (body) => {
      if (Platform.OS === "web")
        return (
          await import("@workspace/api-client-react/device-ocr")
        ).scanOnDevice(body);
      if (!webUrl)
        throw new Error(
          "The receipt scanner website is not configured in this build.",
        );
      if (pending.current)
        throw new Error("Wait for the current receipt scan to finish.");
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current = null;
          reject(
            new Error("Recognition timed out. Try a smaller or clearer image."),
          );
        }, 180000);
        pending.current = {
          id: String(Date.now()),
          body,
          resolve,
          reject,
          timer,
        };
        send();
      });
    });
    return () => {
      if (pending.current) {
        clearTimeout(pending.current.timer);
        pending.current.reject(
          new Error("Scanner closed. Your draft remains on this device."),
        );
        pending.current = null;
      }
    };
  }, [webUrl]);
  if (!cloudEnabled() || !webUrl || Platform.OS === "web") return null;
  return (
    <View
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        opacity: 0,
        overflow: "hidden",
      }}
      pointerEvents="none"
      accessibilityElementsHidden
    >
      <WebView
        ref={webview}
        source={{ uri: `${webUrl.replace(/\/$/, "")}/ocr.html` }}
        javaScriptEnabled
        originWhitelist={[new URL(webUrl).origin]}
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith(`${webUrl.replace(/\/$/, "")}/ocr.html`)
        }
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (message.ready) {
              ready.current = true;
              send();
              return;
            }
            const job = pending.current;
            if (job && job.id === message.id) {
              clearTimeout(job.timer);
              pending.current = null;
              if (message.error) job.reject(new Error(message.error));
              else job.resolve(message.result);
            }
          } catch {
            /* Ignore unrelated page messages. */
          }
        }}
      />
    </View>
  );
}
