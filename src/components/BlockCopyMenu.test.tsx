import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { BlockCopyMenu } from "./BlockCopyMenu";

afterEach(cleanup);

describe("BlockCopyMenu", () => {
  it("uses the shared code-block button class and opens copy choices", () => {
    render(<BlockCopyMenu><button type="button">TXTコピー</button></BlockCopyMenu>);
    expect(screen.getByRole("button", { name: "コピー形式を選択" })).toHaveClass("block-copy-menu");
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    expect(screen.getByRole("button", { name: "TXTコピー" })).toBeTruthy();
  });
});
