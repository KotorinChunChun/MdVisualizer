//! 既定アプリと外部エディターの起動、VS Codeワークスペース解決。
use crate::errors::AppError;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
#[tauri::command]
pub fn open_external_editor(app_handle: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::FileNotFound(path).to_string());
    }

    // デフォルトのOS関連付けエディタで開く (tauri-plugin-opener)
    app_handle
        .opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_containing_folder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(AppError::FileNotFound(path).to_string());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "windows"))]
    return Err("Opening a containing folder is only implemented for Windows.".into());
    Ok(())
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(AppError::FileNotFound(path).to_string());
    }
    let program = match editor.as_str() {
        "vscode" => resolve_vscode_executable()?,
        "notepad" => PathBuf::from("notepad"),
        _ => return Err("Unsupported editor.".into()),
    };
    let file = Path::new(&path);
    let (vscode_workspace, reuse_vscode_workspace) = if editor == "vscode" {
        match find_running_vscode_workspace(&program, file) {
            Some(workspace) => (Some(workspace), true),
            None => (Some(infer_vscode_workspace(file)?), false),
        }
    } else {
        (None, false)
    };
    let mut command = std::process::Command::new(&program);
    command.args(editor_arguments(
        &editor,
        file,
        vscode_workspace.as_deref(),
        reuse_vscode_workspace,
    )?);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Prevent command shims such as code.cmd from flashing a console
        // window while the GUI editor starts.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not start {}: {error}", program.display()))?;
    Ok(())
}

fn editor_arguments(
    editor: &str,
    file: &Path,
    vscode_workspace: Option<&Path>,
    reuse_vscode_workspace: bool,
) -> Result<Vec<std::ffi::OsString>, String> {
    match editor {
        "vscode" => {
            let workspace = vscode_workspace
                .ok_or_else(|| "The VS Code workspace could not be determined.".to_string())?;
            let mut arguments = Vec::with_capacity(3);
            if !reuse_vscode_workspace {
                arguments.push(std::ffi::OsString::from("--new-window"));
            }
            arguments.push(workspace.as_os_str().to_owned());
            arguments.push(file.as_os_str().to_owned());
            Ok(arguments)
        }
        "notepad" => Ok(vec![file.as_os_str().to_owned()]),
        _ => Err("Unsupported editor.".into()),
    }
}

#[derive(Debug, Deserialize)]
struct VscodeWorkspaceDescriptor {
    folder: Option<String>,
    workspace: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VscodeCodeWorkspace {
    #[serde(default)]
    folders: Vec<VscodeCodeWorkspaceFolder>,
}

#[derive(Debug, Deserialize)]
struct VscodeCodeWorkspaceFolder {
    path: Option<String>,
    uri: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct VscodeWorkspaceCandidate {
    name: String,
    launch_target: PathBuf,
    roots: Vec<PathBuf>,
}

fn find_running_vscode_workspace(program: &Path, target_file: &Path) -> Option<PathBuf> {
    let mut status_command = std::process::Command::new(program);
    status_command.arg("--status");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        status_command.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(output) = status_command.output() else {
        return None;
    };
    if !output.status.success() {
        return None;
    }

    let mut status = String::from_utf8_lossy(&output.stdout).into_owned();
    status.push_str(&String::from_utf8_lossy(&output.stderr));
    let active_names = parse_vscode_status_workspace_names(&status);
    if active_names.is_empty() {
        return None;
    }
    let Some(storage_root) = vscode_workspace_storage_root() else {
        return None;
    };
    let candidates = load_vscode_workspace_candidates(&storage_root);
    select_active_vscode_workspace(target_file, &active_names, &candidates)
}

fn parse_vscode_status_workspace_names(status: &str) -> std::collections::HashSet<String> {
    let pattern = regex::Regex::new(r"(?m)^\|\s+(?:Folder|Workspace) \((.+)\):\s*.*$")
        .expect("VS Code status pattern must compile");
    pattern
        .captures_iter(status)
        .filter_map(|capture| capture.get(1))
        .map(|name| name.as_str().trim().to_lowercase())
        .filter(|name| !name.is_empty())
        .collect()
}

fn vscode_workspace_storage_root() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Code").join("User").join("workspaceStorage"))
        .filter(|path| path.is_dir())
}

fn load_vscode_workspace_candidates(storage_root: &Path) -> Vec<VscodeWorkspaceCandidate> {
    let Ok(entries) = std::fs::read_dir(storage_root) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| std::fs::read(entry.path().join("workspace.json")).ok())
        .filter_map(|contents| serde_json::from_slice::<VscodeWorkspaceDescriptor>(&contents).ok())
        .filter_map(workspace_candidate_from_descriptor)
        .collect()
}

fn workspace_candidate_from_descriptor(
    descriptor: VscodeWorkspaceDescriptor,
) -> Option<VscodeWorkspaceCandidate> {
    if let Some(folder_uri) = descriptor.folder {
        let folder = file_uri_to_path(&folder_uri)?;
        let name = folder.file_name()?.to_string_lossy().trim().to_lowercase();
        if name.is_empty() {
            return None;
        }
        return Some(VscodeWorkspaceCandidate {
            name,
            launch_target: folder.clone(),
            roots: vec![folder],
        });
    }

    let workspace_file = file_uri_to_path(descriptor.workspace.as_deref()?)?;
    let name = workspace_file
        .file_stem()?
        .to_string_lossy()
        .trim()
        .to_lowercase();
    if name.is_empty() {
        return None;
    }
    let roots = load_code_workspace_roots(&workspace_file);
    Some(VscodeWorkspaceCandidate {
        name,
        launch_target: workspace_file,
        roots,
    })
}

fn file_uri_to_path(value: &str) -> Option<PathBuf> {
    url::Url::parse(value).ok()?.to_file_path().ok()
}

fn load_code_workspace_roots(workspace_file: &Path) -> Vec<PathBuf> {
    let Ok(contents) = std::fs::read_to_string(workspace_file) else {
        return Vec::new();
    };
    let Ok(workspace) = serde_json::from_str::<VscodeCodeWorkspace>(&normalize_jsonc(&contents))
    else {
        return Vec::new();
    };
    let base = workspace_file.parent().unwrap_or_else(|| Path::new(""));
    workspace
        .folders
        .into_iter()
        .filter_map(|folder| {
            if let Some(uri) = folder.uri {
                return file_uri_to_path(&uri);
            }
            let path = PathBuf::from(folder.path?);
            Some(if path.is_absolute() {
                path
            } else {
                base.join(path)
            })
        })
        .collect()
}

fn normalize_jsonc(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(character) = characters.next() {
        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            output.push(character);
            continue;
        }
        if character == '/' && characters.peek() == Some(&'/') {
            characters.next();
            for comment_character in characters.by_ref() {
                if comment_character == '\n' {
                    output.push('\n');
                    break;
                }
            }
            continue;
        }
        if character == '/' && characters.peek() == Some(&'*') {
            characters.next();
            let mut previous = '\0';
            for comment_character in characters.by_ref() {
                if previous == '*' && comment_character == '/' {
                    break;
                }
                previous = comment_character;
            }
            continue;
        }
        output.push(character);
    }
    strip_json_trailing_commas(&output)
}

fn strip_json_trailing_commas(value: &str) -> String {
    let characters = value.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(value.len());
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in characters.iter().copied().enumerate() {
        if in_string {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            in_string = true;
            output.push(character);
            continue;
        }
        if character == ',' {
            let next = characters[index + 1..]
                .iter()
                .copied()
                .find(|next| !next.is_whitespace());
            if matches!(next, Some(']') | Some('}')) {
                continue;
            }
        }
        output.push(character);
    }
    output
}

fn unambiguous_active_workspaces(
    active_names: &std::collections::HashSet<String>,
    candidates: &[VscodeWorkspaceCandidate],
) -> Vec<VscodeWorkspaceCandidate> {
    let mut grouped = std::collections::HashMap::<
        String,
        std::collections::HashMap<String, VscodeWorkspaceCandidate>,
    >::new();
    for candidate in candidates {
        if active_names.contains(&candidate.name) {
            grouped
                .entry(candidate.name.clone())
                .or_default()
                .entry(path_identity(&candidate.launch_target))
                .or_insert_with(|| candidate.clone());
        }
    }
    grouped
        .into_values()
        .filter(|workspaces| workspaces.len() == 1)
        .filter_map(|workspaces| workspaces.into_values().next())
        .collect()
}

fn select_active_vscode_workspace(
    target_file: &Path,
    active_names: &std::collections::HashSet<String>,
    candidates: &[VscodeWorkspaceCandidate],
) -> Option<PathBuf> {
    unambiguous_active_workspaces(active_names, candidates)
        .into_iter()
        .filter_map(|candidate| {
            let depth = candidate
                .roots
                .iter()
                .filter(|root| path_is_within(target_file, root))
                .map(|root| path_depth(root))
                .max()?;
            Some((depth, candidate.launch_target))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, launch_target)| launch_target)
}

fn infer_vscode_workspace(target_file: &Path) -> Result<PathBuf, String> {
    let directory = target_file
        .parent()
        .ok_or_else(|| "The file has no containing directory.".to_string())?;
    let mut git_root = None;
    let mut vscode_root = None;
    let mut project_root = None;
    let mut weak_root = None;
    for ancestor in directory.ancestors() {
        if is_user_home(ancestor) {
            break;
        }
        if let Some(workspace_file) = code_workspace_containing(ancestor, target_file) {
            return Ok(workspace_file);
        }
        if git_root.is_none() && ancestor.join(".git").exists() {
            git_root = Some(ancestor.to_path_buf());
        }
        if vscode_root.is_none() && ancestor.join(".vscode").is_dir() {
            vscode_root = Some(ancestor.to_path_buf());
        }
        if project_root.is_none() && has_project_marker(ancestor) {
            project_root = Some(ancestor.to_path_buf());
        }
        if weak_root.is_none()
            && (ancestor.join(".claude").is_dir() || ancestor.join("AGENTS.md").is_file())
        {
            weak_root = Some(ancestor.to_path_buf());
        }
    }
    Ok(git_root
        .or(vscode_root)
        .or(project_root)
        .or(weak_root)
        .unwrap_or_else(|| directory.to_path_buf()))
}

fn code_workspace_containing(directory: &Path, target_file: &Path) -> Option<PathBuf> {
    let mut workspace_files = std::fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("code-workspace"))
        .collect::<Vec<_>>();
    workspace_files.sort();
    workspace_files.into_iter().find(|workspace_file| {
        load_code_workspace_roots(workspace_file)
            .iter()
            .any(|root| path_is_within(target_file, root))
    })
}

fn has_project_marker(directory: &Path) -> bool {
    const MARKERS: &[&str] = &[
        "Cargo.toml",
        "package.json",
        "pnpm-workspace.yaml",
        "pyproject.toml",
        "go.mod",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "Gemfile",
        "composer.json",
        "mix.exs",
        "deno.json",
        "deno.jsonc",
    ];
    MARKERS
        .iter()
        .any(|marker| directory.join(marker).is_file())
        || std::fs::read_dir(directory).is_ok_and(|entries| {
            entries.filter_map(Result::ok).any(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("sln")
            })
        })
}

fn is_user_home(path: &Path) -> bool {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .is_some_and(|home| path_identity(&home) == path_identity(path))
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let path = path_identity(path);
    let root = path_identity(root);
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|suffix| suffix.starts_with('\\'))
}

fn path_depth(path: &Path) -> usize {
    path_identity(path)
        .split('\\')
        .filter(|component| !component.is_empty())
        .count()
}

fn path_identity(path: &Path) -> String {
    let normalized = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let value = normalized.to_string_lossy().replace('/', "\\");
    #[cfg(target_os = "windows")]
    let value = value.to_lowercase();
    value.trim_end_matches('\\').to_string()
}

fn resolve_vscode_executable() -> Result<PathBuf, String> {
    let path_candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .flat_map(|directory| vscode_path_candidates(&directory))
                .collect()
        })
        .unwrap_or_default();
    let install_candidates: Vec<PathBuf> = vscode_install_directories()
        .into_iter()
        .flat_map(|directory| vscode_path_candidates(&directory))
        .collect();
    install_candidates
        .into_iter()
        .chain(path_candidates)
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "VS Code が見つかりません。PATH または標準のインストール先を確認してください。".into()
        })
}

fn vscode_path_candidates(directory: &Path) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        vec![
            directory.join("Code.exe"),
            directory.join("code.exe"),
            directory.join("code.cmd"),
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![directory.join("code")]
    }
}

fn vscode_install_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        directories.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Microsoft VS Code"),
        );
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(program_files) = std::env::var_os(variable) {
            directories.push(PathBuf::from(program_files).join("Microsoft VS Code"));
        }
    }
    directories
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vscode_lookup_checks_path_and_install_layout_executables() {
        let candidates = vscode_path_candidates(Path::new("C:/tools/vscode/bin"));
        #[cfg(target_os = "windows")]
        {
            assert!(candidates.ends_with(&[
                PathBuf::from("C:/tools/vscode/bin/Code.exe"),
                PathBuf::from("C:/tools/vscode/bin/code.exe"),
                PathBuf::from("C:/tools/vscode/bin/code.cmd"),
            ]));
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(candidates, vec![PathBuf::from("C:/tools/vscode/bin/code")]);
        }
    }

    #[test]
    fn vscode_reuses_a_confirmed_containing_workspace() {
        let file = Path::new("C:/project/docs/readme.md");
        let workspace = Path::new("C:/project");
        let arguments = editor_arguments("vscode", file, Some(workspace), true).unwrap();

        assert_eq!(
            arguments,
            vec![
                std::ffi::OsString::from("C:/project"),
                std::ffi::OsString::from("C:/project/docs/readme.md")
            ]
        );
    }

    #[test]
    fn vscode_forces_a_new_window_without_a_confirmed_match() {
        let file = Path::new("C:/docs/readme.md");
        let workspace = Path::new("C:/workspace");
        let arguments = editor_arguments("vscode", file, Some(workspace), false).unwrap();

        assert_eq!(
            arguments,
            vec![
                std::ffi::OsString::from("--new-window"),
                std::ffi::OsString::from("C:/workspace"),
                std::ffi::OsString::from("C:/docs/readme.md"),
            ],
        );
    }

    #[test]
    fn parses_every_workspace_name_from_vscode_status() {
        let status = r#"Workspace Stats:
|  Window (readme.md - first - Visual Studio Code)
|    Folder (first): 10 files
|  Window (notes.md - second - Visual Studio Code)
|    Folder (Second): 20 files
"#;

        assert_eq!(
            parse_vscode_status_workspace_names(status),
            std::collections::HashSet::from(["first".into(), "second".into()]),
        );
    }

    #[test]
    fn selects_the_deepest_unambiguous_workspace_containing_the_file() {
        let active =
            std::collections::HashSet::from(["docs".into(), "project".into(), "ambiguous".into()]);
        let candidates = vec![
            VscodeWorkspaceCandidate {
                name: "project".into(),
                launch_target: PathBuf::from("C:/work/project"),
                roots: vec![PathBuf::from("C:/work/project")],
            },
            VscodeWorkspaceCandidate {
                name: "docs".into(),
                launch_target: PathBuf::from("C:/work/project/docs"),
                roots: vec![PathBuf::from("C:/work/project/docs")],
            },
            VscodeWorkspaceCandidate {
                name: "ambiguous".into(),
                launch_target: PathBuf::from("C:/work/project/docs"),
                roots: vec![PathBuf::from("C:/work/project/docs")],
            },
            VscodeWorkspaceCandidate {
                name: "ambiguous".into(),
                launch_target: PathBuf::from("D:/other/ambiguous"),
                roots: vec![PathBuf::from("D:/other/ambiguous")],
            },
        ];

        assert_eq!(
            select_active_vscode_workspace(
                Path::new("C:/work/project/docs/manual/readme.md"),
                &active,
                &candidates,
            ),
            Some(PathBuf::from("C:/work/project/docs")),
        );
    }

    #[test]
    fn loads_folder_paths_from_vscode_workspace_storage() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("ExampleWorkspace");
        let entry = root.path().join("workspace-id");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&entry).unwrap();
        let folder_uri = url::Url::from_directory_path(&folder).unwrap();
        std::fs::write(
            entry.join("workspace.json"),
            serde_json::json!({ "folder": folder_uri.as_str() }).to_string(),
        )
        .unwrap();

        assert_eq!(
            load_vscode_workspace_candidates(root.path()),
            vec![VscodeWorkspaceCandidate {
                name: "exampleworkspace".into(),
                launch_target: folder.clone(),
                roots: vec![folder],
            }],
        );
    }

    #[test]
    fn loads_multi_root_code_workspace_paths_with_json_comments() {
        let root = tempfile::tempdir().unwrap();
        let workspace_file = root.path().join("team.code-workspace");
        let first = root.path().join("first");
        let second = root.path().join("second");
        let storage_entry = root.path().join("workspace-id");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::create_dir_all(&storage_entry).unwrap();
        std::fs::write(
            &workspace_file,
            r#"{
                // VS Code workspace folders
                "folders": [{ "path": "first" }, { "path": "second" }],
            }"#,
        )
        .unwrap();
        let workspace_uri = url::Url::from_file_path(&workspace_file).unwrap();
        std::fs::write(
            storage_entry.join("workspace.json"),
            serde_json::json!({ "workspace": workspace_uri.as_str() }).to_string(),
        )
        .unwrap();

        assert_eq!(
            load_vscode_workspace_candidates(root.path()),
            vec![VscodeWorkspaceCandidate {
                name: "team".into(),
                launch_target: workspace_file,
                roots: vec![first, second],
            }],
        );
    }

    #[test]
    fn infers_the_git_root_above_nearer_fallback_markers() {
        let root = tempfile::tempdir().unwrap();
        let repository = root.path().join("repository");
        let docs = repository.join("docs");
        let file = docs.join("manual").join("readme.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(repository.join(".git"), "gitdir: elsewhere").unwrap();
        std::fs::create_dir_all(docs.join(".vscode")).unwrap();

        assert_eq!(infer_vscode_workspace(&file).unwrap(), repository);
    }

    #[test]
    fn explicit_code_workspace_has_priority_when_it_contains_the_file() {
        let root = tempfile::tempdir().unwrap();
        let repository = root.path().join("repository");
        let file = repository.join("docs").join("readme.md");
        let workspace_file = repository.join("documentation.code-workspace");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "# Documentation").unwrap();
        std::fs::create_dir_all(repository.join(".git")).unwrap();
        std::fs::write(&workspace_file, r#"{ "folders": [{ "path": "docs" }] }"#).unwrap();

        assert_eq!(infer_vscode_workspace(&file).unwrap(), workspace_file);
    }

    #[test]
    fn project_manifest_is_used_when_no_stronger_marker_exists() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        let file = project.join("docs").join("readme.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "# Documentation").unwrap();
        std::fs::write(project.join("package.json"), "{}").unwrap();

        assert_eq!(infer_vscode_workspace(&file).unwrap(), project);
    }

}
