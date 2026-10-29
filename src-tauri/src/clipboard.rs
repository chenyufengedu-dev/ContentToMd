use clipboard_win::{formats, options::NoClear, raw, Clipboard, Format, Getter, Setter};

#[derive(serde::Serialize)]
pub struct ClipboardText {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    html: Option<String>,
}

#[tauri::command]
pub fn read_clipboard(include_html: bool) -> Result<ClipboardText, String> {
    let _clipboard = Clipboard::new_attempts(10).map_err(|_| "剪贴板正忙，请稍后重试。")?;
    let mut text = String::new();
    if formats::Unicode.is_format_avail() {
        formats::Unicode
            .read_clipboard(&mut text)
            .map_err(|_| "无法读取剪贴板文字，请重试。")?;
    }
    let mut html = None;
    if include_html {
        if let Some(format) = formats::Html::new().filter(|format| format.is_format_avail()) {
            let mut value = String::new();
            format
                .read_clipboard(&mut value)
                .map_err(|_| "无法读取剪贴板格式，请重试。")?;
            html = Some(value);
        }
    }
    Ok(ClipboardText { text, html })
}

#[tauri::command]
pub fn write_clipboard(text: String, html: Option<String>) -> Result<(), String> {
    let format = html
        .as_ref()
        .map(|_| formats::Html::new().ok_or("无法创建剪贴板格式。"))
        .transpose()?;
    let _clipboard = Clipboard::new_attempts(10).map_err(|_| "剪贴板正忙，请稍后重试。")?;
    formats::Unicode
        .write_clipboard(&text)
        .map_err(|_| "无法复制文字，请重试。")?;
    if let (Some(format), Some(html)) = (format, html) {
        // 写入第二种格式时保留纯文字，供普通输入框和其它软件使用。
        raw::set_html_with(format.code(), &html, NoClear)
            .map_err(|_| "无法复制文字格式，请重试。")?;
    }
    Ok(())
}
