"""Bind the CI install gate to inspected bytes. No installer or application execution."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import runpy
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TOOLS = runpy.run_path(str(Path(__file__).with_name('package-release.py')))
INSPECT = runpy.run_path(str(Path(__file__).with_name('verify-installer.py')))
HELPERS = ('scripts/ci-installed-smoke.mjs', 'scripts/ci-installed-state.ps1',
           'scripts/ci-installed-payload.py', 'scripts/native-process-cleanup.mjs')


def map_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def regular_files(directory):
    files = {}
    if not directory.is_dir():
        raise ValueError('Missing file directory: ' + str(directory))
    for path in directory.rglob('*'):
        info = path.lstat()
        if path.is_symlink() or getattr(info, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError('Reparse points are not accepted in an installed payload')
        if path.is_file():
            files[path.relative_to(directory).as_posix()] = path
    return files


def verify_bindings(root, payload, installed=None):
    version = TOOLS['release_version'](root)
    if payload.get('version') != version or payload.get('all_notice_bytes_match') is not True or payload.get('local_ai_excluded') is not True:
        raise ValueError('Missing current inspected payload')
    inputs = TOOLS['input_hashes'](root)
    if inputs != payload.get('input_sha256'):
        raise ValueError('Source inputs changed since installer inspection')
    TOOLS['check_webview2_evidence'](root, payload)
    installer = root / f'src-tauri/target/release/bundle/nsis/News Terminal_{version}_x64-setup.exe'
    standalone = root / 'src-tauri/target/release/news-terminal.exe'
    extracted = Path(payload['extraction_dir']) / 'installer'
    for label, path, key in (
        ('installer', installer, 'installer_sha256'),
        ('standalone', standalone, 'standalone_application_sha256'),
        ('packaged application', extracted / 'news-terminal.exe', 'packaged_application_sha256'),
        ('uninstaller', extracted / 'uninstall.exe', 'packaged_uninstaller_sha256'),
    ):
        expected = payload.get(key, '')
        if re.fullmatch(r'[0-9a-f]{64}', str(expected)) is None or not path.is_file() or TOOLS['sha256'](path) != expected:
            raise ValueError('Changed or missing inspected ' + label)
    INSPECT['check_application'](standalone.read_bytes(), (extracted / 'news-terminal.exe').read_bytes())
    expected_files = {'news-terminal.exe': extracted / 'news-terminal.exe', 'uninstall.exe': extracted / 'uninstall.exe',
                      'THIRD_PARTY_NOTICES.md': root / 'THIRD_PARTY_NOTICES.md'}
    for folder in ('licenses', 'installer-notices'):
        expected_files.update({folder + '/' + name: path for name, path in regular_files(root / 'resources' / folder).items()})
    expected_hashes = {name: TOOLS['sha256'](path) for name, path in expected_files.items()}
    for name, expected in expected_hashes.items():
        path = extracted / name
        if not path.is_file() or TOOLS['sha256'](path) != expected:
            raise ValueError('Extracted resource bytes changed: ' + name)
    result = {'version': version, 'installer': str(installer), 'installerSha256': payload['installer_sha256'],
              'standaloneSha256': payload['standalone_application_sha256'], 'packagedSha256': payload['packaged_application_sha256'],
              'uninstallerSha256': payload['packaged_uninstaller_sha256'], 'inputCount': len(inputs), 'inputMapSha256': map_hash(inputs),
              'helperSha256': {name: inputs[name] for name in HELPERS},
              'workflowSha256': TOOLS['sha256'](root / '.github/workflows/ci.yml'),
              'expectedFileCount': len(expected_hashes), 'expectedFileMapSha256': map_hash(expected_hashes)}
    if installed is not None:
        actual_files = regular_files(installed)
        if actual_files.keys() != expected_files.keys():
            raise ValueError('Installed file set differs: extra=' + str(sorted(actual_files.keys() - expected_files.keys()))
                             + ', missing=' + str(sorted(expected_files.keys() - actual_files.keys())))
        actual = {name: TOOLS['sha256'](path) for name, path in actual_files.items()}
        if actual != expected_hashes:
            raise ValueError('Installed bytes differ from the inspected payload')
        result.update(installedFileCount=len(actual), installedFileMapSha256=map_hash(actual))
    if inputs != TOOLS['input_hashes'](root):
        raise ValueError('Source inputs changed during verification')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--payload', required=True, type=Path)
    parser.add_argument('--installed', type=Path)
    args = parser.parse_args()
    result = verify_bindings(ROOT, json.loads(args.payload.read_text(encoding='utf-8-sig')), args.installed)
    config = TOOLS['read_json'](ROOT / 'src-tauri/tauri.conf.json')
    if config.get('productName') != 'News Terminal' or config.get('identifier') != 'com.newsterminal.desktop' or config['bundle'].get('publisher'):
        raise ValueError('Installed-state helper is scoped to the current News Terminal identity')
    script = ROOT / 'src-tauri/target/release/nsis/x64/installer.nsi'
    text = script.read_text(encoding='utf-8-sig')
    INSPECT['check_setup_script'](ROOT, text)
    for name, expected in {'PRODUCTNAME': 'News Terminal', 'MANUFACTURER': 'newsterminal', 'BUNDLEID': 'com.newsterminal.desktop',
                           'MAINBINARYNAME': 'news-terminal', 'STARTMENUFOLDER': ''}.items():
        if INSPECT['nsis_define'](text, name) != expected:
            raise ValueError('Unsupported installed identity: ' + name)
    result['generatedInstallerScriptSha256'] = TOOLS['sha256'](script)
    def git(*command):
        return subprocess.run(['git', '-C', str(ROOT), *command], check=True, capture_output=True, text=True, timeout=15).stdout.strip()
    result['sourceHead'] = git('rev-parse', 'HEAD')
    result['sourceTree'] = git('rev-parse', 'HEAD^{tree}')
    if result['sourceHead'] != os.environ.get('GITHUB_SHA'):
        raise ValueError('Checked-out source does not match the CI job revision')
    git('diff', '--exit-code', 'HEAD', '--')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
