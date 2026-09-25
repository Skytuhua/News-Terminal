"""Compile production media/services against already-built Cargo dependencies; no manifest edits.
Run from any directory: python src-tauri/tests/media_run.py [Rust test arguments].
Cargo must have built the project's dependencies at least once. Synthetic fixture tests are
not live retrieval evidence. The ignored live test requires an explicit --ignored invocation.
"""
from pathlib import Path
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEPS = ROOT / "target/debug/deps"
EXE = ROOT / "target/debug/media-isolated-tests.exe"
command = ["rustc", "--edition=2021", "--test", str(ROOT / "tests/media/harness.rs"),
           "-L", f"dependency={DEPS}", "-o", str(EXE)]
# Cargo's artifact messages select a coherent feature-unified dependency graph. Picking
# the newest rlib is unsafe when build dependencies have different feature hashes.
build = subprocess.run(["cargo", "test", "--manifest-path", str(ROOT / "Cargo.toml"),
                        "--lib", "--no-run", "--message-format=json"], capture_output=True, text=True)
libraries = {}
for line in build.stdout.splitlines():
    try:
        artifact = json.loads(line)
    except ValueError:
        continue
    if artifact.get("reason") == "build-script-executed":
        for link_path in artifact.get("linked_paths", []):
            command += ["-L", link_path]
    if artifact.get("reason") == "compiler-artifact":
        for filename in artifact["filenames"]:
            if filename.endswith(".rlib"):
                libraries[artifact["target"]["name"]] = filename
for name in ["base64", "serde_json", "sha2", "url", "chrono", "reqwest", "keyring", "html_escape", "tokio", "feed_rs"]:
    if name not in libraries:
        raise SystemExit(f"Missing Cargo dependency artifact: {name}\n{build.stderr}")
    command += ["--extern", f"{name}={libraries[name]}"]
subprocess.run(command, check=True)
raise SystemExit(subprocess.run([str(EXE), *sys.argv[1:]]).returncode)
