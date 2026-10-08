import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { openExternalUrl } from "../lib/commands";
import { listenForSharePointAuthentication, type SharePointAuthPrompt } from "../lib/sharePoint";
import type { ToastState } from "../types/app";

export function useSharePointAuthentication(setToast: Dispatch<SetStateAction<ToastState | null>>) {
  const [prompt, setPrompt] = useState<SharePointAuthPrompt | null>(null);
  const [authenticationReady, setAuthenticationReady] = useState(false);
  const [authenticationError, setAuthenticationError] = useState<string | null>(null);

  const openUri = useCallback((uri: string) => {
    void openExternalUrl(uri).catch((error) => {
      setToast({ id: String(Date.now()), message: `サインインページを開けません: ${String(error)}`, type: "error" });
    });
  }, [setToast]);

  const openAuthenticationPage = useCallback(() => {
    if (prompt) openUri(prompt.verificationUri);
  }, [openUri, prompt]);

  const dismissAuthentication = useCallback(() => setPrompt(null), []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForSharePointAuthentication((event) => {
      if (disposed) return;
      setPrompt(event.payload);
      openUri(event.payload.verificationUri);
    }).then((dispose) => {
      if (disposed) { dispose(); return; }
      unlisten = dispose;
      setAuthenticationReady(true);
    }).catch(() => {
      if (!disposed) setAuthenticationError("認証案内の準備に失敗しました。アプリを再起動してください。");
    });
    return () => { disposed = true; unlisten?.(); };
  }, [openUri]);

  return {
    sharePointAuthPrompt: prompt,
    openAuthenticationPage,
    dismissAuthentication,
    authenticationReady,
    authenticationError,
  };
}
