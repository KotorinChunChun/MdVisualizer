import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("starts fading after two seconds and closes after three seconds", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<Toast toast={{ id: "notice-1", message: "完了", type: "success" }} onClose={onClose} />);
    const toast = container.querySelector(".toast")!;

    act(() => vi.advanceTimersByTime(1000));
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
});
