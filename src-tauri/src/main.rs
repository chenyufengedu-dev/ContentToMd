// 发布版不弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config_store;
mod onboarding;
mod window_state;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_window_state::AppHandleExt;

// 软件名还没定（方案第 17 节），先用 ContentToMd
const APP_DIR: &str = "ContentToMd";
// 运行窗口与桌面共用白底主题色图标，避免透明白色标记受任务栏背景影响。
const WINDOW_ICON: tauri::image::Image<'_> = tauri::include_image!("icons/128x128.png");

/// %APPDATA%\ContentToMd（方案第 10.1 节）
fn data_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "找不到 APPDATA 目录".to_string())?;
    Ok(PathBuf::from(appdata).join(APP_DIR))
}

/// 读取 config.json；还没有配置过时返回 None
#[tauri::command]
fn load_config() -> Result<Option<String>, String> {
    config_store::load(&data_dir()?)
}

/// 先写临时文件再改名，避免写到一半中断导致配置损坏（方案第 10.5 节）
#[tauri::command]
fn save_config(json: String) -> Result<(), String> {
    config_store::save(&data_dir()?, &json)
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectionInfo {
    domains: Vec<String>,
    has_notes: bool,
}

/// 连接收藏库时只检查目录和文件名，不读取或改写笔记正文。
#[tauri::command]
fn inspect_collection(root: String) -> Result<CollectionInfo, String> {
    let root = PathBuf::from(root);
    let entries = fs::read_dir(&root).map_err(|e| io_msg(&root, e))?;
    let mut info = CollectionInfo {
        domains: Vec::new(),
        has_notes: false,
    };
    for entry in entries {
        let entry = entry.map_err(|e| io_msg(&root, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "附件" {
            continue;
        }
        let path = entry.path();
        ensure_inside(&root, &path)?;
        if path.is_dir() {
            info.domains.push(name);
            let files = fs::read_dir(&path).map_err(|e| io_msg(&path, e))?;
            for file in files {
                let file = file.map_err(|e| io_msg(&path, e))?;
                let file_path = file.path();
                if file_path
                    .extension()
                    .is_some_and(|x| x.eq_ignore_ascii_case("md"))
                {
                    ensure_inside(&root, &file_path)?;
                    info.has_notes |= file_path.is_file();
                }
            }
        } else if path
            .extension()
            .is_some_and(|x| x.eq_ignore_ascii_case("md"))
            && path.is_file()
        {
            info.has_notes = true;
        }
    }
    info.domains.sort();
    Ok(info)
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

// 已有笔记的恢复副本独立于导入草稿；串行更新，避免多个笔记的读改写互相覆盖。
static EDIT_RECOVERY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn read_edit_recoveries_at(
    dir: &std::path::Path,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let path = dir.join("note-edits.json");
    match fs::read_to_string(&path) {
        Ok(text) => {
            serde_json::from_str(&text).map_err(|_| "笔记恢复副本无法读取，原文件已保留".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(std::collections::BTreeMap::new()),
        Err(e) => Err(io_msg(&path, e)),
    }
}

fn edit_recovery_key(root: &str, path: &str) -> Result<String, String> {
    serde_json::to_string(&(root, path)).map_err(|_| "无法识别笔记恢复位置".into())
}

fn write_edit_recovery_at(
    dir: &std::path::Path,
    root: &str,
    path: &str,
    json: Option<String>,
) -> Result<(), String> {
    let mut records = read_edit_recoveries_at(dir)?;
    let key = edit_recovery_key(root, path)?;
    if let Some(json) = json {
        records.insert(key, json);
    } else if records.remove(&key).is_none() {
        return Ok(());
    }
    let bytes = serde_json::to_vec(&records).map_err(|_| "无法保存笔记恢复副本".to_string())?;
    put_draft_file(dir, "note-edits.json", &bytes)
}

#[tauri::command]
fn edit_recovery_list() -> Result<Vec<String>, String> {
    let _guard = EDIT_RECOVERY_LOCK
        .lock()
        .map_err(|_| "笔记恢复副本暂时无法读取")?;
    Ok(read_edit_recoveries_at(&data_dir()?.join("recovery"))?
        .into_values()
        .collect())
}

#[tauri::command]
fn edit_recovery_write(root: String, path: String, json: Option<String>) -> Result<(), String> {
    let _guard = EDIT_RECOVERY_LOCK
        .lock()
        .map_err(|_| "笔记恢复副本暂时无法保存")?;
    write_edit_recovery_at(&data_dir()?.join("recovery"), &root, &path, json)
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

/// 新文件尚不存在时检查最近的已存在上级；目录链接和文件链接都按真实位置判断。
fn ensure_inside(root: &std::path::Path, path: &std::path::Path) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|e| io_msg(root, e))?;
    let mut existing = path;
    loop {
        match fs::symlink_metadata(existing) {
            Ok(_) => {
                let resolved = existing.canonicalize().map_err(|e| io_msg(existing, e))?;
                return if resolved.starts_with(&canonical_root) {
                    Ok(())
                } else {
                    Err("目标位置不在收藏库里".into())
                };
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                existing = existing.parent().ok_or("目标位置不在收藏库里")?;
            }
            Err(e) => return Err(io_msg(existing, e)),
        }
    }
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
    check_segment(&date)?;
    let vault = PathBuf::from(&vault);
    if !vault.is_dir() {
        return Err(format!(
            "收藏库文件夹“{}”找不到了，请重新选择",
            vault.display()
        ));
    }
    let dir = vault.join(&domain);
    ensure_inside(&vault, &dir)?;
    fs::create_dir_all(&dir).map_err(|e| io_msg(&dir, e))?;
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
    ensure_inside(&vault, &target)?;
    ensure_inside(&vault, &tmp)?;
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
    ensure_inside(&vault, &dir)?;
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
    ensure_inside(&vault, &target)?;
    ensure_inside(&vault, &tmp)?;
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
    let path = inside_root(std::path::Path::new(&vault), &rel_path)?;
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
        if ensure_inside(std::path::Path::new(&vault), &d.path()).is_err() {
            continue;
        }
        let Ok(files) = fs::read_dir(d.path()) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if ensure_inside(std::path::Path::new(&vault), &p).is_err() {
                continue;
            }
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

// ---------------- 收藏库页（F21） ----------------

/// 收藏库页的一条笔记。path 相对存放文件夹（领域/文件名.md），cover 相对存放文件夹（附件/年-月/图.png）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteEntry {
    path: String,
    title: String,
    domain: String,
    created: String,
    tags: Vec<String>,
    keywords: Vec<String>,
    cover: String,
    body: String,
}

#[derive(serde::Serialize)]
struct NoteList {
    notes: Vec<NoteEntry>,
    /// 读不出来的文件（相对路径），收藏库页底部提示“有 N 个文件无法读取”
    failed: Vec<String>,
}

#[derive(serde::Deserialize, Default)]
struct NoteMeta {
    #[serde(default)]
    title: String,
    #[serde(default)]
    created: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    cover: String,
}

/// 读存放文件夹里每个领域文件夹下的笔记（只读一层，跳过“附件”和隐藏文件夹；存放文件夹最外层的 .md 不算）。
/// 领域按所在文件夹算，用户在 Obsidian 里挪过文件也对得上
#[tauri::command]
fn list_notes(root: String) -> Result<NoteList, String> {
    let root = PathBuf::from(root);
    let domains = fs::read_dir(&root).map_err(|e| io_msg(&root, e))?;
    let mut list = NoteList {
        notes: Vec::new(),
        failed: Vec::new(),
    };
    for d in domains.flatten().filter(|d| d.path().is_dir()) {
        let domain = d.file_name().to_string_lossy().into_owned();
        if domain.starts_with('.') || domain == "附件" {
            continue;
        }
        if ensure_inside(&root, &d.path()).is_err() {
            list.failed.push(domain);
            continue;
        }
        let Ok(files) = fs::read_dir(d.path()) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if !p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md")) {
                continue;
            }
            let name = f.file_name().to_string_lossy().into_owned();
            let rel = format!("{domain}/{name}");
            if ensure_inside(&root, &p).is_err() {
                list.failed.push(rel);
                continue;
            }
            let Ok(text) = fs::read_to_string(&p) else {
                list.failed.push(rel);
                continue;
            };
            let parsed =
                gray_matter::Matter::<gray_matter::engine::YAML>::new().parse::<NoteMeta>(&text);
            let (meta, body) = match parsed {
                Ok(m) => (m.data.unwrap_or_default(), m.content),
                Err(_) => (NoteMeta::default(), text),
            };
            let clean = |v: Vec<String>| -> Vec<String> {
                v.into_iter()
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
                    .collect()
            };
            let title = if meta.title.trim().is_empty() {
                name.trim_end_matches(".md").to_string()
            } else {
                meta.title.trim().to_string()
            };
            list.notes.push(NoteEntry {
                path: rel,
                title,
                domain: domain.clone(),
                created: meta.created,
                tags: clean(meta.tags),
                keywords: clean(meta.keywords),
                cover: meta.cover,
                body,
            });
        }
    }
    Ok(list)
}

/// 封面图只能从存放文件夹的“附件”里读，路径里不能有“..”
fn cover_bytes(root: &str, rel_path: &str) -> Result<Vec<u8>, String> {
    let rel = std::path::Path::new(rel_path);
    if !rel.starts_with("附件")
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("只能读附件文件夹里的图片".into());
    }
    let path = inside_root(std::path::Path::new(root), rel_path)?;
    fs::read(&path).map_err(|e| io_msg(&path, e))
}

#[tauri::command]
fn read_cover(root: String, rel_path: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(cover_bytes(&root, &rel_path)?))
}

// ---------------- 笔记查看和编辑（F22） ----------------

/// 打开一条笔记：属性拆开给界面，`extra` 是属性里别的程序加的行（Obsidian 的 aliases 等），保存时原样带回去
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteFile {
    title: String,
    domain: String,
    stem: String,
    kind: String,
    mode: String,
    tags: Vec<String>,
    keywords: Vec<String>,
    source: String,
    platform: String,
    author: String,
    created: String,
    cover: String,
    extra: String,
    content: String,
    original_text: String,
}

#[derive(serde::Deserialize, Default)]
struct NoteHead {
    #[serde(default)]
    title: String,
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    mode: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    source: String,
    #[serde(default)]
    platform: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    created: String,
    #[serde(default)]
    cover: String,
}

const KNOWN_KEYS: [&str; 12] = [
    "title", "domain", "type", "mode", "tags", "keywords", "source", "platform", "author",
    "created", "cover", "schema",
];

/// 笔记开头 `---` 之间的属性原文。没有属性时返回 None
fn split_frontmatter(text: &str) -> Option<&str> {
    let rest = text.trim_start_matches('\u{feff}').strip_prefix("---")?;
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))?;
    let mut pos = 0;
    for l in rest.split_inclusive('\n') {
        if l.trim_end() == "---" {
            return Some(&rest[..pos]);
        }
        pos += l.len();
    }
    None
}

/// 属性里不是本软件写的那些行（连同它们下面缩进的内容），原样返回
fn extra_frontmatter(fm: &str) -> String {
    let mut keep = false;
    let mut out: Vec<&str> = Vec::new();
    for line in fm.lines() {
        let top = !line.starts_with([' ', '\t', '-', '#']) && !line.is_empty();
        if top {
            let key = line.split(':').next().unwrap_or("").trim();
            keep = !KNOWN_KEYS.contains(&key);
        }
        if keep {
            out.push(line);
        }
    }
    out.join("\n").trim_end().to_string()
}

/// 相对存放文件夹的路径必须落在存放文件夹里面（不能有“..”、不能是绝对路径）
fn inside_root(root: &std::path::Path, rel: &str) -> Result<PathBuf, String> {
    let r = std::path::Path::new(rel);
    if rel.is_empty()
        || r.is_absolute()
        || r.components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("笔记的位置不合法".into());
    }
    let path = root.join(r);
    ensure_inside(root, &path)?;
    Ok(path)
}

fn read_note_at(root: &std::path::Path, rel: &str) -> Result<NoteFile, String> {
    let path = inside_root(root, rel)?;
    if !path.is_file() {
        return Err("找不到这条笔记了".into());
    }
    let text = fs::read_to_string(&path).map_err(|e| io_msg(&path, e))?;
    let parsed = gray_matter::Matter::<gray_matter::engine::YAML>::new().parse::<NoteHead>(&text);
    let (head, content) = match parsed {
        Ok(m) => (m.data.unwrap_or_default(), m.content),
        Err(_) => (NoteHead::default(), text.clone()),
    };
    let rel_path = std::path::Path::new(rel);
    let stem = rel_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let domain = rel_path
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let clean = |v: Vec<String>| -> Vec<String> {
        v.into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect()
    };
    Ok(NoteFile {
        title: if head.title.trim().is_empty() {
            stem.clone()
        } else {
            head.title.trim().to_string()
        },
        domain,
        stem,
        kind: head.kind,
        mode: head.mode,
        tags: clean(head.tags),
        keywords: clean(head.keywords),
        source: head.source,
        platform: head.platform,
        author: head.author,
        created: head.created,
        cover: head.cover,
        extra: split_frontmatter(&text)
            .map(extra_frontmatter)
            .unwrap_or_default(),
        content,
        original_text: text,
    })
}

#[tauri::command]
fn read_note(root: String, rel_path: String) -> Result<NoteFile, String> {
    read_note_at(&PathBuf::from(root), &rel_path)
}

fn check_note_unchanged(path: &std::path::Path, expected: &str) -> Result<(), String> {
    let current = fs::read_to_string(path).map_err(|e| io_msg(path, e))?;
    if current != expected {
        return Err("这条笔记已被其他程序修改，未覆盖文件".into());
    }
    Ok(())
}

/// 保存修改：领域和文件名都没变就覆盖原文件；变了就写到新位置再删旧的，新位置已有同名笔记时拒绝，
/// 两边都不动（方案第 10.4 节：绝不覆盖）。先写临时文件再改名。返回新的相对路径
fn save_note_at(
    root: &std::path::Path,
    rel: &str,
    domain: &str,
    stem: &str,
    content: &str,
    expected: &str,
) -> Result<String, String> {
    check_segment(domain)?;
    check_segment(stem)?;
    let old = inside_root(root, rel)?;
    if !old.is_file() {
        return Err("找不到这条笔记了，可能已经被移走或删除".into());
    }
    check_note_unchanged(&old, expected)?;
    let dir = root.join(domain);
    let target = dir.join(format!("{stem}.md"));
    ensure_inside(root, &dir)?;
    ensure_inside(root, &target)?;
    let same = target.exists()
        && matches!((target.canonicalize(), old.canonicalize()), (Ok(a), Ok(b)) if a == b);
    if target.exists() && !same {
        return Err(format!(
            "“{domain}”里已经有叫“{stem}”的笔记了，请换个文件名或领域"
        ));
    }
    fs::create_dir_all(&dir).map_err(|e| io_msg(&dir, e))?;
    let tmp = dir.join(format!(".{stem}.md.tmp"));
    ensure_inside(root, &tmp)?;
    fs::write(&tmp, content).map_err(|e| io_msg(&tmp, e))?;
    if let Err(error) = check_note_unchanged(&old, expected) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    if let Err(e) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(io_msg(&target, e));
    }
    if !same {
        fs::remove_file(&old).map_err(|e| io_msg(&old, e))?;
    }
    Ok(format!("{domain}/{stem}.md"))
}

#[tauri::command]
fn save_note(
    root: String,
    rel_path: String,
    domain: String,
    stem: String,
    content: String,
    expected: String,
) -> Result<String, String> {
    save_note_at(
        &PathBuf::from(root),
        &rel_path,
        &domain,
        &stem,
        &content,
        &expected,
    )
}

/// 笔记里引用的收藏库内图片（相对存放文件夹，如 附件/2026-10/a.png）：认标准图片写法和属性里的 cover，
/// 写法里的 ../ 去掉；网址和别处的图不算
fn attachment_refs(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |raw: &str| {
        let p = raw.trim().trim_matches(['<', '>', '"']);
        let p = p.trim_start_matches("../").trim_start_matches("./");
        if p.starts_with("附件/") && !p.contains("..") && !out.iter().any(|x| x == p) {
            out.push(p.to_string());
        }
    };
    let mut rest = text;
    while let Some(i) = rest.find("](") {
        rest = &rest[i + 2..];
        if let Some(j) = rest.find(')') {
            add(&rest[..j]);
        }
    }
    if let Some(fm) = split_frontmatter(text) {
        for l in fm.lines() {
            if let Some(v) = l.strip_prefix("cover:") {
                add(v);
            }
        }
    }
    out
}

/// 各领域文件夹下所有 .md 的相对路径（和收藏库页读的范围一样）
fn all_note_paths(root: &std::path::Path) -> Vec<String> {
    let mut v = Vec::new();
    let Ok(domains) = fs::read_dir(root) else {
        return v;
    };
    for d in domains.flatten().filter(|d| d.path().is_dir()) {
        if ensure_inside(root, &d.path()).is_err() {
            continue;
        }
        let domain = d.file_name().to_string_lossy().into_owned();
        if domain.starts_with('.') || domain == "附件" {
            continue;
        }
        let Ok(files) = fs::read_dir(d.path()) else {
            continue;
        };
        for f in files.flatten() {
            if ensure_inside(root, &f.path()).is_err() {
                continue;
            }
            if f.path()
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("md"))
            {
                v.push(format!("{domain}/{}", f.file_name().to_string_lossy()));
            }
        }
    }
    v
}

/// 删除这条笔记时该一起删的图片：它引用的、文件还在、别的笔记都没用到的
fn unused_attachments(root: &std::path::Path, rel: &str) -> Result<Vec<String>, String> {
    let path = inside_root(root, rel)?;
    let text = fs::read_to_string(&path).map_err(|e| io_msg(&path, e))?;
    let others: Vec<String> = all_note_paths(root)
        .into_iter()
        .filter(|p| p != rel)
        .filter_map(|p| fs::read_to_string(root.join(&p)).ok())
        .collect();
    Ok(attachment_refs(&text)
        .into_iter()
        .filter(|a| inside_root(root, a).is_ok_and(|p| p.is_file()))
        .filter(|a| !others.iter().any(|o| attachment_refs(o).contains(a)))
        .collect())
}

/// 删除笔记：笔记和只被它用的图片放进 Windows 回收站（方案 US10），返回一起放进去的图片（相对存放文件夹），撤销时要用
fn delete_note_at(root: &std::path::Path, rel: &str) -> Result<Vec<String>, String> {
    let note = inside_root(root, rel)?;
    let images = unused_attachments(root, rel)?;
    trash::delete(&note).map_err(|e| format!("无法放进回收站：{e}"))?;
    Ok(images
        .into_iter()
        .filter(|a| inside_root(root, a).is_ok_and(|p| trash::delete(p).is_ok()))
        .collect())
}

#[tauri::command]
fn delete_note(root: String, rel_path: String) -> Result<Vec<String>, String> {
    delete_note_at(&PathBuf::from(root), &rel_path)
}

/// 比较回收站里记的原位置：回收站记的是完整的长路径，所以先把还在的上级文件夹换成完整路径；
/// 不分大小写，斜杠反斜杠一样
fn norm_path(p: &std::path::Path) -> String {
    let full = match (
        p.parent().and_then(|d| d.canonicalize().ok()),
        p.file_name(),
    ) {
        (Some(dir), Some(name)) => dir.join(name),
        _ => p.to_path_buf(),
    };
    let s = full.to_string_lossy().replace('/', "\\").to_lowercase();
    // canonicalize 在 Windows 上会加 \\?\ 前缀，去掉后和回收站里记的写法一样
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

/// 撤销删除：把刚放进回收站的笔记和图片还原到原来的位置。回收站里同一个位置有好几份时取最近删的那份；
/// 原位置已经有同名文件时不覆盖，报错
fn restore_note_at(root: &std::path::Path, rel: &str, images: &[String]) -> Result<(), String> {
    let mut wanted = vec![inside_root(root, rel)?];
    for a in images {
        wanted.push(inside_root(root, a)?);
    }
    restore_from_trash(&wanted)
}

/// 把这些路径（文件或文件夹）从回收站还原到原位置；同一个位置有好几份时取最近删的那份
fn restore_from_trash(wanted: &[PathBuf]) -> Result<(), String> {
    let items = trash::os_limited::list().map_err(|e| format!("读不了回收站：{e}"))?;
    let mut chosen = Vec::new();
    for w in wanted {
        let key = norm_path(w);
        if let Some(it) = items
            .iter()
            .filter(|i| norm_path(&i.original_path()) == key)
            .max_by_key(|i| i.time_deleted)
        {
            chosen.push(it.clone());
        } else {
            return Err(format!(
                "回收站里找不到“{}”，可能已经被清空或还原过",
                w.display()
            ));
        }
    }
    if chosen.is_empty() {
        return Err("回收站里找不到这条内容了，可能已经被清空或还原过".into());
    }
    trash::os_limited::restore_all(chosen).map_err(|e| format!("无法还原：{e}"))
}

#[tauri::command]
fn restore_note(root: String, rel_path: String, images: Vec<String>) -> Result<(), String> {
    restore_note_at(&PathBuf::from(root), &rel_path, &images)
}

/// 领域文件夹里有多少篇笔记（.md）；文件夹不存在（用到时才创建）时是 0
fn count_notes_at(root: &std::path::Path, domain: &str) -> Result<usize, String> {
    check_segment(domain)?;
    let dir = root.join(domain);
    ensure_inside(root, &dir)?;
    if !dir.is_dir() {
        return Ok(0);
    }
    Ok(fs::read_dir(&dir)
        .map_err(|e| io_msg(&dir, e))?
        .flatten()
        .filter(|f| {
            f.path()
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("md"))
        })
        .count())
}

#[tauri::command]
fn count_domain_notes(root: String, domain: String) -> Result<usize, String> {
    count_notes_at(&PathBuf::from(root), &domain)
}

/// 删除领域时一起放进回收站的图片：这个领域里的笔记用到的、别的领域的笔记都没用到的
fn images_only_in_domain(root: &std::path::Path, domain: &str) -> Vec<String> {
    let prefix = format!("{domain}/");
    let (inside, outside): (Vec<String>, Vec<String>) = all_note_paths(root)
        .into_iter()
        .partition(|p| p.starts_with(&prefix));
    let outside_text: Vec<String> = outside
        .iter()
        .filter_map(|p| fs::read_to_string(root.join(p)).ok())
        .collect();
    let mut images: Vec<String> = Vec::new();
    for p in inside {
        let Ok(text) = fs::read_to_string(root.join(&p)) else {
            continue;
        };
        for a in attachment_refs(&text) {
            if !images.contains(&a)
                && inside_root(root, &a).is_ok_and(|p| p.is_file())
                && !outside_text.iter().any(|o| attachment_refs(o).contains(&a))
            {
                images.push(a);
            }
        }
    }
    images
}

/// 删除领域：领域的文件夹（连同里面的笔记）和只有这些笔记在用的图片，一起放进 Windows 回收站
#[derive(serde::Serialize)]
struct DeletedDomain {
    notes: usize,
    images: Vec<String>,
    existed: bool,
}

fn delete_domain_at(root: &std::path::Path, domain: &str) -> Result<DeletedDomain, String> {
    check_segment(domain)?;
    if domain == "附件" || domain.starts_with('.') {
        return Err("这个文件夹不能当领域删除".into());
    }
    let dir = root.join(domain);
    ensure_inside(root, &dir)?;
    if !dir.is_dir() {
        return Ok(DeletedDomain {
            notes: 0,
            images: vec![],
            existed: false,
        });
    }
    let notes = count_notes_at(root, domain)?;
    let wanted_images = images_only_in_domain(root, domain);
    trash::delete(&dir).map_err(|e| format!("无法放进回收站：{e}"))?;
    let images = wanted_images
        .into_iter()
        .filter(|a| inside_root(root, a).is_ok_and(|p| trash::delete(p).is_ok()))
        .collect();
    Ok(DeletedDomain {
        notes,
        images,
        existed: true,
    })
}

#[tauri::command]
fn delete_domain(root: String, domain: String) -> Result<DeletedDomain, String> {
    delete_domain_at(&PathBuf::from(root), &domain)
}

/// 撤销删除领域：把文件夹和图片从回收站还原
#[tauri::command]
fn restore_domain(root: String, domain: String, images: Vec<String>) -> Result<(), String> {
    check_segment(&domain)?;
    let root = PathBuf::from(root);
    let mut wanted = vec![inside_root(&root, &domain)?];
    for a in &images {
        wanted.push(inside_root(&root, a)?);
    }
    restore_from_trash(&wanted)
}

#[derive(serde::Serialize)]
struct ObsidianVault {
    name: String,
    path: String,
}

/// Obsidian 自己记的仓库清单（%APPDATA%\obsidian\obsidian.json）里，文件夹还在、里面有 .obsidian 的（F31）
fn parse_obsidian_vaults(json: &str) -> Vec<ObsidianVault> {
    #[derive(serde::Deserialize)]
    struct Entry {
        path: String,
    }
    #[derive(serde::Deserialize)]
    struct List {
        vaults: HashMap<String, Entry>,
    }
    let Ok(list) = serde_json::from_str::<List>(json) else {
        return Vec::new();
    };
    let mut vaults: Vec<ObsidianVault> = list
        .vaults
        .into_values()
        .filter(|e| PathBuf::from(&e.path).join(".obsidian").is_dir())
        .map(|e| ObsidianVault {
            name: PathBuf::from(&e.path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| e.path.clone()),
            path: e.path,
        })
        .collect();
    vaults.sort_by(|a, b| a.name.cmp(&b.name));
    vaults
}

/// 列出电脑上的 Obsidian 仓库；没装过 Obsidian 时是空的
#[tauri::command]
fn list_obsidian_vaults() -> Vec<ObsidianVault> {
    std::env::var("APPDATA")
        .ok()
        .and_then(|a| {
            fs::read_to_string(PathBuf::from(a).join("obsidian").join("obsidian.json")).ok()
        })
        .map(|s| parse_obsidian_vaults(&s))
        .unwrap_or_default()
}

/// 仓库里已有的文件夹（最多三层，跳过 .obsidian 这类隐藏文件夹），给设置页“存到哪个文件夹”的下拉框用。
/// 返回相对仓库的路径，用 / 分层，按名称排序
#[tauri::command]
fn list_subfolders(vault: String) -> Vec<String> {
    fn walk(
        root: &std::path::Path,
        dir: &std::path::Path,
        prefix: &str,
        depth: usize,
        out: &mut Vec<String>,
    ) {
        if depth == 0 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || !e.path().is_dir()
                || ensure_inside(root, &e.path()).is_err()
            {
                continue;
            }
            let rel = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            walk(root, &e.path(), &rel, depth - 1, out);
            out.push(rel);
        }
    }
    let mut out = Vec::new();
    let root = PathBuf::from(vault);
    walk(&root, &root, "", 3, &mut out);
    out.sort();
    out
}

/// 建好仓库里存笔记的子文件夹（可以多层）；每一层都按名称规则检查，不会建到仓库外面
#[tauri::command]
fn ensure_subfolder(vault: String, sub: String) -> Result<(), String> {
    let mut dir = PathBuf::from(&vault);
    if !dir.is_dir() {
        return Err(format!("仓库文件夹“{vault}”找不到了，请重新选择"));
    }
    for part in sub.split(['/', '\\']).map(str::trim) {
        check_segment(part)?;
        dir.push(part);
    }
    ensure_inside(std::path::Path::new(&vault), &dir)?;
    fs::create_dir_all(&dir).map_err(|e| io_msg(&dir, e))
}

/// 打开笔记：连接的是 Obsidian 仓库时在 Obsidian 里打开，否则用系统默认程序（F13、F31）
#[tauri::command]
fn open_note(vault: String, rel_path: String, in_obsidian: bool) -> Result<(), String> {
    let path = inside_root(std::path::Path::new(&vault), &rel_path)?;
    if !path.is_file() {
        return Err(format!("找不到这篇笔记：{}", path.display()));
    }
    let target = if in_obsidian {
        format!(
            "obsidian://open?path={}",
            percent_encode(&path.to_string_lossy())
        )
    } else {
        path.to_string_lossy().into_owned()
    };
    // 不用 explorer：路径带空格时参数会被加上引号，explorer 认不出来就只打开一个文件夹窗口。
    // url.dll 的 FileProtocolHandler 就是“用默认程序打开这个文件或链接”
    std::process::Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(target)
        .spawn()
        .map_err(|e| format!("无法打开笔记：{e}"))?;
    Ok(())
}

/// 关于卡片里的外部链接（博客、GitHub）：只认 https 网页地址，不带空白、引号和控制字符
fn check_link(url: &str) -> Result<(), String> {
    let ok = url.starts_with("https://")
        && url.len() > "https://".len()
        && url.len() <= 2048
        && !url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '"');
    if ok {
        Ok(())
    } else {
        Err("只能打开 https 开头的网页链接。".to_string())
    }
}

/// 用系统默认浏览器打开网页
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    check_link(&url)?;
    std::process::Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("无法打开链接：{e}"))?;
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

#[tauri::command]
fn destroy_window(window: tauri::Window) -> tauri::Result<()> {
    // 确认关闭会直接销毁窗口，必须在窗口消失前保存最大化等状态。
    if let Err(error) = window.app_handle().save_window_state(window_state::flags()) {
        eprintln!("无法保存窗口状态：{error}");
    }
    window.destroy()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let result = window
                    .show()
                    .and_then(|_| window.unminimize())
                    .and_then(|_| window.set_focus());
                if let Err(error) = result {
                    eprintln!("无法切回已有窗口：{error}");
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state::flags())
                .skip_initial_state("main")
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(WINDOW_ICON)?;
                // 无边框窗口显示后系统才完成边框计算；先显示再恢复，避免每次启动累加标题栏高度。
                window.show()?;
                if let Err(error) = window_state::restore(&window) {
                    eprintln!("无法恢复窗口状态：{error}");
                }
                window_state::track(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            destroy_window,
            load_config,
            onboarding::load_onboarding,
            onboarding::save_onboarding,
            onboarding::default_collection_folder,
            save_config,
            dir_exists,
            folder_has_notes,
            inspect_collection,
            ensure_prompts,
            write_note,
            write_attachment,
            remove_attachment,
            list_vault_tags,
            open_note,
            open_link,
            list_obsidian_vaults,
            ensure_subfolder,
            list_subfolders,
            list_notes,
            read_cover,
            read_note,
            save_note,
            delete_note,
            restore_note,
            count_domain_notes,
            delete_domain,
            restore_domain,
            draft_write,
            draft_list,
            draft_read,
            draft_clear,
            edit_recovery_list,
            edit_recovery_write,
            usage_append,
            usage_read
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_uses_desktop_icon() {
        let desktop = tauri::include_image!("icons/128x128.png");
        let window = WINDOW_ICON;
        assert_eq!((window.width(), window.height()), (128, 128));
        let top_middle = (128 * 2 + 64) * 4;
        assert_eq!(
            &desktop.rgba()[top_middle..top_middle + 4],
            &[255, 255, 255, 255]
        );
        assert_eq!(window.rgba(), desktop.rgba());
    }

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
    fn link_only_https_web_addresses() {
        assert!(check_link("https://chenyu-blog.vercel.app/").is_ok());
        assert!(check_link("https://github.com/someone/repo").is_ok());
        for bad in [
            "http://example.com",
            "https://",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\notepad.exe",
            "https://a.com/x y",
            "https://a.com/\"&calc",
            "https://a.com/\nx",
        ] {
            assert!(check_link(bad).is_err(), "{bad} 不该被放行");
        }
    }

    #[cfg(windows)]
    #[test]
    fn path_boundary_junction_cannot_escape_vault() {
        use std::os::windows::process::CommandExt;
        let v = TempVault::new("path-boundary");
        let base = v.0.canonicalize().unwrap();
        let root = base.join("vault");
        let outside = base.join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let inside = root.join("safe");
        fs::create_dir_all(&inside).unwrap();
        fs::write(outside.join("a.md"), "---\ntags: [outside]\n---\nexternal").unwrap();
        fs::write(outside.join("a.png"), b"outside").unwrap();
        for (name, target) in [
            ("domain", &outside),
            ("附件", &outside),
            ("internal", &inside),
        ] {
            let link = root.join(name);
            assert!(link.starts_with(&base) && target.starts_with(&base));
            let result = std::process::Command::new("cmd.exe")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(target)
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
        }
        assert!(inside_root(&root, "domain/a.md").is_err());
        assert!(inside_root(&root, "internal/new.md").is_ok());
        assert!(read_note_at(&root, "domain/a.md").is_err());
        assert!(save_note_at(&root, "domain/a.md", "safe", "a", "bad", "").is_err());
        assert!(cover_bytes(&root.to_string_lossy(), "附件/a.png").is_err());
        assert!(save_attachment(&root.to_string_lossy(), "2026-10", "x.png", b"bad").is_err());
        assert!(count_notes_at(&root, "domain").is_err());
        assert!(delete_domain_at(&root, "domain").is_err());
        assert!(delete_note_at(&root, "domain/a.md").is_err());
        assert!(
            restore_domain(root.to_string_lossy().into_owned(), "domain".into(), vec![]).is_err()
        );
        assert!(list_notes(root.to_string_lossy().into_owned())
            .unwrap()
            .notes
            .is_empty());
        assert!(list_vault_tags(root.to_string_lossy().into_owned()).is_empty());
        assert!(!list_subfolders(root.to_string_lossy().into_owned()).contains(&"domain".into()));
        assert!(
            ensure_subfolder(root.to_string_lossy().into_owned(), "domain/new".into()).is_err()
        );
        assert!(!outside.join("2026-10").exists());
        assert!(!outside.join("new").exists());
        assert_eq!(fs::read(outside.join("a.png")).unwrap(), b"outside");
        assert!(fs::read_to_string(outside.join("a.md"))
            .unwrap()
            .contains("external"));
    }

    #[test]
    fn path_boundary_normal_nested_paths_and_absent_domain() {
        let v = TempVault::new("path-boundary-normal");
        ensure_subfolder(v.path(), "safe/nested".into()).unwrap();
        write(&v, "safe", "a", "inside").unwrap();
        assert_eq!(read_note_at(&v.0, "safe/a.md").unwrap().content, "inside");
        save_note_at(&v.0, "safe/a.md", "new-domain", "b", "updated", "inside").unwrap();
        let image = save_attachment(&v.path(), "2026-10", "a.png", b"image").unwrap();
        assert_eq!(cover_bytes(&v.path(), &image).unwrap(), b"image");
        assert!(inside_root(&v.0, "../outside.md").is_err());
        assert!(!delete_domain_at(&v.0, "absent").unwrap().existed);
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
    fn 读笔记_拆出属性和别的程序加的行() {
        let v = TempVault::new("read-note");
        write(
            &v,
            "设计UI",
            "配色",
            "---
title: \"配色\"
type: 图片
mode: 视觉收藏
tags: [\"a\"]
source: \"\"
created: 2026-10-20
cover: \"\"
schema: 1
aliases:
  - 别名
---

正文
",
        )
        .unwrap();
        let n = read_note_at(&PathBuf::from(v.path()), "设计UI/配色.md").unwrap();
        assert_eq!(n.title, "配色");
        assert_eq!(n.domain, "设计UI");
        assert_eq!(n.kind, "图片");
        assert_eq!(n.stem, "配色");
        assert_eq!(
            n.extra,
            "aliases:
  - 别名"
        );
        assert_eq!(n.content.trim(), "正文");
    }

    #[test]
    fn save_note_revision_rejects_external_frontmatter_changes() {
        let v = TempVault::new("revision-meta");
        let original = "---\ntitle: 原始\n---\n\n正文\n";
        let rel = write(&v, "其他", "原始", original).unwrap();
        let opened = read_note_at(&v.0, &rel).unwrap();
        assert_eq!(opened.original_text, original);
        let external = "---\ntitle: 外部\n---\n\n正文\n";
        fs::write(v.0.join(&rel), external).unwrap();
        let result = save_note_at(
            &v.0,
            &rel,
            "其他",
            "原始",
            "本地修改",
            &opened.original_text,
        );
        assert!(result.unwrap_err().contains("已被其他程序修改"));
        assert_eq!(fs::read_to_string(v.0.join(rel)).unwrap(), external);
        assert!(!v.0.join("其他/.原始.md.tmp").exists());
    }

    #[test]
    fn save_note_revision_rejects_stale_move_without_creating_destination() {
        let v = TempVault::new("revision-move");
        let rel = write(&v, "其他", "原始", "打开时原文").unwrap();
        let opened = read_note_at(&v.0, &rel).unwrap();
        fs::write(v.0.join(&rel), "外部新内容").unwrap();
        assert!(save_note_at(&v.0, &rel, "新领域", "新名", "本地", &opened.original_text).is_err());
        assert_eq!(fs::read_to_string(v.0.join(rel)).unwrap(), "外部新内容");
        assert!(!v.0.join("新领域").exists());
    }

    #[test]
    fn save_note_revision_deleted_file_is_not_recreated() {
        let v = TempVault::new("revision-deleted");
        let rel = write(&v, "其他", "原始", "原始内容").unwrap();
        let opened = read_note_at(&v.0, &rel).unwrap();
        fs::remove_file(v.0.join(&rel)).unwrap();
        assert!(save_note_at(
            &v.0,
            &rel,
            "新领域",
            "新名",
            "本地内容",
            &opened.original_text
        )
        .is_err());
        assert!(!v.0.join(rel).exists());
        assert!(!v.0.join("新领域").exists());
    }

    #[test]
    fn save_note_revision_new_baseline_allows_second_save_and_move() {
        let v = TempVault::new("revision-repeat");
        let rel = write(&v, "其他", "原始", "打开时原文").unwrap();
        let opened = read_note_at(&v.0, &rel).unwrap();
        save_note_at(
            &v.0,
            &rel,
            "其他",
            "原始",
            "第一次保存",
            &opened.original_text,
        )
        .unwrap();
        let latest = read_note_at(&v.0, &rel).unwrap();
        assert_eq!(latest.original_text, "第一次保存");
        let moved = save_note_at(
            &v.0,
            &rel,
            "新领域",
            "新名",
            "第二次保存",
            &latest.original_text,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(v.0.join(moved)).unwrap(), "第二次保存");
        assert!(!v.0.join(rel).exists());
    }

    #[test]
    fn 保存笔记_同位置覆盖_换领域和文件名会挪动() {
        let v = TempVault::new("save-note");
        let root = PathBuf::from(v.path());
        write(&v, "其他", "旧名", "旧").unwrap();
        let r = save_note_at(&root, "其他/旧名.md", "其他", "旧名", "新", "旧").unwrap();
        assert_eq!(r, "其他/旧名.md");
        assert_eq!(fs::read_to_string(root.join("其他/旧名.md")).unwrap(), "新");
        let r = save_note_at(&root, "其他/旧名.md", "设计UI", "新名", "更新", "新").unwrap();
        assert_eq!(r, "设计UI/新名.md");
        assert!(!root.join("其他/旧名.md").exists());
        assert_eq!(
            fs::read_to_string(root.join("设计UI/新名.md")).unwrap(),
            "更新"
        );
    }

    #[test]
    fn 保存笔记_目标已有同名笔记时拒绝_两边都不动() {
        let v = TempVault::new("save-conflict");
        let root = PathBuf::from(v.path());
        write(&v, "其他", "甲", "甲的内容").unwrap();
        write(&v, "设计UI", "甲", "别人的").unwrap();
        let e = save_note_at(&root, "其他/甲.md", "设计UI", "甲", "覆盖", "甲的内容").unwrap_err();
        assert!(e.contains("已经有"), "{e}");
        assert_eq!(
            fs::read_to_string(root.join("其他/甲.md")).unwrap(),
            "甲的内容"
        );
        assert_eq!(
            fs::read_to_string(root.join("设计UI/甲.md")).unwrap(),
            "别人的"
        );
        assert!(save_note_at(&root, "其他/甲.md", "..", "甲", "x", "甲的内容").is_err());
        assert!(save_note_at(&root, "../外面.md", "其他", "甲", "x", "").is_err());
    }

    #[test]
    fn 笔记里引用的附件_认出各种写法() {
        let text = "---
cover: \"../附件/2026-10/a.png\"
---

![](../附件/2026-10/a.png)

![说明](<../附件/2026-10/b c.png>)

![说明|330](<../附件/2026-10/b c.png>)

![网图](https://x.com/y.png)";
        assert_eq!(
            attachment_refs(text),
            vec!["附件/2026-10/a.png", "附件/2026-10/b c.png"]
        );
    }

    #[test]
    fn 删除笔记_进回收站后能原样还原_图片也回来() {
        let v = TempVault::new("trash-restore");
        let root = PathBuf::from(v.path());
        fs::create_dir_all(root.join("附件/2026-10")).unwrap();
        fs::write(root.join("附件/2026-10/还原测试.png"), b"img").unwrap();
        write(
            &v,
            "其他",
            "还原测试笔记",
            "![](../附件/2026-10/还原测试.png)

正文",
        )
        .unwrap();
        let images = delete_note_at(&root, "其他/还原测试笔记.md").unwrap();
        assert_eq!(images, vec!["附件/2026-10/还原测试.png".to_string()]);
        assert!(!root.join("其他/还原测试笔记.md").exists());
        assert!(!root.join("附件/2026-10/还原测试.png").exists());
        restore_note_at(&root, "其他/还原测试笔记.md", &images).unwrap();
        assert!(root.join("其他/还原测试笔记.md").is_file());
        assert_eq!(
            fs::read(root.join("附件/2026-10/还原测试.png")).unwrap(),
            b"img"
        );
        assert!(restore_note_at(&root, "../外面.md", &[]).is_err());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "操作真实 Windows 回收站，仅显式验收时运行"]
    fn native_recycle_domain_round_trip() {
        let v = TempVault::new("native-recycle-domain");
        let root = &v.0;
        fs::create_dir_all(root.join("附件/2026-10")).unwrap();
        fs::write(root.join("附件/2026-10/独占.png"), b"own-image").unwrap();
        fs::write(root.join("附件/2026-10/共享.png"), b"shared-image").unwrap();
        let text =
            "![独占](../附件/2026-10/独占.png)\n\n![共享](../附件/2026-10/共享.png)\n\n原始正文";
        let rel = write(&v, "待恢复领域", "恢复测试", text).unwrap();
        write(&v, "保留领域", "引用共享", "![](../附件/2026-10/共享.png)").unwrap();
        let original = fs::read(root.join(&rel)).unwrap();
        let deleted = delete_domain_at(root, "待恢复领域").unwrap();
        let dir_gone = !root.join("待恢复领域").exists();
        let own_gone = !root.join("附件/2026-10/独占.png").exists();
        let shared = fs::read(root.join("附件/2026-10/共享.png")).unwrap();
        restore_domain(v.path(), "待恢复领域".into(), deleted.images.clone()).unwrap();
        assert!(deleted.existed);
        assert_eq!(deleted.notes, 1);
        assert_eq!(deleted.images, vec!["附件/2026-10/独占.png".to_string()]);
        assert!(dir_gone && own_gone);
        assert_eq!(shared, b"shared-image");
        assert_eq!(fs::read(root.join(rel)).unwrap(), original);
        assert_eq!(
            fs::read(root.join("附件/2026-10/独占.png")).unwrap(),
            b"own-image"
        );
        assert!(root.join("保留领域/引用共享.md").is_file());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "操作真实 Windows 回收站，仅显式验收时运行"]
    fn native_recycle_collision_preserves_new_file_and_allows_retry() {
        let v = TempVault::new("native-recycle-collision");
        let rel = write(&v, "其他", "同名测试", "原始内容").unwrap();
        let path = v.0.join(&rel);
        let original = fs::read(&path).unwrap();
        let images = delete_note_at(&v.0, &rel).unwrap();
        fs::write(&path, b"new-content").unwrap();
        let conflict = restore_note_at(&v.0, &rel, &images);
        let new_content = fs::read(&path).unwrap();
        // 移除的仅是本用例写入的冲突文件，随后还原回收站中的原件。
        fs::remove_file(&path).unwrap();
        restore_note_at(&v.0, &rel, &images).unwrap();
        assert!(conflict.is_err());
        assert_eq!(new_content, b"new-content");
        assert_eq!(fs::read(path).unwrap(), original);
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "操作真实 Windows 回收站，仅显式验收时运行"]
    fn native_recycle_missing_item_does_not_partially_restore() {
        let v = TempVault::new("native-recycle-missing");
        let rel = write(&v, "其他", "缺项测试", "原始内容").unwrap();
        let original = fs::read(v.0.join(&rel)).unwrap();
        let images = delete_note_at(&v.0, &rel).unwrap();
        let missing = restore_note_at(&v.0, &rel, &["附件/从未存在.png".into()]);
        let note_still_deleted = !v.0.join(&rel).exists();
        restore_note_at(&v.0, &rel, &images).unwrap();
        assert!(missing.is_err());
        assert!(note_still_deleted);
        assert_eq!(fs::read(v.0.join(rel)).unwrap(), original);
    }

    #[test]
    fn 删除笔记_只被它用的图片一起删_别的笔记也在用的留下() {
        let v = TempVault::new("delete-note");
        let root = PathBuf::from(v.path());
        fs::create_dir_all(root.join("附件/2026-10")).unwrap();
        fs::write(root.join("附件/2026-10/own.png"), b"1").unwrap();
        fs::write(root.join("附件/2026-10/shared.png"), b"2").unwrap();
        write(
            &v,
            "其他",
            "甲",
            "![](../附件/2026-10/own.png)

![](../附件/2026-10/shared.png)",
        )
        .unwrap();
        write(&v, "设计UI", "乙", "![](../附件/2026-10/shared.png)").unwrap();
        let gone = unused_attachments(&root, "其他/甲.md").unwrap();
        assert_eq!(gone, vec!["附件/2026-10/own.png".to_string()]);
        assert!(unused_attachments(&root, "../外面.md").is_err());
    }

    #[test]
    fn edit_recovery_isolated_records_survive_reopen_and_clear_only_target() {
        let v = TempVault::new("edit-recovery");
        let dir = v.0.join("recovery");
        assert!(read_edit_recoveries_at(&dir).unwrap().is_empty());
        write_edit_recovery_at(&dir, "root-a", "note.md", Some("edit-a".into())).unwrap();
        write_edit_recovery_at(&dir, "root-b", "note.md", Some("edit-b".into())).unwrap();
        let records = read_edit_recoveries_at(&dir).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(
            records[&edit_recovery_key("root-a", "note.md").unwrap()],
            "edit-a"
        );
        write_edit_recovery_at(&dir, "root-a", "note.md", None).unwrap();
        let records = read_edit_recoveries_at(&dir).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(
            records[&edit_recovery_key("root-b", "note.md").unwrap()],
            "edit-b"
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn edit_recovery_corrupt_file_is_preserved_and_not_overwritten() {
        let v = TempVault::new("edit-recovery-corrupt");
        let dir = v.0.join("recovery");
        put_draft_file(&dir, "note-edits.json", b"corrupt").unwrap();
        assert!(write_edit_recovery_at(&dir, "root", "note.md", Some("edit".into())).is_err());
        assert_eq!(fs::read(dir.join("note-edits.json")).unwrap(), b"corrupt");
    }

    #[test]
    fn edit_recovery_survives_process_exit() {
        if let Ok(dir) = std::env::var("CONTENTTOMD_RECOVERY_TEST_DIR") {
            let dir = PathBuf::from(dir);
            if std::env::var("CONTENTTOMD_RECOVERY_TEST_PHASE").unwrap() == "write" {
                write_edit_recovery_at(
                    &dir,
                    "isolated-vault",
                    "note.md",
                    Some("unsaved-edit".into()),
                )
                .unwrap();
                // 直接退出，不运行编辑器卸载或额外清理，验证已落盘的检查点。
                std::process::exit(0);
            }
            let records = read_edit_recoveries_at(&dir).unwrap();
            assert_eq!(
                records[&edit_recovery_key("isolated-vault", "note.md").unwrap()],
                "unsaved-edit"
            );
            return;
        }
        let v = TempVault::new("edit-recovery-process");
        for phase in ["write", "read"] {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "tests::edit_recovery_survives_process_exit",
                    "--nocapture",
                ])
                .env("CONTENTTOMD_RECOVERY_TEST_DIR", v.0.join("recovery"))
                .env("CONTENTTOMD_RECOVERY_TEST_PHASE", phase)
                .status()
                .unwrap();
            assert!(status.success());
        }
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
    fn collection_inspection_reads_names_without_changing_notes() {
        let v = TempVault::new("inspect-collection");
        let empty = inspect_collection(v.path()).unwrap();
        assert!(!empty.has_notes);
        assert!(empty.domains.is_empty());
        for name in ["设计UI", "其他", "附件", ".obsidian"] {
            fs::create_dir_all(v.0.join(name)).unwrap();
        }
        fs::write(v.0.join("附件/忽略.md"), "附件不是笔记").unwrap();
        fs::write(v.0.join(".obsidian/忽略.md"), "内部文件").unwrap();
        let dirs = inspect_collection(v.path()).unwrap();
        assert_eq!(dirs.domains, vec!["其他", "设计UI"]);
        assert!(!dirs.has_notes);
        let note = v.0.join("设计UI/已有.MD");
        fs::write(&note, [0xff, 0xfe]).unwrap();
        assert!(inspect_collection(v.path()).unwrap().has_notes);
        assert_eq!(fs::read(&note).unwrap(), vec![0xff, 0xfe]);
        fs::remove_file(note).unwrap();
        fs::write(v.0.join("根目录.md"), "已有根目录笔记").unwrap();
        assert!(inspect_collection(v.path()).unwrap().has_notes);
        assert!(inspect_collection(v.0.join("不存在").to_string_lossy().into_owned()).is_err());
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

    #[test]
    fn 仓库清单只列出还在且有_obsidian_的文件夹() {
        let v = TempVault::new("obsidian-list");
        let good = v.0.join("我的笔记");
        fs::create_dir_all(good.join(".obsidian")).unwrap();
        let plain = v.0.join("普通");
        fs::create_dir_all(&plain).unwrap();
        let json = serde_json::json!({ "vaults": {
            "a": { "path": good.to_string_lossy(), "ts": 1 },
            "b": { "path": plain.to_string_lossy(), "ts": 2 },
            "c": { "path": v.0.join("删掉了").to_string_lossy(), "ts": 3 }
        }})
        .to_string();
        let list = parse_obsidian_vaults(&json);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "我的笔记");
        assert_eq!(list[0].path, good.to_string_lossy());
        assert!(parse_obsidian_vaults("不是 json").is_empty());
    }

    #[test]
    fn 收藏库列表只读领域文件夹里的笔记() {
        let v = TempVault::new("list-notes");
        write(
            &v,
            "设计UI",
            "配色",
            "---\ntitle: \"Dribbble 配色\"\ndomain: \"设计UI\"\ntags: [\"配色\", \"UI\"]\nkeywords: [\"仪表盘\"]\ncreated: 2026-10-18\ncover: \"附件/2026-10/a.png\"\n---\n\n正文第一段",
        )
        .unwrap();
        write(&v, "为人处世", "没有属性", "只有正文").unwrap();
        fs::create_dir_all(v.0.join("附件").join("2026-10")).unwrap();
        fs::write(v.0.join("附件").join("2026-10").join("说明.md"), "不是笔记").unwrap();
        fs::create_dir_all(v.0.join(".obsidian")).unwrap();
        fs::write(v.0.join(".obsidian").join("x.md"), "隐藏").unwrap();
        fs::write(v.0.join("最外层.md"), "不在领域文件夹里").unwrap();
        fs::write(v.0.join("设计UI").join("坏的.md"), [0xff, 0xfe, 0x00]).unwrap();

        let list = list_notes(v.path()).unwrap();
        let mut notes = list.notes;
        notes.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(notes.len(), 2);
        let n = &notes[0];
        assert_eq!(n.path, "为人处世/没有属性.md");
        assert_eq!(n.title, "没有属性"); // 没有 frontmatter 时用文件名
        assert_eq!(n.domain, "为人处世");
        assert_eq!(n.body, "只有正文");
        let n = &notes[1];
        assert_eq!(n.path, "设计UI/配色.md");
        assert_eq!(n.title, "Dribbble 配色");
        assert_eq!(n.tags, ["配色", "UI"]);
        assert_eq!(n.keywords, ["仪表盘"]);
        assert_eq!(n.created, "2026-10-18");
        assert_eq!(n.cover, "附件/2026-10/a.png");
        assert_eq!(n.body.trim(), "正文第一段");
        assert_eq!(list.failed, ["设计UI/坏的.md"]);
        assert!(list_notes(v.0.join("不存在").to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn 封面只能读附件文件夹里的() {
        let v = TempVault::new("read-cover");
        fs::create_dir_all(v.0.join("附件").join("2026-10")).unwrap();
        fs::write(v.0.join("附件").join("2026-10").join("a.png"), [1u8, 2, 3]).unwrap();
        fs::write(v.0.join("秘密.txt"), "x").unwrap();
        assert_eq!(
            cover_bytes(&v.path(), "附件/2026-10/a.png").unwrap(),
            [1u8, 2, 3]
        );
        assert!(cover_bytes(&v.path(), "秘密.txt").is_err());
        assert!(cover_bytes(&v.path(), "附件/../秘密.txt").is_err());
    }

    #[test]
    fn 列出仓库里的文件夹_跳过隐藏的() {
        let v = TempVault::new("list-folders");
        for d in [
            ".obsidian/plugins",
            ".trash",
            "收藏/抖音",
            "工作",
            "a/b/c/d",
        ] {
            fs::create_dir_all(v.0.join(d)).unwrap();
        }
        fs::write(v.0.join("笔记.md"), "x").unwrap();
        assert_eq!(
            list_subfolders(v.path()),
            ["a", "a/b", "a/b/c", "工作", "收藏", "收藏/抖音"]
        );
    }

    #[test]
    fn 子文件夹建在仓库里_不能跳出去() {
        let v = TempVault::new("subfolder");
        ensure_subfolder(v.path(), "收藏/抖音".into()).unwrap();
        assert!(v.0.join("收藏").join("抖音").is_dir());
        assert!(ensure_subfolder(v.path(), "../外面".into()).is_err());
        assert!(ensure_subfolder(v.path(), "C:/Windows".into()).is_err());
        assert!(!v.0.parent().unwrap().join("外面").exists());
    }
}
