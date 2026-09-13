export function getCacheBusterUrl(url: string, version: number): string {
  // Object URLs are opaque identifiers. Adding a query string produces a
  // different, invalid resource (notably for ZIP assets in the Web build).
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${version}`;
}
