use tauri::{Manager, PhysicalPosition, PhysicalRect, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::{StateFlags, WindowExt};

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
