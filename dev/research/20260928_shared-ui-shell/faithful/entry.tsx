import { createRoot } from 'react-dom/client';
import App from '../../../../src/App';
import { BrowserCapabilitiesContext, desktopBrowserCapabilities } from '../../../../web-platform/packages/editor-ui/src/components/BrowserCapabilities';
const platform = document.body.dataset.platform ?? 'desktop';
const native = platform === 'desktop' || platform === 'all';
createRoot(document.getElementById('root')!).render(<BrowserCapabilitiesContext.Provider value={native ? desktopBrowserCapabilities : { canRunPowerShell: false, canOpenContainingFolder: false, canCopyBitmap: false, canUseCodexActions: false }}><App /></BrowserCapabilitiesContext.Provider>);
