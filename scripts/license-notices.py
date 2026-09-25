"""Offline, lockfile-bound license capture; Python >=3.11 and Cargo required.

Run after npm ci and cargo fetch --locked --manifest-path src-tauri/Cargo.toml.
No package installation, network request, source modification, or license inference.
--check reconstructs in memory and rejects stale/missing/extra generated files.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import io
import tarfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "resources/licenses"
TARGET = "x86_64-pc-windows-msvc"
PREFIXES = ("license", "licence", "copying", "copyright", "notice", "unlicense")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def metadata(target=None):
    command = ["cargo", "metadata", "--locked", "--offline", "--format-version", "1",
               "--manifest-path", str(ROOT / "src-tauri/Cargo.toml")]
    if target:
        command += ["--filter-platform", target]
    return json.loads(subprocess.check_output(command, cwd=ROOT))


def closure(meta, normal_only=False):
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    found = set()
    pending = list(meta["workspace_members"])
    while pending:
        current = pending.pop()
        if current in found:
            continue
        found.add(current)
        for dep in nodes[current]["deps"]:
            if not normal_only or any(k["kind"] is None for k in dep["dep_kinds"]):
                pending.append(dep["pkg"])
    return found - set(meta["workspace_members"])


def collect(root, outputs, license_file=None):
    """Keep upstream bytes, including nested vendored notices, not templates."""
    texts, evidence = [], []

    def add(path, kind, data=None):
        content = path.read_bytes() if data is None else data
        sha = digest(content)
        dest = f"texts/{sha}.txt"
        outputs[dest] = content
        item = {"source_path": path.relative_to(root).as_posix(), "path": dest,
                "sha256": sha, "bytes": len(content), "kind": kind}
        (texts if kind == "upstream-license-or-notice" else evidence).append(item)

    for f in sorted(root.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(root)
        if "node_modules" in rel.parts or ".git" in rel.parts:
            continue
        # A copyright icon/source-map is code, not a copyright notice document.
        if f.suffix.lower() in (".js", ".mjs", ".cjs", ".map", ".ts", ".tsx", ".rs", ".c", ".h", ".py"):
            continue
        if f.name.lower().startswith(PREFIXES) or any(p.lower() in ("licenses", "licences") for p in rel.parts[:-1]):
            add(f, "upstream-license-or-notice")
    if license_file:
        f = (root / license_file).resolve()
        if not f.is_relative_to(root.resolve()):
            raise ValueError(f"License path outside package: {license_file}")
        if f.is_file() and not any(t["source_path"] == f.relative_to(root).as_posix() for t in texts):
            add(f, "upstream-license-or-notice")
    if not texts:
        for name in ("README.md", "README", "AUTHORS"):
            if (root / name).is_file():
                add(root / name, "metadata-evidence-not-a-full-license")
        # Preserve leading copyright/license comment where available; not a substitute.
        for name in ("src/lib.rs", "lib.rs"):
            f = root / name
            if not f.is_file():
                continue
            data = f.read_bytes()
            match = re.match(rb"\s*(/\*.*?\*/|(?://[^\r\n]*(?:\r?\n|$))+)", data, re.S)
            if match and re.search(rb"copyright|license|licence", match[0], re.I):
                add(f, "source-header-not-a-full-license", match[0])
    return texts, evidence


def verify_source_archive(data, directory, name, version):
    """Verify actual resolved sources, not just an unmodified-source assertion."""
    files = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            relative = Path(member.name).relative_to(f'{name}-{version}')
            if not member.isfile() or '..' in relative.parts:
                raise ValueError('Unsafe source archive member: ' + member.name)
            local = directory / relative
            if not local.is_file() or local.read_bytes() != archive.extractfile(member).read():
                raise ValueError('MPL source modified or absent: ' + str(relative))
            files.add(relative.as_posix())
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}
    # These two files are Cargo extraction bookkeeping, not upstream source.
    extras = actual - files - {'.cargo-ok', '.cargo-checksum.json'}
    if extras:
        raise ValueError('Additional local MPL source files: ' + repr(sorted(extras)))
    return len(files)


def supplements(outputs):
    path = OUT / 'upstream/manifest.json'
    raw = path.read_bytes()
    manifest = json.loads(raw)
    outputs['upstream/manifest.json'] = raw
    seen = set()
    for artifact in manifest['artifacts']:
        relative = Path(artifact['path'])
        if relative.is_absolute() or '..' in relative.parts or relative.parts[0] not in ('upstream', 'sources'):
            raise ValueError('Unsafe supplemental path')
        if artifact['path'] in seen:
            raise ValueError('Duplicate supplemental artifact')
        seen.add(artifact['path'])
        data = (OUT / relative).read_bytes()
        if digest(data) != artifact['sha256'] or len(data) != artifact['bytes']:
            raise ValueError('Supplemental evidence hash mismatch: ' + str(relative))
        outputs[artifact['path']] = data
    return manifest


def build():
    outputs = {}
    supplemental = supplements(outputs)
    supplemental_used = set()
    source_archives = []
    paths = ("package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock")
    inputs = {p: digest((ROOT / p).read_bytes()) for p in paths}
    all_meta, windows = metadata(), metadata(TARGET)
    windows_all, windows_normal = closure(windows), closure(windows, True)
    lock = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
    cargo_lock = {(p["name"], p["version"], p.get("source")): p for p in lock["package"]}
    packages = []
    for p in sorted(all_meta["packages"], key=lambda p: (p["name"], p["version"], p["id"])):
        if p["id"] in all_meta["workspace_members"]:
            continue
        key = (p["name"], p["version"], p["source"])
        locked = cargo_lock[key]
        directory = Path(p["manifest_path"]).parent
        texts, evidence = collect(directory, outputs, p["license_file"])
        # SQLite's public-domain dedication is in the bundled amalgamation header.
        if p["name"] == "libsqlite3-sys":
            f = directory / "sqlite3/sqlite3.c"
            data = f.read_bytes()
            end = data.find(b"*/")
            if not data.startswith(b"/*") or end < 0:
                raise ValueError("SQLite source dedication header changed; review manually")
            content = data[:end + 2]
            sha = digest(content)
            dest = f"texts/{sha}.txt"
            outputs[dest] = content
            evidence.append({"source_path": "sqlite3/sqlite3.c (initial comment)", "path": dest,
                             "sha256": sha, "bytes": len(content), "kind": "bundled-sqlite-dedication"})
        vcs_file = directory / ".cargo_vcs_info.json"
        vcs = json.loads(vcs_file.read_text(encoding="utf-8")) if vcs_file.is_file() else None
        package_id = f"cargo:{p['name']}@{p['version']}"
        for artifact in supplemental['artifacts']:
            if artifact['package'] != package_id:
                continue
            if artifact['package_checksum'] != locked.get('checksum'):
                raise ValueError('Supplement applies to a different locked crate: ' + package_id)
            if artifact.get('revision') and artifact['revision'] != (vcs or {}).get('git', {}).get('sha1'):
                raise ValueError('Supplement VCS revision mismatch: ' + package_id)
            supplemental_used.add(artifact['path'])
            if artifact['kind'] == 'mpl-source-archive':
                if artifact['sha256'] != locked['checksum']:
                    raise ValueError('MPL archive checksum differs from Cargo.lock')
                count = verify_source_archive(outputs[artifact['path']], directory, p['name'], p['version'])
                source_archives.append(dict(artifact, verified_source_files=count))
            elif artifact['kind'] in ('pinned-upstream-project-license', 'official-license-version', 'native-sdk-license-or-notice'):
                texts.append(artifact)
            else:
                evidence.append(artifact)
        if p['name'] == 'webview2-com-sys':
            for native in supplemental['webview2_sdk']['loader_matches']:
                data = (directory / native['source_path']).read_bytes()
                if digest(data) != native['sha256'] or len(data) != native['bytes']:
                    raise ValueError('Native loader evidence mismatch: ' + native['source_path'])
        scope = ("windows-normal-dependency-closure" if p["id"] in windows_normal else
                 "windows-build-or-dev-supplement" if p["id"] in windows_all else
                 "other-target-or-resolved-optional-supplement")
        packages.append({"ecosystem": "cargo", "name": p["name"], "version": p["version"],
                         "source": p["source"], "checksum": locked.get("checksum"),
                         "license_expression": p["license"], "license_file": p["license_file"],
                         "repository": p["repository"], "homepage": p["homepage"],
                         "authors_from_metadata": p["authors"], "upstream_vcs": vcs,
                         "source_archive": f"https://crates.io/api/v1/crates/{p['name']}/{p['version']}/download",
                         "scope": scope, "texts": texts, "evidence": evidence})
    expected = {k for k in cargo_lock if k[2]}
    actual = {(p["name"], p["version"], p["source"]) for p in packages}
    if expected != actual:
        raise ValueError(f"Cargo lock/metadata mismatch: missing={expected - actual}, extra={actual - expected}")
    npm_lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
    excluded_npm = []
    for path, p in sorted(npm_lock["packages"].items()):
        if not path:
            continue
        # Vite emits a modulepreload helper into production bundles; keep its full license.
        if p.get("dev") and path != "node_modules/vite":
            excluded_npm.append({"lock_path": path, "version": p["version"],
                                 "reason": "dev-only lock entry, not a production dependency"})
            continue
        directory = ROOT / path
        info = json.loads((directory / "package.json").read_text(encoding="utf-8"))
        if info["version"] != p["version"]:
            raise ValueError(f"Installed npm version differs from lock: {path}")
        texts, evidence = collect(directory, outputs)
        packages.append({"ecosystem": "npm", "name": info["name"], "version": p["version"],
                         "lock_path": path, "source": p.get("resolved"), "integrity": p.get("integrity"),
                         "license_expression": info.get("license", p.get("license")),
                         "repository": info.get("repository"), "homepage": info.get("homepage"),
                         "authors_from_metadata": info.get("author", info.get("contributors", [])),
                         "scope": "build-tool-emitted-helper-supplement" if p.get("dev") else "production-lock-entry",
                         "texts": texts, "evidence": evidence})
    if supplemental_used != {a['path'] for a in supplemental['artifacts']}:
        raise ValueError('Unused/stale supplemental package evidence')
    mpl_packages = {f"cargo:{p['name']}@{p['version']}" for p in packages if 'MPL-2.0' in (p['license_expression'] or '')}
    if mpl_packages != {a['package'] for a in source_archives}:
        raise ValueError('MPL source archive coverage differs from resolved graph')
    source_lines = ['# MPL-covered library source availability', '',
        'This distribution includes the Source Code Form of the MPL-2.0 libraries below in `sources/`. '
        'The `.crate` files are gzip-compressed tar archives; extract with `tar -xzf filename.crate`. '
        'They are the exact published packages used by the resolved Cargo build, not a promise to supply source later.', '',
        'The generator verifies the archive SHA-256 against Cargo.lock and every archived file against the actual resolved registry source, '
        'and rejects additional source files. No modifications were found. If any covered library is modified, '
        'replace this unmodified-source workflow with an archive of the actual modified Source Code Form and preserve its MPL notices. '
        'Do not distribute the original archive as though it represented modified code.', '',
        'The covered source remains available under MPL 2.0. These rights are not restricted by the application license. '
        'Full MPL text: [Mozilla Public License 2.0](upstream/selectors-0.36.1/LICENSE-MPL-2.0.txt). '
        'Existing copyright, patent and license notices remain intact within each source archive. '
        'This source notice and the archives must accompany the installed application and any standalone binary distribution.', '',
        '| Package | Bundled source | Upstream download | SHA-256 | Verified files |', '|---|---|---|---|---|']
    for a in source_archives:
        source_lines.append(f"| {a['package']} | [{Path(a['path']).name}]({a['path']}) | [exact version]({a['url']}) | `{a['sha256']}` | {a['verified_source_files']} |")
    outputs['SOURCE-NOTICE.md'] = ('\n'.join(source_lines) + '\n').encode()
    for name in ('DISTRIBUTION-REVIEW.md', 'upstream/citation-ledger.json'):
        outputs[name] = (OUT / name).read_bytes()
    packages.sort(key=lambda p: (p["ecosystem"], p["name"], p["version"]))
    issues = []
    for p in packages:
        if not p["texts"]:
            issues.append({"package": f"{p['ecosystem']}:{p['name']}@{p['version']}", "scope": p["scope"],
                           "reason": "No named LICENSE/COPYING/COPYRIGHT/NOTICE/UNLICENSE text in local published package; metadata or source header is not a substitute."})
        if not p["license_expression"]:
            issues.append({"package": f"{p['ecosystem']}:{p['name']}@{p['version']}", "scope": p["scope"],
                           "reason": "No declared license expression in local package metadata."})
    counts = {"packages": len(packages), "cargo_packages": sum(p["ecosystem"] == "cargo" for p in packages),
              "npm_packages": sum(p["ecosystem"] == "npm" for p in packages),
              "scopes": dict(sorted(Counter(p["scope"] for p in packages).items())),
              "packages_without_named_license_texts": sum(not p["texts"] for p in packages),
              "packages_without_license_expression": sum(not p["license_expression"] for p in packages),
              "license_or_notice_file_references": sum(len(p["texts"]) for p in packages),
              "evidence_file_references": sum(len(p["evidence"]) for p in packages),
              "unique_text_blobs": sum(k.startswith("texts/") for k in outputs),
              "supplemental_artifacts": len(supplemental["artifacts"]),
              "mpl_source_archives": len(source_archives),
              "windows_applicable_missing_license_issues": sum(i["scope"].startswith("windows") for i in issues),
              "missing_license_issues_by_scope": dict(sorted(Counter(i["scope"] for i in issues).items())),
              "excluded_npm_dev_lock_entries": len(excluded_npm)}
    report = {"schema_version": 2, "supplemental_manifest": "upstream/manifest.json",
              "source_archives": source_archives, "webview2_sdk": supplemental["webview2_sdk"], "generator": "scripts/license-notices.py", "target_for_scope_labels": TARGET,
              "input_sha256": inputs, "counts": counts, "packages": packages,
              "excluded_npm_dev_lock_entries": excluded_npm, "missing_license_issues": issues}
    outputs["inventory.json"] = (json.dumps(report, indent=2, ensure_ascii=False) + "\n").encode()
    outputs["APPLICATION-LICENSE.txt"] = (ROOT / "LICENSE").read_bytes()
    outputs["REFERENCE-NOTICES.md"] = (ROOT / "THIRD_PARTY_NOTICES.md").read_bytes()
    lines = ["# Resolved dependency license inventory", "",
             "Generated by `python scripts/license-notices.py` using local installed npm metadata and "
             "`cargo metadata --locked --offline --format-version 1`. No license text is synthesized or fetched by this script.", "",
             "## Scope and limitations", "",
             "- Cargo: the entire locked resolved graph, including build/dev, optional and non-Windows dependencies. "
             "Scope labels use a second metadata pass for `x86_64-pc-windows-msvc`. The normal-edge closure includes proc macros "
             "and is a conservative inventory, NOT proof that every listed crate is linked into the executable.",
             "- npm: all production lock entries (including transitives), plus Vite because its modulepreload helper can be emitted into production. "
             "Other dev-only entries are listed as excluded in inventory.json. This is not a full build-tool SBOM.",
             "- License expressions are upstream declarations, preserved verbatim (including legacy slash expressions), not legal determinations or license elections.",
             "- Texts are byte-for-byte copies from published packages and hash-verified pinned upstream supplements, recursively including vendored license/NOTICE files. "
             "SHA-256 filenames deduplicate identical bytes. Source paths and digests are in inventory.json. Evidence files and README/source headers are NOT substitutes for missing licenses.",
             "- Authors are recorded as package metadata, not asserted copyright holders. Actual copyright notices remain in upstream texts. "
             "A text file's presence does not establish that all obligations or nested components are covered.",
             "- The original Skytuhua application MIT notice is copied unchanged in APPLICATION-LICENSE.txt. "
             "Research/reference attribution and separate publisher-content rights are in REFERENCE-NOTICES.md.",
             "- Native/installer audit remains required: webview2-com-sys carries WebView2LoaderStatic.lib / WebView2Loader.dll; "
             "its crate MIT declaration does NOT determine Microsoft's SDK/loader redistribution terms. "
             "WebView2 runtime, VC runtime, installer components, SDK assets, fonts, models, and any separately copied files are not established by these lockfiles.",
             "- MPL source archives and a recipient source-availability notice are included: see [SOURCE-NOTICE.md](SOURCE-NOTICE.md). "
             "Official WebView2 SDK license/NOTICE and byte-matched loader evidence are captured: see [DISTRIBUTION-REVIEW.md](DISTRIBUTION-REVIEW.md).",
             "- SQLite's bundled amalgamation dedication is preserved separately from libsqlite3-sys's wrapper MIT license. "
             "Nested notices may include unused upstream code (for example SQLCipher); presence is not a claim that it ships.", "",
             "## Verified generated counts", "", "```json", json.dumps(counts, indent=2), "```", "",
             "## Reproduce and verify", "", "```sh", "npm ci",
             "cargo fetch --locked --manifest-path src-tauri/Cargo.toml", "python scripts/license-notices.py",
             "python scripts/license-notices.py --check", "python scripts/license-notices.test.py", "```", "",
             "Python 3.11+ (stdlib only). Generation and checking are offline; prerequisite installation/fetch may access registries. "
             "Generation fails on missing packages or lock mismatches. `--check` compares the entire reconstructed bundle byte-for-byte; "
             "it does not require that the known missing-license list be empty. Use `--strict-windows` for Windows/applicable entries or `--strict` for all targets. "
             "Remaining other-target/resolved-optional gaps are outside the selected Windows closure, not claimed licensed for distribution on another target. "
             "To refresh reviewed upstream inputs online, run `python scripts/license-notices-fetch.py` separately; inspect its evidence before generation.", "",
             "## Lockfile / manifest fingerprints", "", *[f"- `{p}`: `{sha}`" for p, sha in inputs.items()], "",
             "## Missing local license texts / declarations", ""]
    lines += [f"- **{i['package']}** ({i['scope']}): {i['reason']}" for i in issues] or ["None detected by the filename/metadata scan."]
    lines += ["", "## Resolved packages", "", "| Ecosystem / package | Version | Declared license | Scope | Captured texts |", "|---|---|---|---|---|"]
    for p in packages:
        links = ", ".join(f"[{t['source_path']}]({t['path']})" for t in p["texts"]) or "**MISSING — see issues**"
        license_text = str(p["license_expression"] or "UNKNOWN").replace("|", "\\|")
        lines.append(f"| {p['ecosystem']} / {p['name']} | {p['version']} | {license_text} | {p['scope']} | {links} |")
    outputs["README.md"] = ("\n".join(lines) + "\n").encode()
    if inputs != {p: digest((ROOT / p).read_bytes()) for p in paths}:
        raise ValueError("Input manifests/lockfiles changed during generation; rerun")
    return outputs, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--strict-windows", action="store_true", help="Fail on missing evidence within Windows and npm distribution scope")
    parser.add_argument("--strict", action="store_true", help="Also fail on missing declared licenses or named license texts")
    args = parser.parse_args()
    outputs, report = build()
    existing = {f.relative_to(OUT).as_posix(): f for f in OUT.rglob("*") if f.is_file()}
    if args.check:
        changed = [p for p, data in outputs.items() if p not in existing or existing[p].read_bytes() != data]
        extra = sorted(set(existing) - set(outputs))
        if changed or extra:
            raise SystemExit(f"License bundle stale: missing/changed={changed}, extra={extra}")
    else:
        for path, data in outputs.items():
            dest = OUT / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        # Prune only the prior generator's content-addressed blobs, never unrelated files.
        for path in set(existing) - set(outputs):
            if re.fullmatch(r"texts/[a-f0-9]{64}\.txt", path):
                existing[path].unlink()
    print(json.dumps({"verified" if args.check else "generated": str(OUT), "counts": report["counts"]}, indent=2))
    if args.strict_windows and any(i["scope"] != "other-target-or-resolved-optional-supplement" for i in report["missing_license_issues"]):
        raise SystemExit("Applicable Windows/npm license evidence gaps remain")
    if args.strict and report["missing_license_issues"]:
        raise SystemExit("Known missing license evidence remains; see inventory.json / README.md")


if __name__ == "__main__":
    main()
