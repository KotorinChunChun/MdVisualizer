import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentWebviewWindowMock, listenMock } = vi.hoisted(() => ({
  getCurrentWebviewWindowMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: getCurrentWebviewWindowMock,
}));

import { listenForSecondaryLaunches, SECONDARY_LAUNCH_EVENT } from "./secondaryLaunchEvents";

describe("secondary launch event ownership", () => {
  beforeEach(() => {
    listenMock.mockReset();
    getCurrentWebviewWindowMock.mockReset();
    getCurrentWebviewWindowMock.mockReturnValue({ listen: listenMock });
  });

  it("subscribes through only the current WebViewWindow", async () => {
    const handler = vi.fn();
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    await expect(listenForSecondaryLaunches(handler)).resolves.toBe(unlisten);

    expect(getCurrentWebviewWindowMock).toHaveBeenCalledOnce();
    expect(listenMock).toHaveBeenCalledWith(SECONDARY_LAUNCH_EVENT, handler);
  });
});
