import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { openExternalUrl } from "../lib/commands";
import { listenForSharePointAuthentication, type SharePointAuthPrompt } from "../lib/sharePoint";
import type { ToastState } from "../types/app";

export function useSharePointAuthentication(setToast: Dispatch<SetStateAction<ToastState | null>>) {
  const [prompt, setPrompt] = useState<SharePointAuthPrompt | null>(null);

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
    let unlisten: (() => void) | undefined;
    void listenForSharePointAuthentication((event) => {
      setPrompt(event.payload);
      openUri(event.payload.verificationUri);
    }).then((dispose) => { unlisten = dispose; });
    return () => { unlisten?.(); };
  }, [openUri]);

  return {
    sharePointAuthPrompt: prompt,
    openAuthenticationPage,
    dismissAuthentication,
  };
}
