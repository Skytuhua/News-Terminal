// Isolated harness compiles the same production modules while other owners integrate.
#![allow(dead_code)]
#[path = "../../src/rights.rs"]
mod rights;
#[path = "../../src/media.rs"]
mod media;
#[path = "../../src/services.rs"]
mod services;
