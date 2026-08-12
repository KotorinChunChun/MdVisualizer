import packageMetadata from "../../package.json";

const repositoryUrl = "https://github.com/KotorinChunChun/MarkdownViewer";

export const APP_INFO = {
  updatedAt: "2026-08-13",
  version: packageMetadata.version,
  author: packageMetadata.author,
  readmeUrl: `${repositoryUrl}#readme`,
  releasesUrl: `${repositoryUrl}/releases`,
} as const;
