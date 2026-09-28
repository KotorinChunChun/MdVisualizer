import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { CodexImageComparison, changedPixels } from "./CodexImageComparison";
afterEach(cleanup);
describe("画像差分", () => {
  it("RGBAが同じ画素を隠し透明度だけの変更も強調する", () => {
    expect([...changedPixels(new Uint8ClampedArray([1,2,3,255,1,2,3,0]),new Uint8ClampedArray([1,2,3,255,1,2,3,255]))]).toEqual([0,0,0,0,255,32,64,230]);
    expect(()=>changedPixels(new Uint8ClampedArray(4),new Uint8ClampedArray(8))).toThrow();
  });
  it("新規生成では変更前なしを示し重ね合わせを無効にする", () => {
    render(<CodexImageComparison after="data:image/png;base64,YWJj" />);
    expect(screen.getByText("変更前なし（新規生成）")).toBeTruthy();
    expect((screen.getByRole("button",{name:"重ね合わせ"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("画像形式と自然寸法を表示し上下に切り替えられる", () => {
    render(<CodexImageComparison before="data:image/png;base64,YWJj" after="data:image/jpeg;base64,YWJj" />);
    const image=screen.getByAltText("変更後の画像");Object.defineProperties(image,{naturalWidth:{value:640},naturalHeight:{value:480}});fireEvent.load(image);
    expect(screen.getByText("変更後 · JPEG · 640 × 480 px")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"上下"}));
    expect(screen.getByRole("button",{name:"上下"}).getAttribute("aria-pressed")).toBe("true");
  });
  it("入力画像が切り替わると古い寸法を表示しない", () => {
    const view = render(<CodexImageComparison after="data:image/png;base64,YWJj" />);
    const image = screen.getByAltText("変更後の画像");
    Object.defineProperties(image, { naturalWidth: { value: 640 }, naturalHeight: { value: 480 } });
    fireEvent.load(image);
    expect(screen.getByText("変更後 · PNG · 640 × 480 px")).toBeTruthy();
    view.rerender(<CodexImageComparison after="data:image/jpeg;base64,ZGVm" />);
    expect(screen.getByText("変更後 · JPEG")).toBeTruthy();
    expect(screen.queryByText(/640 × 480/)).toBeNull();
  });
});
