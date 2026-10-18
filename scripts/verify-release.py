"""Reproduce release verification; keep real command output, fail on any gate."""
from pathlib import Path
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
BUILD_CHECKS = [
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
    ("release-runner-tests", [sys.executable, "scripts/verify-release.test.py"]),
    ("notice-tests", [sys.executable, "scripts/license-notices.test.py"]),
    ("windows-notices", [sys.executable, "scripts/license-notices.py", "--check", "--strict-windows"]),
    ("windows-build", ["npm.cmd", "run", "tauri", "--", "build", "--bundles", "nsis"]),
]


def run_checks(root, sevenzip):
    sevenzip = Path(sevenzip).resolve()
    if not sevenzip.is_file():
        raise ValueError('Provide an existing full official 7z.exe for NSIS inspection; no tools are downloaded')
    evidence = root / 'docs/evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    commands = BUILD_CHECKS + [
        ('installer-payload', [sys.executable, 'scripts/verify-installer.py', '--sevenzip', str(sevenzip)]),
        ('native-smoke', None),
    ]
    report = {'startedAt': datetime.now(timezone.utc).isoformat(), 'checks': []}
    for name, command in commands:
        try:
            if name == 'native-smoke':
                payload = json.loads((evidence / 'installer-payload.json').read_text(encoding='utf-8'))
                executable = Path(payload['extraction_dir']) / 'installer/news-terminal.exe'
                if not executable.is_file():
                    raise ValueError('Payload inspection did not leave the packaged application for native smoke')
                command = ['node', 'scripts/native-smoke.mjs', str(executable)]
            result = subprocess.run(command, cwd=root, capture_output=True, text=True, encoding='utf-8', errors='replace')
        except (OSError, ValueError, KeyError) as error:
            result = subprocess.CompletedProcess(command or [], 1, '', str(error))
        log = evidence / f'release-{name}.log'
        log.write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
        report['checks'].append({'name': name, 'command': command or [], 'exitCode': result.returncode, 'log': log.relative_to(root).as_posix()})
        print(f'{name}: exit {result.returncode}', flush=True)
        if result.returncode:
            print((result.stdout + result.stderr)[-5000:], flush=True)
            break
    report['passed'] = len(report['checks']) == len(commands) and all(c['exitCode'] == 0 for c in report['checks'])
    report['finishedAt'] = datetime.now(timezone.utc).isoformat()
    (evidence / 'release-checks.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sevenzip', required=True, help='Path to full official 7z.exe, used to inspect the built installer before native smoke')
    args = parser.parse_args()
    return 0 if run_checks(ROOT, args.sevenzip)['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
