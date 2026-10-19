"""Read-only installed-payload contracts using inert files, never setup executables."""
from pathlib import Path
import hashlib
import json
import runpy
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = runpy.run_path(str(ROOT / 'scripts/package-release.py'))


class InstalledPayloadTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='news-terminal-installed-contract-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        config = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
        for name in ('package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, path)
        for name in ('scripts/ci-installed-smoke.mjs', 'scripts/ci-installed-state.ps1', 'scripts/ci-installed-payload.py', 'scripts/native-process-cleanup.mjs', '.github/workflows/ci.yml'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'INERT SOURCE FIXTURE ' + name.encode())
        self.version = config['version']
        self.installer = self.root / f'src-tauri/target/release/bundle/nsis/News Terminal_{self.version}_x64-setup.exe'
        self.installer.parent.mkdir(parents=True)
        self.installer.write_bytes(b'INERT SETUP, NEVER EXECUTE')
        self.standalone = self.root / 'src-tauri/target/release/news-terminal.exe'
        self.standalone.write_bytes(b'INERT UNK APPLICATION')
        self.extracted = Path(self.temp.name) / 'extracted/installer'
        self.extracted.mkdir(parents=True)
        (self.extracted / 'news-terminal.exe').write_bytes(b'INERT NSS APPLICATION')
        (self.extracted / 'uninstall.exe').write_bytes(b'INERT UNINSTALLER, NEVER EXECUTE')
        for name in ('THIRD_PARTY_NOTICES.md', 'licenses/notice.txt', 'installer-notices/Microsoft-WebView2-Runtime.md'):
            source = self.root / (name if name == 'THIRD_PARTY_NOTICES.md' else 'resources/' + name)
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(('INERT NOTICE ' + name).encode())
            destination = self.extracted / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        runtime = self.extracted / TOOLS['WEBVIEW2_MEMBER']
        runtime.parent.mkdir()
        runtime.write_bytes(b'INERT RUNTIME, NEVER EXECUTE')
        self.payload = {'version': self.version, 'all_notice_bytes_match': True, 'local_ai_excluded': True,
            'installer_sha256': TOOLS['sha256'](self.installer), 'standalone_application_sha256': TOOLS['sha256'](self.standalone),
            'packaged_application_sha256': TOOLS['sha256'](self.extracted / 'news-terminal.exe'),
            'packaged_uninstaller_sha256': TOOLS['sha256'](self.extracted / 'uninstall.exe'),
            'input_sha256': TOOLS['input_hashes'](self.root), 'extraction_dir': str(self.extracted.parent),
            'webview2': {**TOOLS['windows_setup_policy'](self.root), 'sha256': TOOLS['sha256'](runtime), 'bytes': runtime.stat().st_size,
                'signature': {'status': 'Valid', 'subject': 'O=Microsoft Corporation', 'thumbprint': 'A' * 40}}}
        self.module = runpy.run_path(str(ROOT / 'scripts/ci-installed-payload.py'))

    def test_current_payload_is_bound_without_printing_the_input_map(self):
        result = self.module['verify_bindings'](self.root, self.payload)
        self.assertEqual(result.get('installerSha256'), hashlib.sha256(b'INERT SETUP, NEVER EXECUTE').hexdigest())
        self.assertEqual(result.get('inputCount'), len(self.payload['input_sha256']))
        self.assertNotIn('input_sha256', result)

    def test_source_setup_application_and_uninstaller_changes_are_rejected(self):
        for path, message in ((self.root / 'scripts/ci-installed-state.ps1', 'inputs'),
                              (self.installer, 'installer'), (self.standalone, 'standalone'),
                              (self.extracted / 'news-terminal.exe', 'packaged application'),
                              (self.extracted / 'uninstall.exe', 'uninstaller')):
            before = path.read_bytes()
            path.write_bytes(before + b' CHANGED')
            with self.subTest(path=path.name), self.assertRaisesRegex(ValueError, message):
                self.module['verify_bindings'](self.root, self.payload)
            path.write_bytes(before)

    def test_old_payload_without_an_inspected_uninstaller_hash_fails(self):
        del self.payload['packaged_uninstaller_sha256']
        with self.assertRaisesRegex(ValueError, 'uninstaller'):
            self.module['verify_bindings'](self.root, self.payload)

    def test_installed_resources_must_equal_the_exact_payload_with_no_additional_files(self):
        installed = Path(self.temp.name) / 'Install path with spaces'
        installed.mkdir()
        for name in ('news-terminal.exe', 'uninstall.exe', 'THIRD_PARTY_NOTICES.md', 'licenses', 'installer-notices'):
            source = self.extracted / name
            if source.is_dir(): shutil.copytree(source, installed / name)
            else: shutil.copyfile(source, installed / name)
        result = self.module['verify_bindings'](self.root, self.payload, installed)
        self.assertEqual(result.get('installedFileCount'), 5)
        notice = installed / 'licenses/notice.txt'
        notice.write_bytes(b'CHANGED NOTICE')
        with self.assertRaisesRegex(ValueError, 'Installed bytes'):
            self.module['verify_bindings'](self.root, self.payload, installed)
        shutil.copyfile(self.extracted / 'licenses/notice.txt', notice)
        (installed / 'unexpected.exe').write_bytes(b'INERT EXTRA')
        with self.assertRaisesRegex(ValueError, 'Installed file set'):
            self.module['verify_bindings'](self.root, self.payload, installed)


if __name__ == '__main__':
    unittest.main()
