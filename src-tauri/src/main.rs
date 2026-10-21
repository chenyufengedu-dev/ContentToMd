// 发布版不弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

// 软件名还没定（方案第 17 节），先用 ContentToMd
const APP_DIR: &str = "ContentToMd";

/// %APPDATA%\ContentToMd（方案第 10.1 节）
fn data_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "找不到 APPDATA 目录".to_string())?;
    Ok(PathBuf::from(appdata).join(APP_DIR))
}

/// 读取 config.json；还没有配置过时返回 None
#[tauri::command]
fn load_config() -> Result<Option<String>, String> {
    let path = data_dir()?.join("config.json");
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("无法读取配置文件：{e}")),
    }
}

/// 先写临时文件再改名，避免写到一半中断导致配置损坏（方案第 10.5 节）
#[tauri::command]
fn save_config(json: String) -> Result<(), String> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    let tmp = dir.join("config.json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("无法写入配置文件：{e}"))?;
    fs::rename(&tmp, dir.join("config.json")).map_err(|e| format!("无法写入配置文件：{e}"))
}

/// 收藏库文件夹是否存在
#[tauri::command]
fn dir_exists(path: String) -> bool {
    PathBuf::from(path).is_dir()
}

/// 领域文件夹里是否已有笔记；有的话不允许删除这个领域（方案第 10.2 节）
#[tauri::command]
fn folder_has_notes(path: String) -> bool {
    fs::read_dir(path)
        .map(|entries| {
            entries.flatten().any(|e| {
                e.path()
                    .extension()
                    .is_some_and(|x| x.eq_ignore_ascii_case("md"))
            })
        })
        .unwrap_or(false)
}

// ---------------- 整理指令（方案第 9.7 节） ----------------

/// 把内置默认指令写进 %APPDATA%\ContentToMd\prompts\；用户改过的文件不覆盖
#[tauri::command]
fn ensure_prompts(defaults: HashMap<String, String>) -> Result<HashMap<String, String>, String> {
    let dir = data_dir()?.join("prompts");
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建指令目录：{e}"))?;
    let mut out = HashMap::new();
    for (name, text) in defaults {
        let path = dir.join(format!("{name}.md"));
        if !path.exists() {
            fs::write(&path, &text).map_err(|e| format!("无法写入指令文件：{e}"))?;
        }
        let current =
            fs::read_to_string(&path).map_err(|e| format!("无法读取指令文件 {name}.md：{e}"))?;
        out.insert(name, current);
    }
    Ok(out)
}

// ---------------- 草稿（F10，方案第 10.1 节） ----------------
// 一次只处理一条，只有一份草稿：%APPDATA%\ContentToMd\drafts\current\ 里的 draft.json 和图片原文件

fn draft_dir() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("drafts").join("current"))
}

/// 先写临时文件再改名，写到一半崩溃也不会留下坏掉的草稿
fn put_draft_file(dir: &std::path::Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    check_segment(name)?;
    fs::create_dir_all(dir).map_err(|e| io_msg(dir, e))?;
    let target = dir.join(name);
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, bytes).map_err(|e| io_msg(&tmp, e))?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_msg(&target, e)
    })
}

fn list_draft_files(dir: &std::path::Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.starts_with('.'))
        .collect();
    names.sort();
    names
}

/// 文件内容放在请求体里，文件名放在请求头 name 里（同 write_attachment）
#[tauri::command]
fn draft_write(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("草稿数据格式不对".into());
    };
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .ok_or("缺少参数 name")?;
    put_draft_file(&draft_dir()?, &percent_decode(name)?, bytes)
}

/// 草稿里有哪些文件；没有草稿时是空的
#[tauri::command]
fn draft_list() -> Result<Vec<String>, String> {
    Ok(list_draft_files(&draft_dir()?))
}

#[tauri::command]
fn draft_read(name: String) -> Result<tauri::ipc::Response, String> {
    check_segment(&name)?;
    let path = draft_dir()?.join(&name);
    let bytes = fs::read(&path).map_err(|e| io_msg(&path, e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 保存或放弃后删掉草稿（只删 drafts\current 这一个文件夹）
#[tauri::command]
fn draft_clear() -> Result<(), String> {
    let dir = draft_dir()?;
    match fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io_msg(&dir, e)),
        _ => Ok(()),
    }
}

// ---------------- 费用记录（F14，方案第 10.1 节） ----------------
// %APPDATA%\ContentToMd\usage.jsonl，每次调用服务追加一行 JSON（不含密钥，只有密钥编号）

fn append_line(path: &std::path::Path, line: &str) -> Result<(), String> {
    use std::io::Write;
    if line.contains('\n') {
        return Err("一条记录只能有一行".into());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| io_msg(dir, e))?;
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| io_msg(path, e))?;
    writeln!(f, "{line}").map_err(|e| io_msg(path, e))
}

#[tauri::command]
fn usage_append(line: String) -> Result<(), String> {
    append_line(&data_dir()?.join("usage.jsonl"), &line)
}

/// 全部记录；还没有记录时是空的
#[tauri::command]
fn usage_read() -> Result<String, String> {
    let path = data_dir()?.join("usage.jsonl");
    match fs::read_to_string(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        r => r.map_err(|e| io_msg(&path, e)),
    }
}

// ---------------- 收藏库 ----------------

/// 名字里不能带路径分隔符或“..”，保证只写在收藏库里面（方案第 10.5 节）
fn check_segment(s: &str) -> Result<(), String> {
    if s.is_empty() || s.contains(['\\', '/', ':']) || s == "." || s == ".." {
        return Err(format!("名称“{s}”不合法"));
    }
    Ok(())
}

/// 写入笔记：收藏库/领域/标题.md；重名时依次尝试 标题-日期.md、标题-日期-2.md……绝不覆盖（方案第 10.4 节）。
/// 先写临时文件再改名（方案第 10.5 节）。返回相对收藏库的路径
#[tauri::command]
fn write_note(
    vault: String,
    domain: String,
    title: String,
    date: String,
    content: String,
) -> Result<String, String> {
    check_segment(&domain)?;
    check_segment(&title)?;
    let vault = PathBuf::from(&vault);
    if !vault.is_dir() {
        return Err(format!(
            "收藏库文件夹“{}”找不到了，请重新选择",
            vault.display()
        ));
    }
    let dir = vault.join(&domain);
    fs::create_dir_all(&dir).map_err(|e| io_msg(&dir, e))?;
    let canon_vault = vault.canonicalize().map_err(|e| io_msg(&vault, e))?;
    if !dir
        .canonicalize()
        .map_err(|e| io_msg(&dir, e))?
        .starts_with(&canon_vault)
    {
        return Err("目标位置不在收藏库里".into());
    }
    let mut name = format!("{title}.md");
    let mut n = 1;
    while dir.join(&name).exists() {
        name = if n == 1 {
            format!("{title}-{date}.md")
        } else {
            format!("{title}-{date}-{n}.md")
        };
        n += 1;
    }
    let target = dir.join(&name);
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, content).map_err(|e| io_msg(&tmp, e))?;
    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(io_msg(&target, e));
    }
    Ok(format!("{domain}/{name}"))
}

/// 写入一张图片：收藏库/附件/年-月/文件名（方案第 10.2、10.4 节）。重名时在扩展名前加 -2、-3……绝不覆盖；
/// 先写临时文件再改名。返回相对收藏库的路径，比如 附件/2026-10/2026-10-20-标题-1.png
fn save_attachment(vault: &str, month: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
    check_segment(month)?;
    check_segment(name)?;
    let vault = PathBuf::from(vault);
    if !vault.is_dir() {
        return Err(format!(
            "收藏库文件夹“{}”找不到了，请重新选择",
            vault.display()
        ));
    }
    let dir = vault.join("附件").join(month);
    fs::create_dir_all(&dir).map_err(|e| io_msg(&dir, e))?;
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    let mut file = name.to_string();
    let mut n = 2;
    while dir.join(&file).exists() {
        file = format!("{stem}-{n}{ext}");
        n += 1;
    }
    let target = dir.join(&file);
    let tmp = dir.join(format!(".{file}.tmp"));
    fs::write(&tmp, bytes).map_err(|e| io_msg(&tmp, e))?;
    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(io_msg(&target, e));
    }
    Ok(format!("附件/{month}/{file}"))
}

/// 图片内容直接放在请求体里（不转成 JSON 数组，几 MB 的图也快），其余参数放在请求头里，经过 encodeURIComponent
#[tauri::command]
fn write_attachment(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("图片数据格式不对".into());
    };
    let header = |k: &str| -> Result<String, String> {
        let v = request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .ok_or(format!("缺少参数 {k}"))?;
        percent_decode(v)
    };
    save_attachment(
        &header("vault")?,
        &header("month")?,
        &header("name")?,
        bytes,
    )
}

/// 保存笔记失败时，删掉刚写进去的图片，不在收藏库里留下没人引用的文件。只能删“附件”文件夹里的
#[tauri::command]
fn remove_attachment(vault: String, rel_path: String) -> Result<(), String> {
    let rel = std::path::Path::new(&rel_path);
    if !rel.starts_with("附件")
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("只能删除附件文件夹里的图片".into());
    }
    let path = PathBuf::from(vault).join(rel);
    fs::remove_file(&path).map_err(|e| io_msg(&path, e))
}

fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let h = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|_| "参数编码不对")?;
            out.push(u8::from_str_radix(h, 16).map_err(|_| "参数编码不对")?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "参数编码不对".into())
}

fn io_msg(path: &std::path::Path, e: std::io::Error) -> String {
    use std::io::ErrorKind::*;
    let why = match e.kind() {
        PermissionDenied => "没有权限".to_string(),
        StorageFull => "磁盘空间不足".to_string(),
        _ if e.raw_os_error() == Some(32) => "文件正在被其他程序使用，请关闭后重试".to_string(),
        _ => e.to_string(),
    };
    format!("无法写入“{}”：{why}", path.display())
}

/// 收集收藏库里笔记已用过的标签，按使用次数从多到少（方案第 9.7 节）
#[tauri::command]
fn list_vault_tags(vault: String) -> Vec<String> {
    let mut count: HashMap<String, usize> = HashMap::new();
    let Ok(domains) = fs::read_dir(&vault) else {
        return vec![];
    };
    for d in domains.flatten().filter(|d| d.path().is_dir()) {
        let Ok(files) = fs::read_dir(d.path()) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md")) {
                continue;
            }
            let Ok(text) = fs::read_to_string(&p) else {
                continue;
            };
            for tag in frontmatter_tags(&text) {
                *count.entry(tag).or_default() += 1;
            }
        }
    }
    let mut tags: Vec<_> = count.into_iter().collect();
    tags.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    tags.into_iter().map(|(t, _)| t).collect()
}

#[derive(serde::Deserialize)]
struct FrontMatter {
    #[serde(default)]
    tags: Vec<String>,
}

/// 读笔记开头 frontmatter 里的 tags；没有或格式不对时当作没有标签
fn frontmatter_tags(text: &str) -> Vec<String> {
    gray_matter::Matter::<gray_matter::engine::YAML>::new()
        .parse::<FrontMatter>(text)
        .ok()
        .and_then(|p| p.data)
        .map(|f| {
            f.tags
                .into_iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// 打开笔记：收藏库在 Obsidian 的 vault 里时用 Obsidian 打开，否则用系统默认程序（F13）
#[tauri::command]
fn open_note(vault: String, rel_path: String) -> Result<(), String> {
    let path = PathBuf::from(&vault).join(rel_path.replace('/', "\\"));
    let in_obsidian = path.ancestors().any(|a| a.join(".obsidian").is_dir());
    let target = if in_obsidian {
        format!(
            "obsidian://open?path={}",
            percent_encode(&path.to_string_lossy())
        )
    } else {
        path.to_string_lossy().into_owned()
    };
    std::process::Command::new("explorer")
        .arg(target)
        .spawn()
        .map_err(|e| format!("无法打开笔记：{e}"))?;
    Ok(())
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            dir_exists,
            folder_has_notes,
            ensure_prompts,
            write_note,
            write_attachment,
            remove_attachment,
            list_vault_tags,
            open_note,
            draft_write,
            draft_list,
            draft_read,
            draft_clear,
            usage_append,
            usage_read
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例一个独立的临时收藏库，测完删掉
    struct TempVault(PathBuf);
    impl TempVault {
        fn new(name: &str) -> Self {
            let p = std::env::temp_dir()
                .join(format!("contenttomd-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            TempVault(p)
        }
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }
    impl Drop for TempVault {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write(v: &TempVault, domain: &str, title: &str, content: &str) -> Result<String, String> {
        write_note(
            v.path(),
            domain.into(),
            title.into(),
            "2026-10-20".into(),
            content.into(),
        )
    }

    #[test]
    fn 重名时依次加日期和序号_已有文件不被覆盖() {
        let v = TempVault::new("dup");
        assert_eq!(
            write(&v, "为人处世", "敬酒礼仪", "第一篇").unwrap(),
            "为人处世/敬酒礼仪.md"
        );
        assert_eq!(
            write(&v, "为人处世", "敬酒礼仪", "第二篇").unwrap(),
            "为人处世/敬酒礼仪-2026-10-20.md"
        );
        assert_eq!(
            write(&v, "为人处世", "敬酒礼仪", "第三篇").unwrap(),
            "为人处世/敬酒礼仪-2026-10-20-2.md"
        );
        let dir = v.0.join("为人处世");
        assert_eq!(
            fs::read_to_string(dir.join("敬酒礼仪.md")).unwrap(),
            "第一篇"
        );
        assert_eq!(
            fs::read_to_string(dir.join("敬酒礼仪-2026-10-20.md")).unwrap(),
            "第二篇"
        );
        // 不留下临时文件
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 3);
    }

    #[test]
    fn 草稿文件_写入后能列出和读回_覆盖时不留临时文件() {
        let v = TempVault::new("draft");
        let dir = v.0.join("current");
        assert!(list_draft_files(&dir).is_empty());
        put_draft_file(&dir, "draft.json", b"{\"a\":1}").unwrap();
        put_draft_file(&dir, "image-0", b"png").unwrap();
        put_draft_file(&dir, "draft.json", b"{\"a\":2}").unwrap();
        assert_eq!(list_draft_files(&dir), vec!["draft.json", "image-0"]);
        assert_eq!(fs::read(dir.join("draft.json")).unwrap(), b"{\"a\":2}");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
    }

    #[test]
    fn 费用记录_逐行追加_不接受多行() {
        let v = TempVault::new("usage");
        let path = v.0.join("usage.jsonl");
        append_line(&path, "{\"a\":1}").unwrap();
        append_line(&path, "{\"a\":2}").unwrap();
        assert!(append_line(&path, "x\ny").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"a\":1}\n{\"a\":2}\n");
    }

    #[test]
    fn 草稿文件名带路径时拒绝() {
        let v = TempVault::new("draft-escape");
        let dir = v.0.join("current");
        for name in ["..", r"..\x", "a/b", ""] {
            assert!(put_draft_file(&dir, name, b"x").is_err(), "应拒绝 {name}");
        }
    }

    #[test]
    fn 名称里带路径时拒绝写入_不越出收藏库() {
        let v = TempVault::new("escape");
        for (domain, title) in [
            ("..", "x"),
            ("为人处世", r"..\..\x"),
            ("a/b", "x"),
            ("为人处世", "C:x"),
            ("", "x"),
        ] {
            assert!(
                write(&v, domain, title, "内容").is_err(),
                "应拒绝 {domain} / {title}"
            );
        }
        assert_eq!(fs::read_dir(&v.0).unwrap().count(), 0);
    }

    #[test]
    fn 收藏库文件夹不存在时报错() {
        let err = write_note(
            r"Z:\不存在的收藏库".into(),
            "其他".into(),
            "t".into(),
            "2026-10-20".into(),
            "c".into(),
        );
        assert!(err.unwrap_err().contains("找不到了"));
    }

    #[test]
    fn 读取已有标签_按使用次数排序() {
        let v = TempVault::new("tags");
        write(
            &v,
            "为人处世",
            "a",
            "---\ntitle: \"a\"\ntags: [\"商务礼仪\", \"职场沟通\"]\n---\n\n正文",
        )
        .unwrap();
        write(
            &v,
            "品牌商业",
            "b",
            "---\ntags:\n  - 商务礼仪\n  - 品牌营销\n---\n正文",
        )
        .unwrap();
        write(&v, "其他", "c", "没有 frontmatter 的笔记").unwrap();
        write(&v, "其他", "d", "---\ntags: 不是列表\n---\n").unwrap();
        assert_eq!(
            list_vault_tags(v.path()),
            vec!["商务礼仪", "品牌营销", "职场沟通"]
        );
    }

    #[test]
    fn 领域文件夹里有笔记才算有笔记() {
        let v = TempVault::new("hasnotes");
        let dir = v.0.join("设计UI");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("说明.txt"), "x").unwrap();
        assert!(!folder_has_notes(dir.to_string_lossy().into_owned()));
        fs::write(dir.join("笔记.MD"), "x").unwrap();
        assert!(folder_has_notes(dir.to_string_lossy().into_owned()));
    }

    #[test]
    fn obsidian_链接里的路径被完整编码() {
        assert_eq!(
            percent_encode(r"D:\库\a b.md"),
            "D%3A%5C%E5%BA%93%5Ca%20b.md"
        );
    }

    #[test]
    fn 图片写进附件按月分文件夹_重名不覆盖() {
        let v = TempVault::new("att");
        let a = save_attachment(&v.path(), "2026-10", "2026-10-20-标题-1.png", b"one").unwrap();
        let b = save_attachment(&v.path(), "2026-10", "2026-10-20-标题-1.png", b"two").unwrap();
        assert_eq!(a, "附件/2026-10/2026-10-20-标题-1.png");
        assert_eq!(b, "附件/2026-10/2026-10-20-标题-1-2.png");
        assert_eq!(fs::read(v.0.join(&a)).unwrap(), b"one");
        assert!(save_attachment(&v.path(), "..", "x.png", b"x").is_err());
        assert!(save_attachment(&v.path(), "2026-10", "../x.png", b"x").is_err());
    }

    #[test]
    fn 只能删除附件里的图片() {
        let v = TempVault::new("rm");
        let a = save_attachment(&v.path(), "2026-10", "a.png", b"x").unwrap();
        fs::write(v.0.join("笔记.md"), "x").unwrap();
        assert!(remove_attachment(v.path(), "笔记.md".into()).is_err());
        assert!(remove_attachment(v.path(), "附件/../笔记.md".into()).is_err());
        remove_attachment(v.path(), a.clone()).unwrap();
        assert!(!v.0.join(&a).exists());
    }

    #[test]
    fn 请求头参数解码() {
        assert_eq!(
            percent_decode("%E9%99%84%E4%BB%B6-1.png").unwrap(),
            "附件-1.png"
        );
        assert_eq!(percent_decode("a%20b").unwrap(), "a b");
    }
}
