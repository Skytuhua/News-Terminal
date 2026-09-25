"""Reproduce release verification; keep real command output, fail on any gate."""
from pathlib import Path
import json
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "evidence"
EVIDENCE.mkdir(parents=True, exist_ok=True)
COMMANDS = [
    ("rust-format", ["cargo", "fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"]),
    ("rust-tests", ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml"]),
    ("rust-clippy", ["cargo", "clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--", "-D", "warnings"]),
    ("typescript", ["npm.cmd", "run", "typecheck"]),
    ("frontend-unit", ["npm.cmd", "test"]),
    ("browser-e2e", ["npm.cmd", "run", "test:e2e"]),
    ("npm-audit", ["npm.cmd", "audit"]),
    ("source-catalog-tests", [sys.executable, "tests/test_source_catalog.py"]),
    ("source-catalog", [sys.executable, "scripts/check-v02-sources.py"]),
    ("packaging-tests", [sys.executable, "scripts/package-release.test.py"]),
    ("installer-tests", [sys.executable, "scripts/verify-installer.test.py"]),
    ("notice-tests", [sys.executable, "scripts/license-notices.test.py"]),
    ("windows-notices", [sys.executable, "scripts/license-notices.py", "--check", "--strict-windows"]),
    ("windows-build", ["npm.cmd", "run", "tauri", "--", "build", "--bundles", "nsis"]),
    ("native-smoke", ["node", "scripts/native-smoke.mjs"]),
]
report = {"startedAt": datetime.now(timezone.utc).isoformat(), "checks": []}
for name, command in COMMANDS:
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    log = EVIDENCE / f"release-{name}.log"
    log.write_text(result.stdout + "\n" + result.stderr, encoding="utf-8")
    report["checks"].append({"name": name, "command": command, "exitCode": result.returncode, "log": log.relative_to(ROOT).as_posix()})
    print(f"{name}: exit {result.returncode}", flush=True)
    if result.returncode:
        print((result.stdout + result.stderr)[-5000:], flush=True)
        break
report["passed"] = len(report["checks"]) == len(COMMANDS) and all(c["exitCode"] == 0 for c in report["checks"])
report["finishedAt"] = datetime.now(timezone.utc).isoformat()
(EVIDENCE / "release-checks.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
raise SystemExit(0 if report["passed"] else 1)
