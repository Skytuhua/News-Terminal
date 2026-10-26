// The desktop host calls entry points that this standalone library cannot call.
// Allow unused code only in the production modules containing those entry points.
#[path = "../src/briefing.rs"]
pub mod briefing;
#[allow(dead_code)]
#[path = "../src/db.rs"]
pub mod db;
#[path = "../src/intelligence.rs"]
pub mod intelligence;
#[path = "../src/media.rs"]
pub mod media;
#[path = "../src/rights.rs"]
pub mod rights;
#[allow(dead_code)]
#[path = "../src/sector_summary.rs"]
mod sector_summary;
#[allow(dead_code)]
#[path = "../src/services.rs"]
pub mod services;
#[path = "../src/topics.rs"]
pub mod topics;

#[allow(dead_code)]
#[path = "../src/native_lifecycle.rs"]
mod native_lifecycle;
