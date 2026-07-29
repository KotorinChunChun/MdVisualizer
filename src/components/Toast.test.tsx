import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("starts fading after one second and closes after two seconds", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { container } = render(<Toast toast={{ id: "notice-1", message: "完了", type: "success" }} onClose={onClose} />);
    const toast = container.querySelector(".toast")!;

    act(() => vi.advanceTimersByTime(1000));
    expect(toast.classList.contains("is-fading")).toBe(true);
    expect(screen.getByText("完了")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
