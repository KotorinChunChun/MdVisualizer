# MSIX release contract

Read this reference when modifying a project's release configuration or executing any stage beyond planning.

## Required project surface

The project should provide:

- `packaging/release-config.json`
- `scripts/publish-MarkdownViewer.ps1`
- a persistent-certificate-aware MSIX build script
- an App Installer template and generator
- channel-aware stage and local/public verification scripts
- a website upload mechanism whose credentials remain outside the repository

Keep deterministic project behavior in project scripts. Keep user-intent classification and cross-project workflow in the skill.

## Release configuration

The configuration should contain no secrets and should define:

- display and artifact base names
- Package Identity name
- Publisher matching the signing certificate Subject
- architecture
- persistent certificate Friendly Name
- Tauri or application version source
- release artifact directory
- static site source directory
- website project and download directory
- FTP upload script path
- public download page
- `stable` and `beta` channel directories, HTTPS base URIs, and App Installer filenames

Derive the four-part MSIX Package Version from the application version. Derive `.msix` and `.cer` filenames from the artifact name, Package Version, and architecture. Read Identity fields back from the MSIX manifest; never trust filenames alone.

## Channel contract

Stable and beta may share:

- Package Identity
- Publisher
- architecture
- persistent signing certificate

They must use distinct:

- App Installer URIs
- package URIs or directories
- website links and channel labels

An installation normally follows the App Installer URI used during installation. Stable and beta with the same Package Identity cannot be installed side by side.

Within each update line, publish only a Package Version greater than the previously published version unless an explicitly designed downgrade policy is enabled. Do not enable force-downgrade behavior casually.

## Signing contract

- Store the private key outside the repository and public web tree.
- Reuse the configured certificate while it is valid and contains a private key plus Code Signing EKU.
- Export only the public CER for client trust setup.
- Verify the MSIX signer Thumbprint equals the CER Thumbprint.
- Treat certificate replacement as a migration requiring client trust deployment and update testing.

For a self-signed certificate, document installation into the current user's Trusted People store before first installation.

## App Installer contract

Use the 2021 App Installer schema when using launch prompt/blocking attributes. Verify:

- root `Uri` equals the channel App Installer URL
- MainPackage `Uri` equals the channel MSIX URL
- Name, Publisher, Version, and ProcessorArchitecture match the MSIX Identity
- the requested update behavior is explicit

For non-blocking launch checks that apply the update after restart, use:

```xml
<OnLaunch
  HoursBetweenUpdateChecks="0"
  ShowPrompt="false"
  UpdateBlocksActivation="false" />
```

## Website contract

Serve at least:

- `.msix` as `application/msix`
- `.appinstaller` as `application/appinstaller`
- `.cer` as `application/pkix-cert`

Return a positive `Content-Length` for HEAD and GET. Use versioned package filenames so MSIX/CER may be cached immutably, and disable caching for the mutable App Installer file.

The download menu may host multiple apps. Keep each app's product page separate from the top-level menu. Show stable and beta independently, and render a channel as unavailable rather than linking to a missing or unverified artifact.

## Verification contract

Local verification should confirm:

- required site files and local links
- no private material in the publish tree
- MSIX manifest identity and version
- Authenticode signer and CER match
- App Installer schema, identity, channel URIs, and launch settings
- configured MIME mappings

Published verification should confirm:

- HTTP success
- Content-Type and Content-Length
- remote MSIX and CER SHA-256 equal staged files
- published App Installer points to the published package and expected version

Verification must not install, uninstall, build, stage, or upload anything.

## Authorization boundaries

| Operation | Expensive/local mutation | External mutation | Required explicit user intent |
| --- | --- | --- | --- |
| Plan | No | No | No |
| Build | Yes | No | Generate/build/release artifact |
| Stage | Yes | No | Stage/copy release files |
| Publish | No build | Yes | Upload/publish release |
| Verify | Network reads possible | No | Verify/check may be implicit if relevant |
| Full | Yes | Yes | End-to-end release and publication |

If a request covers only one row, do not execute a broader row.
