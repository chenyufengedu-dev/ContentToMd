use std::{fs, io::ErrorKind, path::Path};

/// 不启动 WebView 或单实例插件，避免卸载清理被转交给正在运行的窗口。
pub fn run() -> Result<(), String> {
    let data = super::data_dir()?;
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .map_err(|_| "无法读取软件标识。")?;
    let id = config["identifier"].as_str().ok_or("找不到软件标识。")?;
    let roaming = data.parent().ok_or("找不到软件数据目录。")?.join(id);
    let local = std::path::PathBuf::from(
        std::env::var_os("LOCALAPPDATA").ok_or("找不到 LOCALAPPDATA 目录。")?,
    )
    .join(id);
    clean(&data, &[&roaming, &local], || {
        super::config_store::clear_secrets(&data)
    })
}

fn clean(
    data: &Path,
    caches: &[&Path],
    clear_secrets: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let json = match fs::read_to_string(data.join("config.json")) {
        Ok(json) => Some(json),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(_) => return Err("无法读取配置，未清理软件数据。".into()),
    };
    let config: serde_json::Value = json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| "配置损坏，无法确认收藏库位置，未清理软件数据。")?
        .unwrap_or_default();
    let vault = config.get("vaultPath").and_then(|value| value.as_str());
    let vault = vault
        .filter(|value| !value.is_empty())
        .map(fs::canonicalize)
        .transpose()
        .or_else(|e| {
            if e.kind() == ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(e)
            }
        })
        .map_err(|_| "无法确认收藏库位置，未清理软件数据。")?;
    let dirs: Vec<_> = std::iter::once(data)
        .chain(caches.iter().copied())
        .collect();
    // 异常嵌套时停止，而不是把收藏库当作软件数据递归删除。
    if let Some(vault) = vault {
        for dir in &dirs {
            match fs::canonicalize(dir) {
                Ok(dir) if vault.starts_with(&dir) || dir.starts_with(&vault) => {
                    return Err(
                        "收藏库与软件数据目录重叠，请先移出收藏库并在设置中选择新位置，再卸载。"
                            .into(),
                    );
                }
                Ok(_) => {}
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(_) => return Err("无法确认软件数据目录，未清理软件数据。".into()),
            }
        }
    }
    clear_secrets()?;
    // 最后删业务配置，缓存清理失败时仍可重试并核对收藏库边界。
    for dir in caches.iter().copied().chain(std::iter::once(data)) {
        match fs::remove_dir_all(dir) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(_) => return Err("软件数据未清理完成，请关闭软件后重新卸载。".into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninstall_cleans_data_and_credentials_but_preserves_vault() {
        let temp = super::super::tests::TempVault::new("uninstall");
        let data = temp.0.join("data");
        let cache = temp.0.join("cache");
        let vault = temp.0.join("vault");
        fs::create_dir_all(data.join("prompts")).unwrap();
        fs::create_dir_all(&cache).unwrap();
        fs::create_dir_all(vault.join("领域")).unwrap();
        fs::write(vault.join("领域/笔记.md"), "用户笔记").unwrap();
        fs::write(
            data.join("config.json"),
            serde_json::json!({"vaultPath":vault}).to_string(),
        )
        .unwrap();
        fs::write(data.join("prompts/custom.md"), "指令").unwrap();
        fs::write(data.join("onboarding.json"), "{}").unwrap();
        fs::write(cache.join("state.json"), "{}").unwrap();
        let deleted = std::cell::Cell::new(false);
        clean(&data, &[&cache], || {
            deleted.set(true);
            Ok(())
        })
        .unwrap();
        assert!(deleted.get());
        assert!(!data.exists());
        assert!(!cache.exists());
        assert_eq!(
            fs::read_to_string(vault.join("领域/笔记.md")).unwrap(),
            "用户笔记"
        );
        clean(&data, &[&cache], || Ok(())).unwrap();
    }

    #[test]
    fn uninstall_refuses_overlapping_vault_or_failed_credentials() {
        let temp = super::super::tests::TempVault::new("uninstall-protect");
        let data = temp.0.join("data");
        let vault = data.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let config = data.join("config.json");
        fs::write(&config, serde_json::json!({"vaultPath":vault}).to_string()).unwrap();
        assert!(clean(&data, &[], || panic!("不应删除凭据")).is_err());
        assert!(vault.exists());
        fs::write(&config, "{}").unwrap();
        assert!(clean(&data, &[], || Err("模拟凭据删除失败".into())).is_err());
        assert!(config.exists());
        fs::write(&config, "broken-json").unwrap();
        assert!(clean(&data, &[], || panic!("不应删除凭据")).is_err());
        assert!(config.exists());
    }
}
