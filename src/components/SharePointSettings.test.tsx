import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SharePointSettings } from "./SharePointSettings";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(cleanup);
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async command => {
    if (command === "sharepoint_connection_info") return { clientId: "embedded-id", tenant: "organizations", directProtocolRegistration: false };
    throw new Error("URL形式が不正です");
  });
});
it("直接登録の未確認を接続失敗と断定せず、組み込み設定とMSIXの違いを表示する", async () => {
  render(<SharePointSettings onOpen={vi.fn()} />);
  expect(await screen.findByText("embedded-id")).toBeTruthy();
  expect(screen.getByText("確認できませんでした（MSIXの登録は別方式です）")).toBeTruthy();
  expect(screen.getByRole("button", { name: "URLを確認して開く" }).hasAttribute("disabled")).toBe(true);
});
it("不正URLでは開かず、入力を保持して訂正後に同じ画面から再試行できる", async () => {
  const onOpen = vi.fn();
  render(<SharePointSettings onOpen={onOpen} />);
  await screen.findByText("embedded-id");
  const input = screen.getByLabelText("SharePointファイルのURL") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "https://contoso.sharepoint.com/shared" } });
  fireEvent.click(screen.getByRole("button", { name: "URLを確認して開く" }));
  await screen.findByRole("alert");
  expect(onOpen).not.toHaveBeenCalled();
  expect(input.value).toContain("/shared");
  invoke.mockResolvedValueOnce("spmd://contoso.sharepoint.com/sites/a/docs/readme.md");
  fireEvent.change(input, { target: { value: "https://contoso.sharepoint.com/sites/a/docs/readme.md" } });
  fireEvent.click(screen.getByRole("button", { name: "URLを確認して開く" }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith("spmd://contoso.sharepoint.com/sites/a/docs/readme.md"));
});
it("状態取得失敗を再確認できる", async () => {
  invoke.mockRejectedValueOnce(new Error("offline"));
  render(<SharePointSettings onOpen={vi.fn()} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "状態を再確認" }));
  expect(await screen.findByText("embedded-id")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("設定を閉じた後に届くURL検証応答で文書を開かない", async () => {
  const onOpen = vi.fn();
  const { unmount } = render(<SharePointSettings onOpen={onOpen} />);
  await screen.findByText("embedded-id");
  let finish!: (value: string) => void;
  invoke.mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText("SharePointファイルのURL"), { target: { value: "https://contoso.sharepoint.com/sites/a/docs/readme.md" } });
  fireEvent.click(screen.getByRole("button", { name: "URLを確認して開く" }));
  unmount();
  finish("spmd://contoso.sharepoint.com/sites/a/docs/readme.md");
  await Promise.resolve();
  expect(onOpen).not.toHaveBeenCalled();
});
