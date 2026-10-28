use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path, sync::Mutex};

static CONFIG_LOCK: Mutex<()> = Mutex::new(());

struct WindowsSecrets(keyring::Entry);

impl Secrets for WindowsSecrets {
    fn read(&self) -> Result<Option<String>, String> {
        match self.0.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法从 Windows 凭据管理器读取密钥，请稍后重试。".into()),
        }
    }
    fn write(&self, value: Option<&str>) -> Result<(), String> {
        let result = match value {
            Some(value) => self.0.set_password(value),
            None => match self.0.delete_credential() {
                Err(keyring::Error::NoEntry) => Ok(()),
                result => result,
            },
        };
        result.map_err(|_| "无法保存到 Windows 凭据管理器，原配置未删除，请稍后重试。".into())
    }
}

fn windows_secrets(dir: &Path) -> Result<WindowsSecrets, String> {
    // 凭据随配置目录隔离，测试安装重定向 APPDATA 时不会碰正式用户的密钥。
    let account = dir.to_string_lossy().to_lowercase();
    keyring::Entry::new("ContentToMd", &account)
        .map(WindowsSecrets)
        .map_err(|_| "无法打开 Windows 凭据管理器。".into())
}

pub fn load(dir: &Path) -> Result<Option<String>, String> {
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| "配置正忙，请重启软件后重试。")?;
    load_at(dir, &windows_secrets(dir)?)
}

pub fn save(dir: &Path, json: &str) -> Result<(), String> {
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| "配置正忙，请重启软件后重试。")?;
    save_at(dir, json, &windows_secrets(dir)?)
}

trait Secrets {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: Option<&str>) -> Result<(), String>;
}

fn parse(json: &str) -> Result<Value, String> {
    let value: Value =
        serde_json::from_str(json).map_err(|_| "配置文件格式不正确，请检查配置文件。")?;
    if !value.is_object() {
        return Err("配置文件格式不正确，请检查配置文件。".into());
    }
    Ok(value)
}

fn take_keys(config: &mut Value) -> Result<BTreeMap<String, String>, String> {
    let mut keys = BTreeMap::new();
    if let Some(services) = config.get_mut("services").and_then(Value::as_object_mut) {
        for (kind, service) in services {
            if let Some(service) = service.as_object_mut() {
                if let Some(key) = service.remove("apiKey") {
                    let key = key.as_str().ok_or("配置中的密钥格式不正确。")?;
                    keys.insert(kind.clone(), key.to_owned());
                }
            }
        }
    }
    Ok(keys)
}

fn load_at(dir: &Path, secrets: &impl Secrets) -> Result<Option<String>, String> {
    let json = match fs::read_to_string(dir.join("config.json")) {
        Ok(json) => json,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("无法读取配置文件：{e}")),
    };
    let mut config = parse(&json)?;
    let legacy = take_keys(&mut config)?;
    let previous = secrets.read()?;
    let mut keys: BTreeMap<String, String> = match &previous {
        Some(json) => serde_json::from_str(json).map_err(|_| "凭据中的密钥格式不正确。")?,
        None => BTreeMap::new(),
    };
    if !legacy.is_empty() {
        keys.extend(legacy);
        persist(dir, &config, &keys, previous.as_deref(), secrets)?;
    }
    if let Some(services) = config.get_mut("services").and_then(Value::as_object_mut) {
        for (kind, service) in services {
            if let Some(service) = service.as_object_mut() {
                service.insert(
                    "apiKey".into(),
                    keys.get(kind).cloned().unwrap_or_default().into(),
                );
            }
        }
    }
    Ok(Some(config.to_string()))
}

fn save_at(dir: &Path, json: &str, secrets: &impl Secrets) -> Result<(), String> {
    let mut config = parse(json)?;
    let keys = take_keys(&mut config)?;
    let previous = secrets.read()?;
    persist(dir, &config, &keys, previous.as_deref(), secrets)
}

fn persist(
    dir: &Path,
    config: &Value,
    keys: &BTreeMap<String, String>,
    previous: Option<&str>,
    secrets: &impl Secrets,
) -> Result<(), String> {
    let keys: BTreeMap<_, _> = keys.iter().filter(|(_, value)| !value.is_empty()).collect();
    let encoded = serde_json::to_string(&keys).map_err(|_| "无法保存密钥。")?;
    let json = serde_json::to_string_pretty(config).map_err(|_| "无法保存配置。")?;
    fs::create_dir_all(dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    secrets.write(if keys.is_empty() {
        None
    } else {
        Some(&encoded)
    })?;
    if let Err(error) = write_config(dir, &json) {
        if secrets.write(previous).is_err() {
            return Err(format!(
                "{error}；密钥回退也失败了，请在设置中重新保存密钥。"
            ));
        }
        return Err(error);
    }
    Ok(())
}

fn write_config(dir: &Path, json: &str) -> Result<(), String> {
    let tmp = dir.join("config.json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("无法写入配置文件：{e}"))?;
    fs::rename(tmp, dir.join("config.json")).map_err(|e| format!("无法写入配置文件：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::RefCell,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    #[derive(Default)]
    struct FakeSecrets {
        value: RefCell<Option<String>>,
        fail_write: bool,
        fail_read: bool,
    }
    impl Secrets for FakeSecrets {
        fn read(&self) -> Result<Option<String>, String> {
            if self.fail_read {
                return Err("模拟凭据读取失败".into());
            }
            Ok(self.value.borrow().clone())
        }
        fn write(&self, value: Option<&str>) -> Result<(), String> {
            if self.fail_write {
                return Err("模拟凭据写入失败".into());
            }
            *self.value.borrow_mut() = value.map(str::to_owned);
            Ok(())
        }
    }
    struct TempConfig(PathBuf);
    impl TempConfig {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "contenttomd-config-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempConfig {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    const LEGACY: &str = r#"{"schema":1,"vaultPath":"test-vault","services":{"text":{"model":"test-text","apiKey":"test-only-text"},"vision":{"apiKey":"test-only-vision"},"asr":{"apiKey":""}}}"#;

    #[test]
    fn legacy_config_migrates_then_reloads_without_plaintext() {
        let dir = TempConfig::new();
        let secrets = FakeSecrets::default();
        fs::write(dir.0.join("config.json"), LEGACY).unwrap();
        let loaded: serde_json::Value =
            serde_json::from_str(&load_at(&dir.0, &secrets).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["services"]["text"]["apiKey"], "test-only-text");
        let disk = fs::read_to_string(dir.0.join("config.json")).unwrap();
        assert!(!disk.contains("apiKey"));
        assert!(!disk.contains("test-only"));
        assert!(!dir.0.join("config.json.tmp").exists());
        let again: serde_json::Value =
            serde_json::from_str(&load_at(&dir.0, &secrets).unwrap().unwrap()).unwrap();
        assert_eq!(again, loaded);
        assert_eq!(again["services"]["vision"]["apiKey"], "test-only-vision");
        assert_eq!(again["vaultPath"], "test-vault");
    }

    #[test]
    fn credential_failure_preserves_legacy_file() {
        let dir = TempConfig::new();
        let secrets = FakeSecrets {
            fail_write: true,
            ..Default::default()
        };
        fs::write(dir.0.join("config.json"), LEGACY).unwrap();
        assert!(load_at(&dir.0, &secrets).is_err());
        assert_eq!(
            fs::read_to_string(dir.0.join("config.json")).unwrap(),
            LEGACY
        );
    }

    #[test]
    fn save_replaces_and_clears_keys_without_plaintext() {
        let dir = TempConfig::new();
        let secrets = FakeSecrets::default();
        save_at(&dir.0, LEGACY, &secrets).unwrap();
        let mut config: serde_json::Value =
            serde_json::from_str(&load_at(&dir.0, &secrets).unwrap().unwrap()).unwrap();
        config["services"]["text"]["apiKey"] = "changed-test-key".into();
        config["services"]["vision"]["apiKey"] = "".into();
        save_at(&dir.0, &config.to_string(), &secrets).unwrap();
        let loaded: serde_json::Value =
            serde_json::from_str(&load_at(&dir.0, &secrets).unwrap().unwrap()).unwrap();
        assert_eq!(loaded, config);
        let disk = fs::read_to_string(dir.0.join("config.json")).unwrap();
        assert!(!disk.contains("apiKey"));
        assert!(!disk.contains("changed-test-key"));
    }

    #[test]
    fn missing_config_does_not_access_credentials() {
        let dir = TempConfig::new();
        assert_eq!(
            load_at(
                &dir.0,
                &FakeSecrets {
                    fail_read: true,
                    ..Default::default()
                }
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn failed_file_commit_restores_previous_credentials_and_config() {
        let dir = TempConfig::new();
        let secrets = FakeSecrets::default();
        save_at(&dir.0, LEGACY, &secrets).unwrap();
        let old_file = fs::read(dir.0.join("config.json")).unwrap();
        let old_secret = secrets.read().unwrap();
        fs::create_dir(dir.0.join("config.json.tmp")).unwrap();
        let changed = LEGACY.replace("test-only-text", "replacement-test-key");
        assert!(save_at(&dir.0, &changed, &secrets).is_err());
        assert_eq!(fs::read(dir.0.join("config.json")).unwrap(), old_file);
        assert_eq!(secrets.read().unwrap(), old_secret);
    }

    #[test]
    fn clearing_all_keys_deletes_credential() {
        let dir = TempConfig::new();
        let secrets = FakeSecrets::default();
        save_at(&dir.0, LEGACY, &secrets).unwrap();
        let empty = LEGACY
            .replace("test-only-text", "")
            .replace("test-only-vision", "");
        save_at(&dir.0, &empty, &secrets).unwrap();
        assert_eq!(secrets.read().unwrap(), None);
        let loaded: Value =
            serde_json::from_str(&load_at(&dir.0, &secrets).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["services"]["text"]["apiKey"], "");
    }

    #[test]
    fn malformed_config_does_not_change_file_or_credentials() {
        let dir = TempConfig::new();
        let secrets = FakeSecrets::default();
        fs::write(dir.0.join("config.json"), "not-json").unwrap();
        assert!(load_at(&dir.0, &secrets).is_err());
        assert_eq!(secrets.read().unwrap(), None);
        assert_eq!(
            fs::read_to_string(dir.0.join("config.json")).unwrap(),
            "not-json"
        );
    }

    #[cfg(windows)]
    #[test]
    fn native_credentials_use_only_isolated_test_directory() {
        let dir = TempConfig::new();
        let secrets = windows_secrets(&dir.0).unwrap();
        assert_eq!(secrets.read().unwrap(), None);
        let outcome = (|| -> Result<_, String> {
            fs::write(dir.0.join("config.json"), LEGACY).map_err(|e| e.to_string())?;
            let loaded = load_at(&dir.0, &secrets)?;
            Ok((
                loaded,
                secrets.read()?,
                fs::read_to_string(dir.0.join("config.json")).map_err(|e| e.to_string())?,
            ))
        })();
        secrets.write(None).unwrap();
        let (loaded, credential, disk) = outcome.unwrap();
        let loaded: Value = serde_json::from_str(&loaded.unwrap()).unwrap();
        assert_eq!(loaded["services"]["text"]["apiKey"], "test-only-text");
        assert!(credential.unwrap().contains("test-only-text"));
        assert!(!disk.contains("apiKey"));
        assert_eq!(secrets.read().unwrap(), None);
    }
}
