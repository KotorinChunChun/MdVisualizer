---
name: publish-msix-release
description: Plan, build, stage, publish, and verify signed MSIX and App Installer releases for stable or beta channels using a project's guarded release scripts. Use when the user asks about MSIX releases, App Installer generation, persistent signing certificates, stable/beta update channels, release-site staging, FTP publication, or published-artifact verification. Also use for release planning, review, status, and troubleshooting, but keep those requests read-only and never start tests, release builds, installer generation, staging, upload, or installation unless the user explicitly requests the corresponding operation.
---

# Publish MSIX Release

Use the project's deterministic release scripts while preserving a strict boundary between discussion and execution.

## Classify the request before running anything

Map the user's words to the narrowest authorized mode.

| User intent | Allowed mode | Required confirmation switches |
| --- | --- | --- |
| Discuss, inspect, review, plan, estimate, explain, or check status | `Plan` | None |
| Generate or rebuild MSIX/App Installer | `Build` | `-ReleaseIntentConfirmed` |
| Copy existing verified artifacts into the website tree | `Stage` | `-ReleaseIntentConfirmed` |
| Upload already staged artifacts | `Publish` | `-ReleaseIntentConfirmed -PublishConfirmed` |
| Verify existing local and published artifacts | `Verify` | None |
| Build, stage, upload, and verify a requested release | `Full` | `-ReleaseIntentConfirmed -PublishConfirmed` |

Do not infer permission for a broader mode. For example, “generate the installer” authorizes `Build`, not `Stage` or `Publish`. “Review the release setup” authorizes only `Plan` and read-only inspection.

Treat `Plan` as the default whenever intent is unclear. Ask for the missing channel or publication decision before selecting a mutating mode.

## Preflight

1. Read the repository `AGENTS.md` and the applicable requirement, implementation, and task documents.
2. Locate `packaging/release-config.json` and `scripts/publish-MarkdownViewer.ps1`.
3. If either is absent, provide a plan or implement guarded automation only when the user asked for implementation. Do not improvise a release with ad hoc commands.
4. Inspect Git status in the application and website repositories. Preserve unrelated changes and use path-scoped commits.
5. Resolve the channel explicitly as `beta` or `stable` for every non-Plan mode.
6. Read secret files only when needed for an explicitly requested publication. Never print credential values. Confirm required key names instead.
7. Read [references/release-contract.md](references/release-contract.md) when changing configuration, channel behavior, signing, staging, upload, or verification.

## Run the guarded entry point

Use `pwsh` for every PowerShell script.

Read-only plan:

```powershell
pwsh -NoProfile -File .\scripts\publish-MarkdownViewer.ps1 -Mode Plan
```

Explicit installer generation:

```powershell
pwsh -NoProfile -File .\scripts\publish-MarkdownViewer.ps1 `
  -Mode Build -Channel beta -ReleaseIntentConfirmed
```

Explicit staging of existing artifacts:

```powershell
pwsh -NoProfile -File .\scripts\publish-MarkdownViewer.ps1 `
  -Mode Stage -Channel beta -ReleaseIntentConfirmed
```

Explicit publication of staged artifacts:

```powershell
pwsh -NoProfile -File .\scripts\publish-MarkdownViewer.ps1 `
  -Mode Publish -Channel beta `
  -ReleaseIntentConfirmed -PublishConfirmed `
  -PythonPath <python-executable>
```

Read-only verification:

```powershell
pwsh -NoProfile -File .\scripts\publish-MarkdownViewer.ps1 `
  -Mode Verify -Channel beta
```

Explicit end-to-end release:

```powershell
pwsh -NoProfile -File .\scripts\publish-MarkdownViewer.ps1 `
  -Mode Full -Channel beta `
  -ReleaseIntentConfirmed -PublishConfirmed `
  -PythonPath <python-executable>
```

Obtain the Python executable from the workspace runtime or the user's configured environment. Never hard-code a transient runtime path into project configuration.

## Execute in phases

When execution is authorized:

1. Record or update the user-owned requirement and the AI implementation/task documents.
2. Run `Plan` and report the resolved version, identity, channel, and URLs before costly work.
3. Run only the authorized build/stage/publish modes.
4. After each implementation phase, run proportionate tests and commit before continuing when repository rules require it.
5. Verify MSIX identity, signer/CER match, App Installer URI, MIME types, Content-Length, and remote hashes.
6. Update the release report with commands, results, hashes, commits, and any unperformed GUI acceptance.
7. Create a local tag only when requested or required by the repository workflow. Push or create a hosted release only when explicitly requested.

## Preserve safety invariants

- Never bypass `-ReleaseIntentConfirmed` or `-PublishConfirmed`.
- Never call the underlying build, stage, or FTP scripts to avoid a guard.
- Never generate a new signing certificate when a valid configured persistent certificate exists.
- Never publish a stable link without a verified stable App Installer and package at that URL.
- Never reuse a lower or equal MSIX Package Version as a new update.
- Never expose PFX files, private keys, passwords, `.env` values, or process arguments containing secrets.
- Never install or uninstall the app as part of release verification unless the user explicitly requests installation testing.
- Apply the repository's human-input protection before any GUI automation.

If a guard blocks execution, explain which explicit authorization or configuration is missing. Do not work around it.
