import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXTERNAL_APPS } from "../types/settings";
import { ExternalActions } from "./ExternalActions";

describe("ExternalActions", () => {
  afterEach(cleanup);

  it("shows default primary actions and Notepad in the submenu", () => {
    render(<ExternalActions apps={DEFAULT_EXTERNAL_APPS} onExecute={vi.fn()} />);
    expect(screen.getByRole("button", { name: "フォルダー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "VS Code" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /その他/ }));
    expect(screen.getByRole("menuitem", { name: "メモ帳" })).toBeTruthy();
  });

  it("closes on focus leaving and after execution", () => {
    const onExecute = vi.fn();
    render(<><ExternalActions apps={DEFAULT_EXTERNAL_APPS} onExecute={onExecute} /><button>outside</button></>);
    fireEvent.click(screen.getByRole("button", { name: /その他/ }));
    fireEvent.focus(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /その他/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "メモ帳" }));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ builtinKind: "notepad" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("adds an in-app new-window action without putting it in the other menu", () => {
    const onOpenInNewWindow = vi.fn();
    render(<ExternalActions apps={DEFAULT_EXTERNAL_APPS} onExecute={vi.fn()} onOpenInNewWindow={onOpenInNewWindow} />);

    fireEvent.click(screen.getByRole("button", { name: "別窓で開く" }));
    expect(onOpenInNewWindow).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
