//! Calendar regressions use explicit offsets, never the host's configured timezone.
use chrono::{FixedOffset, LocalResult, NaiveDate, NaiveDateTime, TimeZone};
use news_terminal_lib::briefing::{bounds_in_timezone, build, local_day};
use serde_json::json;

#[derive(Clone)]
struct Pacific2026;
fn dt(raw: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M").unwrap()
}
fn offset(hours: i32) -> FixedOffset {
    FixedOffset::east_opt(hours * 3600).unwrap()
}
// A deterministic timezone fixture for the two Pacific transitions in 2026.
// Production uses chrono::Local; no process-global timezone mutation is required.
impl TimeZone for Pacific2026 {
    type Offset = FixedOffset;
    fn from_offset(_: &Self::Offset) -> Self {
        Self
    }
    fn offset_from_local_date(&self, date: &NaiveDate) -> LocalResult<Self::Offset> {
        self.offset_from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
    }
    fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> LocalResult<Self::Offset> {
        if *local >= dt("2026-03-08 02:00") && *local < dt("2026-03-08 03:00") {
            LocalResult::None
        } else if *local >= dt("2026-11-01 01:00") && *local < dt("2026-11-01 02:00") {
            LocalResult::Ambiguous(offset(-7), offset(-8))
        } else {
            LocalResult::Single(offset(
                if *local >= dt("2026-03-08 03:00") && *local < dt("2026-11-01 01:00") {
                    -7
                } else {
                    -8
                },
            ))
        }
    }
    fn offset_from_utc_date(&self, date: &NaiveDate) -> Self::Offset {
        self.offset_from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
    }
    fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> Self::Offset {
        offset(
            if *utc >= dt("2026-03-08 10:00") && *utc < dt("2026-11-01 09:00") {
                -7
            } else {
                -8
            },
        )
    }
}

#[test]
fn local_midnights_are_resolved_independently_across_dst_transitions() {
    for (date, hours, start, end) in [
        ("2026-03-08", 23, "2026-03-08 08:00", "2026-03-09 07:00"),
        ("2026-11-01", 25, "2026-11-01 07:00", "2026-11-02 08:00"),
    ] {
        let day = bounds_in_timezone(
            NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            &Pacific2026,
        )
        .unwrap();
        assert_eq!(day.start, dt(start).and_utc().timestamp());
        assert_eq!(day.end, dt(end).and_utc().timestamp());
        assert_eq!(day.end - day.start, hours * 3600);
        let entries = vec![
            json!({"id":"start","publishedAt":day.start}),
            json!({"id":"last","publishedAt":day.end-1}),
            json!({"id":"end","publishedAt":day.end}),
        ];
        assert_eq!(
            build(&entries, &json!({}), &day, day.end)["articleCount"],
            2
        );
    }
}

// One real offset jump, specified in UTC. The same fixture supports gaps,
// folds, and a date-line jump without changing process-global timezone state.
#[derive(Clone)]
struct OffsetJump {
    utc: NaiveDateTime,
    before: FixedOffset,
    after: FixedOffset,
    local_lookups: std::cell::Cell<usize>,
}
impl TimeZone for OffsetJump {
    type Offset = FixedOffset;
    fn from_offset(_: &Self::Offset) -> Self {
        unreachable!("fixture is always supplied explicitly")
    }
    fn offset_from_local_date(&self, date: &NaiveDate) -> LocalResult<Self::Offset> {
        self.offset_from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
    }
    fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> LocalResult<Self::Offset> {
        let before = *local - self.before < self.utc;
        self.local_lookups.set(self.local_lookups.get() + 1);
        let after = *local - self.after >= self.utc;
        match (before, after) {
            (true, true) => LocalResult::Ambiguous(self.before, self.after),
            (true, false) => LocalResult::Single(self.before),
            (false, true) => LocalResult::Single(self.after),
            (false, false) => LocalResult::None,
        }
    }
    fn offset_from_utc_date(&self, date: &NaiveDate) -> Self::Offset {
        self.offset_from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
    }
    fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> Self::Offset {
        if *utc < self.utc {
            self.before
        } else {
            self.after
        }
    }
}

#[test]
fn missing_midnight_partitions_both_adjacent_dates_without_losing_real_instants() {
    // America/Santiago's 2026 midnight spring-forward transition.
    let zone = OffsetJump {
        utc: dt("2026-09-06 04:00"),
        before: offset(-4),
        after: offset(-3),
        local_lookups: Default::default(),
    };
    let mut previous_end = None;
    for (date, start, end) in [
        ("2026-09-05", "2026-09-05 04:00", "2026-09-06 04:00"),
        ("2026-09-06", "2026-09-06 04:00", "2026-09-07 03:00"),
    ] {
        let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
        let day = bounds_in_timezone(date, &zone).expect("valid date despite missing midnight");
        assert_eq!(day.start, dt(start).and_utc().timestamp());
        assert_eq!(day.end, dt(end).and_utc().timestamp());
        if let Some(end) = previous_end {
            assert_eq!(
                day.start, end,
                "adjacent half-open days must share a boundary"
            );
        }
        previous_end = Some(day.end);
        // Check every real second, plus excluded neighbours, against local date membership.
        for instant in day.start - 1..=day.end {
            assert_eq!(
                instant >= day.start && instant < day.end,
                zone.timestamp_opt(instant, 0).unwrap().date_naive() == date,
            );
        }
        let entries = [day.start - 1, day.start, day.end - 1, day.end]
            .map(|t| json!({"id":t.to_string(),"publishedAt":t}));
        assert_eq!(
            build(&entries, &json!({}), &day, day.end)["articleCount"],
            2
        );
    }
}

#[test]
fn skipped_date_errors_explicitly_but_previous_date_ends_at_next_real_date() {
    // Pacific/Apia skipped 2011-12-30 entirely in its date-line change.
    let zone = OffsetJump {
        utc: dt("2011-12-30 10:00"),
        before: offset(-10),
        after: offset(14),
        local_lookups: Default::default(),
    };
    let skipped = NaiveDate::from_ymd_opt(2011, 12, 30).unwrap();
    let error = bounds_in_timezone(skipped, &zone).unwrap_err();
    assert!(error.contains("calendar date does not exist"), "{error}");
    assert!(
        zone.local_lookups.get() <= 37,
        "skipped dates must not scan every second"
    );
    let previous = bounds_in_timezone(skipped.pred_opt().unwrap(), &zone)
        .expect("a skipped following date must not break a real date");
    let next = bounds_in_timezone(skipped.succ_opt().unwrap(), &zone).unwrap();
    assert_eq!(previous.start, dt("2011-12-29 10:00").and_utc().timestamp());
    assert_eq!(previous.end, dt("2011-12-30 10:00").and_utc().timestamp());
    assert_eq!(previous.end, next.start);
    assert_eq!(next.end, dt("2011-12-31 10:00").and_utc().timestamp());
    let entries = [previous.start, previous.end - 1, previous.end]
        .map(|t| json!({"id":t.to_string(),"publishedAt":t}));
    assert_eq!(
        build(&entries, &json!({}), &previous, next.end)["articleCount"],
        2
    );
    assert_eq!(
        build(&entries, &json!({}), &next, next.end)["articleCount"],
        1
    );
}

#[test]
fn leading_gaps_resolve_exact_seconds_with_bounded_timezone_lookups() {
    let date = NaiveDate::from_ymd_opt(2026, 9, 6).unwrap();
    for seconds in [1, 1817, 3617, 86_399] {
        let zone = OffsetJump {
            utc: date.and_hms_opt(0, 0, 0).unwrap(),
            before: offset(0),
            after: FixedOffset::east_opt(seconds).unwrap(),
            local_lookups: Default::default(),
        };
        let day = bounds_in_timezone(date, &zone).unwrap();
        assert_eq!(day.start, zone.utc.and_utc().timestamp());
        assert_eq!(day.end - day.start, i64::from(86_400 - seconds));
        assert!(zone.local_lookups.get() <= 38, "bounded leading-gap search");
        assert_eq!(zone.timestamp_opt(day.start, 0).unwrap().date_naive(), date);
        assert_ne!(
            zone.timestamp_opt(day.start - 1, 0).unwrap().date_naive(),
            date
        );
        assert_eq!(
            zone.timestamp_opt(day.end - 1, 0).unwrap().date_naive(),
            date
        );
        assert_ne!(zone.timestamp_opt(day.end, 0).unwrap().date_naive(), date);
    }
}

#[test]
fn ambiguous_midnight_keeps_earliest_instant_and_both_repeated_hours() {
    let zone = OffsetJump {
        utc: dt("2026-11-01 04:00"),
        before: offset(-3),
        after: offset(-4),
        local_lookups: Default::default(),
    };
    let date = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
    let day = bounds_in_timezone(date, &zone).unwrap();
    assert_eq!(day.start, dt("2026-11-01 03:00").and_utc().timestamp());
    assert_eq!(day.end, dt("2026-11-02 04:00").and_utc().timestamp());
    assert_eq!(zone.local_lookups.get(), 2, "ordinary/fold fast path");
    let previous = bounds_in_timezone(date.pred_opt().unwrap(), &zone).unwrap();
    assert_eq!(previous.end, day.start);
    let entries = ["2026-11-01 03:30", "2026-11-01 04:30"]
        .map(|t| json!({"id":t,"publishedAt":dt(t).and_utc().timestamp()}));
    assert_eq!(
        build(&entries, &json!({}), &day, day.end)["articleCount"],
        2
    );
}

#[test]
fn date_adapter_handles_leap_days_offsets_and_invalid_timestamps() {
    let date = NaiveDate::from_ymd_opt(2024, 2, 29).unwrap();
    let day =
        bounds_in_timezone(date, &FixedOffset::east_opt(5 * 3600 + 45 * 60).unwrap()).unwrap();
    assert_eq!(day.date, "2024-02-29");
    assert_eq!(day.start, dt("2024-02-28 18:15").and_utc().timestamp());
    assert_eq!(day.end, dt("2024-02-29 18:15").and_utc().timestamp());
    assert!(bounds_in_timezone(NaiveDate::MAX, &chrono::Utc).is_err());
    assert!(local_day(None, i64::MAX).is_err());
    assert!(local_day(Some("2025-02-29"), 1_800_000_000).is_err());
}
