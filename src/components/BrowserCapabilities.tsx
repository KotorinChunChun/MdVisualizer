import { createContext, useContext } from "react";

/** Native-only commands exposed by shared preview controls. */
export interface BrowserCapabilities {
  canRunPowerShell: boolean;
  canOpenContainingFolder: boolean;
  canCopyBitmap: boolean;
  canUseCodexActions: boolean;
}

export const desktopBrowserCapabilities: BrowserCapabilities = {
  canRunPowerShell: true,
  canOpenContainingFolder: true,
  canCopyBitmap: true,
  canUseCodexActions: true,
};

export const BrowserCapabilitiesContext = createContext<BrowserCapabilities>(desktopBrowserCapabilities);

export function useBrowserCapabilities(): BrowserCapabilities {
  return useContext(BrowserCapabilitiesContext);
}
