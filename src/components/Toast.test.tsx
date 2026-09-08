import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("stays fully visible for three seconds and closes after fading", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<Toast toast={{ id: "notice-1", message: "完了", type: "success" }} onClose={onClose} />);
    const toast = container.querySelector(".toast")!;

    act(() => vi.advanceTimersByTime(2000));
    expect(toast.classList.contains("is-fading")).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(toast.classList.contains("is-fading")).toBe(true);
    expect(screen.getByText("完了")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("runs the optional toast action", async () => {
    const onAction = vi.fn();
    render(<Toast toast={{ id: "notice-2", message: "コピーしました", type: "success", actionLabel: "ファイルとしてコピー", onAction }} onClose={vi.fn()} />);
    screen.getByRole("button", { name: "ファイルとしてコピー" }).click();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("offers multiple quick actions and keeps an actionable toast visible longer", () => {
    vi.useFakeTimers();
    const csv = vi.fn();
    const tsv = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<Toast toast={{ id: "notice-actions", message: "コピー済み", type: "success", actions: [
      { label: "CSVでコピー", onAction: csv },
      { label: "TSVでコピー", onAction: tsv },
    ] }} onClose={onClose} />);

    screen.getByRole("button", { name: "CSVでコピー" }).click();
    screen.getByRole("button", { name: "TSVでコピー" }).click();
    expect(csv).toHaveBeenCalledOnce();
    expect(tsv).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(4000));
    expect(container.querySelector(".toast")?.classList.contains("is-fading")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("opens the save folder when the staged-file message is clicked or activated from the keyboard", () => {
    const onMessageClick = vi.fn();
    render(<Toast toast={{ id: "notice-3", message: "diagram.drawio を一時ステージしました", type: "success", onMessageClick }} onClose={vi.fn()} />);
    const message = screen.getByRole("button", { name: "diagram.drawio を一時ステージしました" });

    message.click();
    expect(onMessageClick).toHaveBeenCalledTimes(1);
    message.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onMessageClick).toHaveBeenCalledTimes(2);
  });
});
