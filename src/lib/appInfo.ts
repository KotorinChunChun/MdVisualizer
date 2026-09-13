import packageMetadata from "../../package.json";
import releaseConfiguration from "../../packaging/release-config.json";

const repositoryUrl = "https://github.com/KotorinChunChun/MdVisualizer";

export const APP_INFO = {
  updatedAt: "2026-09-13",
  version: releaseConfiguration.application.publicVersion ?? packageMetadata.version,
  author: packageMetadata.author,
  readmeUrl: `${repositoryUrl}#readme`,
  releasesUrl: `${repositoryUrl}/releases`,
} as const;
