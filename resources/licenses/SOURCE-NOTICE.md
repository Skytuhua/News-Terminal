# MPL-covered library source availability

This distribution includes the Source Code Form of the MPL-2.0 libraries below in `sources/`. The `.crate` files are gzip-compressed tar archives; extract with `tar -xzf filename.crate`. They are the exact published packages used by the resolved Cargo build, not a promise to supply source later.

The generator verifies the archive SHA-256 against Cargo.lock and every archived file against the actual resolved registry source, and rejects additional source files. No modifications were found. If any covered library is modified, replace this unmodified-source workflow with an archive of the actual modified Source Code Form and preserve its MPL notices. Do not distribute the original archive as though it represented modified code.

The covered source remains available under MPL 2.0. These rights are not restricted by the application license. Full MPL text: [Mozilla Public License 2.0](upstream/selectors-0.36.1/LICENSE-MPL-2.0.txt). Existing copyright, patent and license notices remain intact within each source archive. This source notice and the archives must accompany the installed application and any standalone binary distribution.

| Package | Bundled source | Upstream download | SHA-256 | Verified files |
|---|---|---|---|---|
| cargo:cssparser@0.36.0 | [cssparser-0.36.0.crate](sources/cssparser-0.36.0.crate) | [exact version](https://crates.io/api/v1/crates/cssparser/0.36.0/download) | `dae61cf9c0abb83bd659dab65b7e4e38d8236824c85f0f804f173567bda257d2` | 24 |
| cargo:cssparser-macros@0.6.1 | [cssparser-macros-0.6.1.crate](sources/cssparser-macros-0.6.1.crate) | [exact version](https://crates.io/api/v1/crates/cssparser-macros/0.6.1/download) | `13b588ba4ac1a99f7f2964d24b3d896ddc6bf847ee3855dbd4366f058cfcd331` | 5 |
| cargo:dtoa-short@0.3.5 | [dtoa-short-0.3.5.crate](sources/dtoa-short-0.3.5.crate) | [exact version](https://crates.io/api/v1/crates/dtoa-short/0.3.5/download) | `cd1511a7b6a56299bd043a9c167a6d2bfb37bf84a6dfceaba651168adfb43c87` | 6 |
| cargo:option-ext@0.2.0 | [option-ext-0.2.0.crate](sources/option-ext-0.2.0.crate) | [exact version](https://crates.io/api/v1/crates/option-ext/0.2.0/download) | `04744f49eae99ab78e0d5c0b603ab218f515ea8cfe5a456d7629ad883a3b6e7d` | 8 |
| cargo:selectors@0.36.1 | [selectors-0.36.1.crate](sources/selectors-0.36.1.crate) | [exact version](https://crates.io/api/v1/crates/selectors/0.36.1/download) | `c5d9c0c92a92d33f08817311cf3f2c29a3538a8240e94a6a3c622ce652d7e00c` | 22 |
