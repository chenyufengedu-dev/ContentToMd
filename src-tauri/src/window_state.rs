use std::{sync::mpsc, time::Duration};
use tauri::{Manager, PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

pub fn track(window: &WebviewWindow) {
    let (sender, receiver) = mpsc::sync_channel(1);
    let window_copy = window.clone();
    std::thread::spawn(move || {
        persist_changes(receiver, || {
            if window_copy.is_minimized().unwrap_or(true) {
                return;
            }
            if let Err(error) = window_copy.app_handle().save_window_state(flags()) {
                eprintln!("无法保存窗口状态：{error}");
            }
        });
    });
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            // 连续拖动只需要保留一次待写通知，实际写入时读取最新窗口状态。
            let _ = sender.try_send(());
        }
    });
}

fn persist_changes(receiver: mpsc::Receiver<()>, mut save: impl FnMut()) {
    while receiver.recv().is_ok() {
        while receiver.recv_timeout(Duration::from_millis(300)).is_ok() {}
        save();
    }
}

pub fn flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

pub fn restore(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    // 先恢复普通窗口并校正边界，再恢复最大化，避免把最大化尺寸记成普通尺寸。
    window.restore_state(StateFlags::SIZE | StateFlags::POSITION)?;
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let work = *monitor.work_area();
        let scale = window.scale_factor()?;
        let inner = window.inner_size()?;
        let outer = window.outer_size()?;
        let frame = PhysicalSize::new(
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        );
        if let Some(config) = window
            .app_handle()
            .config()
            .app
            .windows
            .iter()
            .find(|c| c.label == window.label())
        {
            window.set_min_size(Some(PhysicalSize::new(
                ((config.min_width.unwrap_or_default() * scale).round() as u32)
                    .min(work.size.width.saturating_sub(frame.width)),
                ((config.min_height.unwrap_or_default() * scale).round() as u32)
                    .min(work.size.height.saturating_sub(frame.height)),
            )))?;
        }
        let fitted = fit_bounds(
            PhysicalRect {
                position: window.outer_position()?,
                size: outer,
            },
            work,
        );
        if fitted.size != outer {
            window.set_size(PhysicalSize::new(
                fitted.size.width.saturating_sub(frame.width),
                fitted.size.height.saturating_sub(frame.height),
            ))?;
        }
        window.set_position(fitted.position)?;
    }
    window.restore_state(StateFlags::MAXIMIZED)?;
    Ok(())
}

fn fit_bounds(
    bounds: PhysicalRect<i32, u32>,
    work: PhysicalRect<i32, u32>,
) -> PhysicalRect<i32, u32> {
    let width = bounds.size.width.min(work.size.width);
    let height = bounds.size.height.min(work.size.height);
    let left = i64::from(work.position.x);
    let top = i64::from(work.position.y);
    let x = i64::from(bounds.position.x).clamp(left, left + i64::from(work.size.width - width));
    let y = i64::from(bounds.position.y).clamp(top, top + i64::from(work.size.height - height));
    PhysicalRect {
        position: PhysicalPosition::new(x as i32, y as i32),
        size: PhysicalSize::new(width, height),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{PhysicalPosition, PhysicalSize};

    #[test]
    fn window_changes_are_saved_before_exit_and_bursts_are_coalesced() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let (saved, writes) = mpsc::channel();
        let worker =
            std::thread::spawn(move || persist_changes(receiver, || saved.send(()).unwrap()));
        sender.send(()).unwrap();
        sender.send(()).unwrap();
        assert!(writes.recv_timeout(Duration::from_millis(50)).is_err());
        writes.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(writes.try_recv().is_err());
        sender.send(()).unwrap();
        writes.recv_timeout(Duration::from_secs(2)).unwrap();
        drop(sender);
        worker.join().unwrap();
    }

    fn rect(x: i32, y: i32, width: u32, height: u32) -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(x, y),
            size: PhysicalSize::new(width, height),
        }
    }

    fn assert_rect(actual: PhysicalRect<i32, u32>, expected: PhysicalRect<i32, u32>) {
        assert_eq!(actual.position, expected.position);
        assert_eq!(actual.size, expected.size);
    }

    #[test]
    fn window_bounds_keeps_visible_window_on_negative_monitor() {
        let bounds = rect(-1700, 60, 1300, 850);
        assert_rect(fit_bounds(bounds, rect(-1920, 0, 1920, 1040)), bounds);
    }

    #[test]
    fn window_bounds_clamps_size_and_position_after_switching_screens() {
        assert_rect(
            fit_bounds(rect(1500, 700, 1600, 1100), rect(0, 0, 1280, 984)),
            rect(0, 0, 1280, 984),
        );
    }

    #[test]
    fn window_bounds_moves_partially_hidden_window_inside_work_area() {
        assert_rect(
            fit_bounds(rect(-90, 600, 1000, 680), rect(0, 40, 1920, 1000)),
            rect(0, 360, 1000, 680),
        );
    }
}
