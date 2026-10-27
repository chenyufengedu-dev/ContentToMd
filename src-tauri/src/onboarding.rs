use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::Manager;

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub struct OnboardingState {
    pub finished: bool,
    pub celebrated: bool,
}

fn read_state(dir: &Path) -> Result<OnboardingState, String> {
    match fs::read(dir.join("onboarding.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("引导记录读取失败：{e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(OnboardingState::default()),
        Err(e) => Err(format!("引导记录读取失败：{e}")),
    }
}

#[tauri::command]
pub fn load_onboarding() -> Result<OnboardingState, String> {
    read_state(&super::data_dir()?)
}

#[tauri::command]
pub fn save_onboarding(state: OnboardingState) -> Result<(), String> {
    let dir = super::data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("引导记录保存失败：{e}"))?;
    let bytes = serde_json::to_vec(&state).map_err(|e| format!("引导记录保存失败：{e}"))?;
    let tmp = dir.join("onboarding.json.tmp");
    fs::write(&tmp, bytes).map_err(|e| format!("引导记录保存失败：{e}"))?;
    fs::rename(tmp, dir.join("onboarding.json")).map_err(|e| format!("引导记录保存失败：{e}"))
}

/// 默认目录仅在退出引导时创建；路径来自 Windows 文档目录，不接受前端任意路径。
#[tauri::command]
pub fn default_collection_folder(app: tauri::AppHandle, create: bool) -> Result<String, String> {
    let path = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("收藏库");
    if create {
        fs::create_dir_all(&path).map_err(|e| format!("收藏库创建失败：{e}"))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_record_defaults_and_saved_record_round_trips() {
        let dir =
            std::env::temp_dir().join(format!("contenttomd-onboarding-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(!read_state(&dir).unwrap().finished);
        fs::write(
            dir.join("onboarding.json"),
            br#"{"finished":true,"celebrated":true}"#,
        )
        .unwrap();
        let state = read_state(&dir).unwrap();
        assert!(state.finished && state.celebrated);
        fs::remove_file(dir.join("onboarding.json")).unwrap();
        fs::remove_dir(&dir).unwrap();
    }
}
