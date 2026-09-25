// Physical desktop coordinates; monitors left of the primary have negative x.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn visible_bounds(saved: Rect, monitors: &[Rect]) -> Rect {
    let Some(monitor) = monitors
        .iter()
        .filter(|m| m.width > 0 && m.height > 0)
        .max_by_key(|m| {
            let w = ((saved.x as i64 + saved.width as i64).min(m.x as i64 + m.width as i64)
                - (saved.x as i64).max(m.x as i64))
            .max(0);
            let h = ((saved.y as i64 + saved.height as i64).min(m.y as i64 + m.height as i64)
                - (saved.y as i64).max(m.y as i64))
            .max(0);
            w as u128 * h as u128
        })
    else {
        return saved;
    };
    let width = saved.width.max(400).min(monitor.width.max(1));
    let height = saved.height.max(300).min(monitor.height.max(1));
    Rect {
        x: (saved.x as i64).clamp(
            monitor.x as i64,
            monitor.x as i64 + monitor.width as i64 - width as i64,
        ) as i32,
        y: (saved.y as i64).clamp(
            monitor.y as i64,
            monitor.y as i64 + monitor.height as i64 - height as i64,
        ) as i32,
        width,
        height,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TileLayout {
    Full,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
}

// Returned dimensions are INNER physical pixels; x/y are OUTER coordinates.
pub fn tile_bounds(
    work: Rect,
    scale: f64,
    frame: Frame,
    layout: TileLayout,
) -> Result<Rect, String> {
    if !scale.is_finite()
        || scale <= 0.0
        || work.width == 0
        || work.height == 0
        || work.x as i64 + work.width as i64 > i32::MAX as i64
        || work.y as i64 + work.height as i64 > i32::MAX as i64
    {
        return Err("Monitor geometry is invalid".into());
    }
    let (offset, width) = match layout {
        TileLayout::Full => (0, work.width),
        TileLayout::Left => (0, work.width / 2),
        TileLayout::Right => (work.width / 2, work.width - work.width / 2),
    };
    let inner_width = width.saturating_sub(frame.width);
    let inner_height = work.height.saturating_sub(frame.height);
    if (inner_width as f64) < (640.0 * scale).ceil()
        || (inner_height as f64) < (480.0 * scale).ceil()
    {
        return Err("Monitor layout is too small for the 640 × 480 logical-pixel minimum including window decorations".into());
    }
    Ok(Rect {
        x: (work.x as i64 + offset as i64) as i32,
        y: work.y,
        width: inner_width,
        height: inner_height,
    })
}

pub fn restore_bounds(saved: Rect, work: Rect, scale: f64, frame: Frame) -> Result<Rect, String> {
    let maximum = tile_bounds(work, scale, frame, TileLayout::Full)?;
    let width = saved
        .width
        .clamp((640.0 * scale).ceil() as u32, maximum.width);
    let height = saved
        .height
        .clamp((480.0 * scale).ceil() as u32, maximum.height);
    Ok(Rect {
        x: (saved.x as i64).clamp(
            work.x as i64,
            work.x as i64 + work.width as i64 - width as i64 - frame.width as i64,
        ) as i32,
        y: (saved.y as i64).clamp(
            work.y as i64,
            work.y as i64 + work.height as i64 - height as i64 - frame.height as i64,
        ) as i32,
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn negative_monitor_left_half_accounts_for_frame_and_target_dpi() {
        let work = super::Rect {
            x: -2560,
            y: -300,
            width: 2560,
            height: 1400,
        };
        let got = super::tile_bounds(
            work,
            1.5,
            super::Frame {
                width: 24,
                height: 58,
            },
            super::TileLayout::Left,
        )
        .unwrap();
        assert_eq!(
            got,
            super::Rect {
                x: -2560,
                y: -300,
                width: 1256,
                height: 1342
            }
        );
    }

    use super::*;
    #[test]
    fn right_odd_width_uses_remaining_pixel_without_gap() {
        let work = Rect {
            x: -2561,
            y: 40,
            width: 2561,
            height: 1400,
        };
        let right = tile_bounds(
            work,
            1.5,
            Frame {
                width: 24,
                height: 58,
            },
            TileLayout::Right,
        )
        .unwrap();
        assert_eq!(
            right,
            Rect {
                x: -1281,
                y: 40,
                width: 1257,
                height: 1342
            }
        );
    }

    #[test]
    fn rejects_tiles_below_logical_minimum_at_target_scale() {
        let work = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        assert!(tile_bounds(
            work,
            1.5,
            Frame {
                width: 16,
                height: 39
            },
            TileLayout::Left
        )
        .is_err());
        assert!(tile_bounds(
            work,
            1.0,
            Frame {
                width: 16,
                height: 39
            },
            TileLayout::Left
        )
        .is_ok());
        assert!(tile_bounds(
            Rect {
                height: 750,
                ..work
            },
            1.5,
            Frame {
                width: 16,
                height: 39
            },
            TileLayout::Full
        )
        .is_err());
    }

    #[test]
    fn rejects_invalid_scales_and_unrepresentable_desktop_coordinates() {
        let work = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        for scale in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
            assert!(tile_bounds(work, scale, Frame::default(), TileLayout::Full).is_err());
        }
        assert!(tile_bounds(
            Rect {
                x: i32::MAX,
                ..work
            },
            1.0,
            Frame::default(),
            TileLayout::Right
        )
        .is_err());
        assert!(tile_bounds(
            Rect {
                y: i32::MAX,
                ..work
            },
            1.0,
            Frame::default(),
            TileLayout::Full
        )
        .is_err());
    }

    #[test]
    fn restart_restoration_clamps_outer_frame_and_logical_minimum() {
        let work = Rect {
            x: -1920,
            y: -1080,
            width: 1920,
            height: 1040,
        };
        let frame = Frame {
            width: 24,
            height: 58,
        };
        let huge = restore_bounds(
            Rect {
                x: 4000,
                y: 4000,
                width: 3000,
                height: 2000,
            },
            work,
            1.5,
            frame,
        )
        .unwrap();
        assert_eq!(
            huge,
            Rect {
                x: -1920,
                y: -1080,
                width: 1896,
                height: 982
            }
        );
        let tiny = restore_bounds(
            Rect {
                x: -1910,
                y: -1070,
                width: 100,
                height: 80,
            },
            work,
            1.5,
            frame,
        )
        .unwrap();
        assert_eq!(
            tiny,
            Rect {
                x: -1910,
                y: -1070,
                width: 960,
                height: 720
            }
        );
    }

    #[test]
    fn restore_selection_ignores_empty_monitors_and_cannot_overflow_on_corrupt_saved_sizes() {
        let extreme = Rect {
            x: i32::MIN,
            y: i32::MIN,
            width: u32::MAX,
            height: u32::MAX,
        };
        assert_eq!(visible_bounds(extreme, &[extreme]), extreme);
        let empty = Rect {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        };
        assert_eq!(visible_bounds(extreme, &[empty]), extreme);
    }

    #[test]
    fn full_and_split_tiles_remain_inside_work_area_across_dpi_matrix() {
        for scale in [1.0_f64, 1.25, 1.5, 1.75, 2.0] {
            for (width, height) in [(1366, 728), (1920, 1040), (2561, 1400), (3840, 2080)] {
                let work = Rect {
                    x: -3840,
                    y: -2080,
                    width,
                    height,
                };
                let frame = Frame {
                    width: (16.0 * scale).ceil() as u32,
                    height: (39.0 * scale).ceil() as u32,
                };
                for layout in [TileLayout::Full, TileLayout::Left, TileLayout::Right] {
                    if let Ok(rect) = tile_bounds(work, scale, frame, layout) {
                        assert!(rect.width as f64 >= (640.0 * scale).ceil());
                        assert!(rect.height as f64 >= (480.0 * scale).ceil());
                        assert!(rect.x >= work.x && rect.y >= work.y);
                        assert!(
                            rect.x as i64 + rect.width as i64 + frame.width as i64
                                <= work.x as i64 + work.width as i64
                        );
                        assert!(
                            rect.y as i64 + rect.height as i64 + frame.height as i64
                                <= work.y as i64 + work.height as i64
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn missing_monitor_recovers_entire_window() {
        let display = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let saved = Rect {
            x: 2200,
            y: 80,
            width: 1000,
            height: 700,
        };
        let got = visible_bounds(saved, &[display]);
        assert!(got.x >= 0 && got.x as i64 + got.width as i64 <= 1920);
    }
}
