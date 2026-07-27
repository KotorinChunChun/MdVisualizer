export function getCacheBusterUrl(url: string, version: number): string {
  if (!url || url.startsWith("data:")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${version}`;
}
