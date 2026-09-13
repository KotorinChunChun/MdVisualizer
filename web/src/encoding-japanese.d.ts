declare module "encoding-japanese" {
  const Encoding: { detect(data: number[], encodings?: string[]): string; convert(input: string | number[], options: { to: string; from: string; type: "array" }): number[]; convert(input: string | number[], options: { to: string; from: string; type: "string" }): string };
  export default Encoding;
}
