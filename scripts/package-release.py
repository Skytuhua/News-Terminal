"""Assemble verified local downloads; never build, install, or publish."""
from pathlib import Path
import json
import re
import tomllib

ROOT = Path(__file__).resolve().parents[1]
# SemVer 2.0.0, including numeric prerelease leading-zero restrictions.
SEMVER = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def release_version(root):
    package = read_json(root / 'package.json')
    lock = read_json(root / 'package-lock.json')
    cargo = tomllib.loads((root / 'src-tauri/Cargo.toml').read_text(encoding='utf-8'))
    cargo_lock = tomllib.loads((root / 'src-tauri/Cargo.lock').read_text(encoding='utf-8'))
    roots = [p['version'] for p in cargo_lock['package'] if p['name'] == cargo['package']['name'] and 'source' not in p]
    if len(roots) != 1:
        raise ValueError('Cargo.lock must contain exactly one root version')
    versions = [package['version'], lock['version'], lock['packages']['']['version'], cargo['package']['version'], roots[0], read_json(root / 'src-tauri/tauri.conf.json')['version']]
    if any(not isinstance(v, str) or SEMVER.fullmatch(v) is None for v in versions):
        raise ValueError('Invalid strict SemVer version')
    if len(set(versions)) != 1:
        raise ValueError(f'Root version mismatch: {versions}')
    return versions[0]


REQUIRED_CHECKS = ('rust-format', 'rust-tests', 'rust-clippy', 'typescript', 'frontend-unit', 'browser-e2e', 'npm-audit', 'notice-tests', 'windows-notices', 'windows-build', 'native-smoke')


def sha256(path):
    import hashlib
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def input_files(root):
    files = set()
    for name in ('src', 'tests', 'scripts', 'resources', 'src-tauri/src', 'src-tauri/capabilities', 'src-tauri/icons'):
        files.update(p for p in (root / name).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc')
    for name in ('package.json', 'package-lock.json', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'index.html', 'vite.config.ts', 'tsconfig.json', 'playwright.config.ts', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', 'src-tauri/build.rs'):
        if (root / name).is_file():
            files.add(root / name)
    files.update((root / 'docs').glob('*.md'))
    return sorted(files)


def input_hashes(root):
    return {p.relative_to(root).as_posix(): sha256(p) for p in input_files(root)}


def validate_release(root):
    from datetime import datetime, timezone
    version = release_version(root)
    evidence = root / 'docs/evidence'
    checks = read_json(evidence / 'release-checks.json')
    start = datetime.fromisoformat(checks['startedAt']).timestamp()
    finish = datetime.fromisoformat(checks['finishedAt']).timestamp()
    if not start <= finish <= datetime.now(timezone.utc).timestamp():
        raise ValueError('Invalid release-check timestamps')
    rows = checks['checks']
    names = [c['name'] for c in rows]
    if checks.get('passed') is not True or len(names) != len(set(names)) or not set(REQUIRED_CHECKS).issubset(names) or any(c.get('exitCode') != 0 for c in rows):
        raise ValueError('Missing or failed root release checks')
    for row in rows:
        log = (root / row['log']).resolve()
        if not log.is_relative_to(evidence.resolve()) or not log.is_file() or not start <= log.stat().st_mtime <= finish:
            raise ValueError('Missing or stale release-check log: ' + row['name'])
    inputs = input_files(root)
    if any(p.stat().st_mtime > start for p in inputs):
        raise ValueError('Source/notices changed since root checks; stale release evidence')
    installer = root / f'src-tauri/target/release/bundle/nsis/News Terminal_{version}_x64-setup.exe'
    app = root / 'src-tauri/target/release/news-terminal.exe'
    for artifact in (installer, app):
        if not artifact.is_file() or not start <= artifact.stat().st_mtime <= finish:
            raise ValueError('Missing or stale build artifact: ' + str(artifact))
    payload_path = evidence / 'installer-payload.json'
    payload = read_json(payload_path)
    if payload.get('version') != version or payload.get('all_notice_bytes_match') is not True or payload.get('local_ai_excluded') is not True:
        raise ValueError('Missing current-version payload verification')
    if payload.get('installer_sha256') != sha256(installer) or payload.get('standalone_application_sha256') != sha256(app):
        raise ValueError('Build artifact hash changed since payload verification')
    if payload.get('input_sha256') != input_hashes(root):
        raise ValueError('Source/notices hash changed since payload verification')
    smoke_path = evidence / 'native-smoke.json'
    smoke = read_json(smoke_path)
    executable = Path(smoke.get('executable', ''))
    if smoke.get('passed') is not True or not executable.is_file() or sha256(executable) != payload.get('packaged_application_sha256'):
        raise ValueError('Native smoke must pass against this extracted packaged application hash')
    if smoke_path.stat().st_mtime < max(installer.stat().st_mtime, executable.stat().st_mtime) or payload_path.stat().st_mtime < installer.stat().st_mtime:
        raise ValueError('Native smoke/payload evidence is stale')
    return {'version': version, 'installer': installer, 'application': app, 'input_sha256': payload['input_sha256']}


def prior_metadata(release):
    """Validate generic pointers and archive their exact original bytes first."""
    manifest, sums = release / 'artifacts.json', release / 'SHA256SUMS.txt'
    if not manifest.exists() and not sums.exists():
        return {}
    if not manifest.is_file() or not sums.is_file():
        raise ValueError('Incomplete prior release metadata; refusing overwrite')
    records = read_json(manifest)
    versions = set()
    expected = []
    for item in records:
        match = re.fullmatch(r'News-Terminal-(.+)-windows-x64-(?:setup\.exe|portable\.zip)', item['file'])
        if not match or not SEMVER.fullmatch(match[1]):
            raise ValueError('Invalid prior release artifact name')
        versions.add(match[1])
        path = release / item['file']
        if path.stat().st_size != item['bytes'] or sha256(path) != item['sha256']:
            raise ValueError('Prior release artifact hash mismatch')
        expected.append(f"{item['sha256']}  {item['file']}")
    if len(versions) != 1 or sums.read_text(encoding='utf-8').splitlines() != expected:
        raise ValueError('Prior checksums/version mismatch')
    version = versions.pop()
    archives = {f'artifacts-{version}.json': manifest.read_bytes(), f'SHA256SUMS-{version}.txt': sums.read_bytes()}
    for name, data in archives.items():
        if (release / name).exists() and (release / name).read_bytes() != data:
            raise ValueError('Prior metadata archive exists with different bytes')
    return archives


def check_distribution_names(names):
    for name in names:
        path = Path(name.lower().replace('\\', '/'))
        if any(part in ('.local-ai', 'models', 'blobs', 'scripts', 'node_modules') for part in path.parts) or path.suffix in ('.gguf', '.safetensors', '.onnx') or path.name.startswith(('ollama', 'local-ai-')):
            raise ValueError('Local AI runtime/model or repository helper excluded from payload: ' + name)


def package_release(root):
    import shutil
    import tempfile
    import zipfile
    verified = validate_release(root)
    version = verified['version']
    release = root / 'release'
    setup_name = f'News-Terminal-{version}-windows-x64-setup.exe'
    zip_name = f'News-Terminal-{version}-windows-x64-portable.zip'
    manifest_name, sums_name = f'artifacts-{version}.json', f'SHA256SUMS-{version}.txt'
    names = (setup_name, zip_name, manifest_name, sums_name)
    if any((release / name).exists() for name in names):
        raise ValueError('Versioned release already exists; refusing overwrite')
    archives = prior_metadata(release)
    release.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.staging-', dir=release) as temporary:
        stage = Path(temporary)
        shutil.copyfile(verified['installer'], stage / setup_name)
        members = {'news-terminal.exe': verified['application']}
        for name in ('LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md'):
            members[name] = root / name
        for folder in ('licenses', 'installer-notices'):
            base = root / 'resources' / folder
            members.update({folder + '/' + p.relative_to(base).as_posix(): p for p in base.rglob('*') if p.is_file()})
        members.update({'docs/' + p.name: p for p in (root / 'docs').glob('*.md') if not p.name.lower().startswith('local-ai')})
        check_distribution_names(members)
        # Repository helper scripts depend on an unshipped .local-ai tree: omit them.
        with zipfile.ZipFile(stage / zip_name, 'w', compression=zipfile.ZIP_DEFLATED) as output:
            for name, path in sorted(members.items()):
                if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
                    raise ValueError('Unsafe portable member: ' + name)
                output.write(path, 'News Terminal/' + name)
            output.writestr('News Terminal/PORTABLE-README.txt', 'Launch news-terminal.exe. Requires an existing Windows WebView2 runtime.\nNo Ollama runtime, model, Python or repository helper scripts are bundled.\nLocal AI is optional and separately provisioned; repository setup instructions\nare not portable commands. Configure an independently running loopback service.\n')
        with zipfile.ZipFile(stage / zip_name) as output:
            if output.testzip() is not None:
                raise ValueError('Portable ZIP integrity failure')
            for name, path in members.items():
                if output.read('News Terminal/' + name) != path.read_bytes():
                    raise ValueError('Portable member changed: ' + name)
        artifacts = [{'file': name, 'bytes': (stage / name).stat().st_size, 'sha256': sha256(stage / name)} for name in (setup_name, zip_name)]
        (stage / manifest_name).write_text(json.dumps(artifacts, indent=2), encoding='utf-8')
        (stage / sums_name).write_text(''.join(f"{a['sha256']}  {a['file']}\n" for a in artifacts), encoding='utf-8')
        current = validate_release(root)
        if current != verified or sha256(stage / setup_name) != sha256(current['installer']):
            raise ValueError('Release inputs changed during staging')
        # Immutable files use exclusive create, never overwrite existing versions.
        # Multiple files are not one atomic transaction. On interruption, retain
        # old generic pointers; inspect/remove only incomplete NEW-version files.
        for name, data in archives.items():
            if not (release / name).exists():
                with (release / name).open('xb') as stream:
                    stream.write(data)
        for name in names:
            with (release / name).open('xb') as destination, (stage / name).open('rb') as source:
                shutil.copyfileobj(source, destination)
            if sha256(release / name) != sha256(stage / name):
                raise ValueError('Promoted artifact hash mismatch: ' + name)
        for source_name, pointer in ((manifest_name, 'artifacts.json'), (sums_name, 'SHA256SUMS.txt')):
            shutil.copyfile(stage / source_name, stage / pointer)
            (stage / pointer).replace(release / pointer)
    return artifacts


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true', help='Validate all current gates without writing distributions')
    args = parser.parse_args()
    if args.check_only:
        print('Release inputs verified for ' + validate_release(ROOT)['version'] + '; no artifacts written')
    else:
        print(json.dumps(package_release(ROOT), indent=2))


if __name__ == '__main__':
    main()
