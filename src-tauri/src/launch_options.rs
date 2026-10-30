//! 管理用引数の値を文書として開かないための起動境界。
use std::path::PathBuf;
use tauri::Manager;

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct LaunchOptions {
    pub documents: Vec<String>,
    pub settings_dir: Option<PathBuf>,
    pub origin: String,
}

impl LaunchOptions {
    pub fn isolation_key(&self) -> Option<String> {
        use sha2::{Digest, Sha256};
        self.settings_dir.as_ref().map(|path| {
            let normalized = path.to_string_lossy().replace('/', "\\").to_lowercase();
            format!("{:x}", Sha256::digest(normalized.as_bytes()))[..16].to_string()
        })
    }

    pub fn management_id(&self) -> String {
        self.management_id_for(package_family().as_deref())
    }

    fn management_id_for(&self, family: Option<&str>) -> String {
        use sha2::{Digest, Sha256};
        if let Some(key) = self.isolation_key() { return format!("md-visualizer-{key}"); }
        family.map(|value| format!("md-visualizer.{:x}", Sha256::digest(value.as_bytes())))
            .unwrap_or_else(|| "md-visualizer".into())
    }

    pub fn parse(arguments: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let mut options = Self { origin: "standalone".into(), ..Self::default() };
        let mut args = arguments.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--settings-dir" => {
                    let value = args.next().filter(|v| !v.is_empty() && !v.starts_with('-'))
                        .ok_or("--settings-dirにフォルダーを指定してください。")?;
                    options.settings_dir = Some(std::path::absolute(value).map_err(|e| e.to_string())?);
                }
                "--launch-origin" => {
                    let value = args.next().ok_or("--launch-originに起動経路を指定してください。")?;
                    if !matches!(value.as_str(), "host_manual" | "standalone") {
                        return Err("MdVisualizerは手動起動専用です。".into());
                    }
                    options.origin = value;
                }
                "--startup" | "--hidden" => return Err("MdVisualizerは常駐・無表示起動に対応していません。".into()),
                "--" => { options.documents.extend(args); break; }
                _ => options.documents.push(arg),
            }
        }
        Ok(options)
    }
}

pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.state::<LaunchOptions>().settings_dir.clone()
        .map(Ok).unwrap_or_else(|| app.path().app_data_dir().map_err(|e| e.to_string()))
}

pub struct WindowTitle;
pub fn product_version() -> String {
    env!("CARGO_PKG_VERSION").replace("+beta.", ".")
}

#[cfg(windows)]
fn package_family() -> Option<String> {
    #[link(name = "kernel32")]
    extern "system" { fn GetCurrentPackageFamilyName(length: *mut u32, name: *mut u16) -> i32; }
    let mut length = 0;
    if unsafe { GetCurrentPackageFamilyName(&mut length, std::ptr::null_mut()) } != 122 || !(2..=256).contains(&length) { return None; }
    let mut buffer = vec![0u16; length as usize];
    if unsafe { GetCurrentPackageFamilyName(&mut length, buffer.as_mut_ptr()) } != 0 { return None; }
    String::from_utf16(&buffer[..length as usize - 1]).ok()
}
#[cfg(not(windows))]
fn package_family() -> Option<String> { None }

impl WindowTitle {
    pub fn create(screen: Option<&str>) -> String {
        let base = format!("MdVisualizer - ver {}", product_version());
        screen.map(|name| format!("{name} - {base}")).unwrap_or(base)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separates_option_values_from_documents() {
        let options = LaunchOptions::parse(["--settings-dir", "settings.md", "--launch-origin", "host_manual", "文書.md"].map(String::from)).unwrap();
        assert_eq!(options.documents, ["文書.md"]);
        assert!(options.settings_dir.unwrap().is_absolute());
        assert_eq!(options.origin, "host_manual");
    }
    #[test]
    fn rejects_background_start_and_missing_or_invalid_values() {
        for args in [vec!["--startup"], vec!["--hidden"], vec!["--settings-dir"], vec!["--launch-origin"], vec!["--launch-origin", "direct_task"]] {
            assert!(LaunchOptions::parse(args.into_iter().map(String::from)).is_err());
        }
        let release: serde_json::Value = serde_json::from_str(include_str!("../../packaging/release-config.json")).unwrap();
        let version = release["application"]["msixVersion"].as_str().unwrap();
        assert_eq!(WindowTitle::create(None), format!("MdVisualizer - ver {version}"));
    }
    #[test]
    fn isolates_management_by_settings_directory_without_changing_normal_identity() {
        let normal = LaunchOptions::default();
        assert_eq!(normal.management_id_for(None), "md-visualizer");
        let packaged = normal.management_id_for(Some("com.mdvisualizer.viewer_xtxrnffqrdk4w"));
        assert!(packaged.starts_with("md-visualizer."));
        assert_eq!(packaged.len(), "md-visualizer.".len() + 64);
        assert_ne!(packaged, normal.management_id_for(Some("other_family")));
        let first = LaunchOptions { settings_dir: Some(PathBuf::from("C:/test/settings")), ..normal.clone() };
        let same = LaunchOptions { settings_dir: Some(PathBuf::from("c:\\TEST\\settings")), ..normal.clone() };
        let other = LaunchOptions { settings_dir: Some(PathBuf::from("C:/test/other")), ..normal };
        assert_eq!(first.management_id(), same.management_id());
        assert_ne!(first.management_id(), other.management_id());
        assert_eq!(first.management_id().len(), "md-visualizer-".len() + 16);
    }
}
