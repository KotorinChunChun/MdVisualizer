import { version } from "../../package.json";

export class WindowTitle {
  static create(screen?: string): string {
    const title = `MdVisualizer - ver ${version.replace("+beta.", ".")}`;
    return screen ? `${screen} - ${title}` : title;
  }
}
