"""Release tooling tests: synthetic bytes stay inside TemporaryDirectory."""
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('package-release.py')


class ReleaseToolTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        shutil.copy2(SCRIPT, self.root / 'scripts/package-release.py')

    def load(self):
        try:
            return runpy.run_path(str(self.root / 'scripts/package-release.py'))
        except Exception as error:
            self.fail(f'Tooling import must not read evidence or write releases: {error}')

    def versions(self, version='0.2.0'):
        def write(name, data):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(data, encoding='utf-8')
        write('package.json', json.dumps({'name': 'news-terminal', 'version': version}))
        write('package-lock.json', json.dumps({'version': version, 'packages': {'': {'version': version}}}))
        write('src-tauri/tauri.conf.json', json.dumps({'version': version}))
        write('src-tauri/Cargo.toml', f'[package]\nname="news-terminal"\nversion={json.dumps(version)}\n')
        write('src-tauri/Cargo.lock', f'[[package]]\nname="news-terminal"\nversion={json.dumps(version)}\n')

    def fixture(self, module):
        import os
        import time
        from datetime import datetime, timezone
        self.versions()
        for name in ('src/main.ts', 'resources/licenses/SOURCE-NOTICE.md', 'resources/installer-notices/README.md', 'docs/references.md', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('TEST FIXTURE ONLY: ' + name)
        start = time.time() - 20
        for path in self.root.rglob('*'):
            if path.is_file():
                os.utime(path, (start - 10, start - 10))
        installer = self.root / 'src-tauri/target/release/bundle/nsis/News Terminal_0.2.0_x64-setup.exe'
        installer.parent.mkdir(parents=True)
        installer.write_bytes(b'TEST FIXTURE INSTALLER, NOT EXECUTABLE')
        app = self.root / 'src-tauri/target/release/news-terminal.exe'
        app.write_bytes(b'TEST FIXTURE APPLICATION, NOT EXECUTABLE')
        extracted = self.root / 'extracted.exe'
        extracted.write_bytes(b'TEST FIXTURE EXTRACTED APPLICATION')
        for path in (installer, app, extracted):
            os.utime(path, (start + 5, start + 5))
        evidence = self.root / 'docs/evidence'
        evidence.mkdir(parents=True)
        checks = []
        for name in module['REQUIRED_CHECKS']:
            log = evidence / f'release-{name}.log'
            log.write_text('Synthetic test log; not release evidence')
            os.utime(log, (start + 10, start + 10))
            checks.append({'name': name, 'exitCode': 0, 'log': log.relative_to(self.root).as_posix()})
        report = {'passed': True, 'checks': checks, 'startedAt': datetime.fromtimestamp(start, timezone.utc).isoformat(), 'finishedAt': datetime.fromtimestamp(start + 15, timezone.utc).isoformat()}
        (evidence / 'release-checks.json').write_text(json.dumps(report))
        (evidence / 'native-smoke.json').write_text(json.dumps({'passed': True, 'executable': str(extracted)}))
        payload = {'version': '0.2.0', 'all_notice_bytes_match': True, 'local_ai_excluded': True, 'installer_sha256': module['sha256'](installer), 'standalone_application_sha256': module['sha256'](app), 'packaged_application_sha256': module['sha256'](extracted), 'input_sha256': module['input_hashes'](self.root)}
        (evidence / 'installer-payload.json').write_text(json.dumps(payload))
        return evidence, installer, app

    def test_fresh_gates_bind_current_source_and_both_executables(self):
        module = self.load()
        evidence, installer, app = self.fixture(module)
        self.assertEqual(module['validate_release'](self.root)['version'], '0.2.0')
        for path in (installer, app, self.root / 'src/main.ts'):
            original = path.read_bytes()
            mtime = path.stat().st_mtime
            path.write_bytes(original + b'changed')
            with self.assertRaisesRegex(ValueError, 'changed|stale|hash'):
                module['validate_release'](self.root)
            path.write_bytes(original)
            import os
            os.utime(path, (mtime, mtime))
        self.assertFalse((self.root / 'release').exists())

    def test_incomplete_failed_and_stale_evidence_cannot_write_release(self):
        module = self.load()
        evidence, _, _ = self.fixture(module)
        checks_path = evidence / 'release-checks.json'
        original = checks_path.read_bytes()
        for mutation in ('missing-gate', 'failed-gate', 'false-summary', 'duplicate-gate'):
            report = json.loads(original)
            if mutation == 'missing-gate':
                report['checks'].pop()
            elif mutation == 'failed-gate':
                report['checks'][0]['exitCode'] = 1
            elif mutation == 'false-summary':
                report['passed'] = False
            else:
                report['checks'].append(report['checks'][0])
            checks_path.write_text(json.dumps(report))
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, 'checks'):
                module['package_release'](self.root)
            self.assertFalse((self.root / 'release').exists())
        checks_path.write_bytes(original)
        payload_path = evidence / 'installer-payload.json'
        original = payload_path.read_bytes()
        for field, value in (('version', '0.1.0'), ('all_notice_bytes_match', False), ('local_ai_excluded', False), ('installer_sha256', '0' * 64), ('input_sha256', {})):
            payload = json.loads(original)
            payload[field] = value
            payload_path.write_text(json.dumps(payload))
            with self.subTest(field=field), self.assertRaises(ValueError):
                module['package_release'](self.root)
            self.assertFalse((self.root / 'release').exists())
        payload_path.write_bytes(original)

    def test_staging_error_does_not_promote_artifacts(self):
        from unittest.mock import patch
        module = self.load()
        self.fixture(module)
        release = self.root / 'release'
        release.mkdir()
        sentinel = release / 'keep-unrelated.txt'
        sentinel.write_bytes(b'preserve')
        with patch('zipfile.ZipFile', side_effect=OSError('simulated disk failure')):
            with self.assertRaisesRegex(OSError, 'simulated disk failure'):
                module['package_release'](self.root)
        self.assertEqual({p.name: p.read_bytes() for p in release.iterdir()}, {'keep-unrelated.txt': b'preserve'})

    def test_rejects_executable_replaced_after_native_smoke(self):
        import os
        module = self.load()
        evidence, _, _ = self.fixture(module)
        smoke = evidence / 'native-smoke.json'
        executable = self.root / 'extracted.exe'
        newer = smoke.stat().st_mtime + 10
        os.utime(executable, (newer, newer))
        with self.assertRaisesRegex(ValueError, 'smoke|stale'):
            module['validate_release'](self.root)

    def test_staged_package_preserves_old_metadata_and_excludes_local_ai(self):
        import zipfile
        module = self.load()
        self.fixture(module)
        release = self.root / 'release'
        release.mkdir()
        old_name = 'News-Terminal-0.1.0-windows-x64-setup.exe'
        (release / old_name).write_bytes(b'OLD TEST DISTRIBUTION')
        old = [{'file': old_name, 'bytes': (release / old_name).stat().st_size, 'sha256': module['sha256'](release / old_name)}]
        metadata = json.dumps(old).encode()
        sums = f"{old[0]['sha256']}  {old_name}\n".encode()
        (release / 'artifacts.json').write_bytes(metadata)
        (release / 'SHA256SUMS.txt').write_bytes(sums)
        (self.root / '.local-ai').mkdir()
        (self.root / '.local-ai/model.gguf').write_bytes(b'DO NOT DISTRIBUTE')
        result = module['package_release'](self.root)
        self.assertEqual(len(result), 2)
        self.assertEqual((release / old_name).read_bytes(), b'OLD TEST DISTRIBUTION')
        self.assertEqual((release / 'artifacts-0.1.0.json').read_bytes(), metadata)
        self.assertEqual((release / 'SHA256SUMS-0.1.0.txt').read_bytes(), sums)
        self.assertEqual(json.loads((release / 'artifacts-0.2.0.json').read_text()), result)
        with zipfile.ZipFile(release / result[1]['file']) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(archive.read('News Terminal/docs/references.md'), (self.root / 'docs/references.md').read_bytes())
            self.assertFalse(any('local-ai' in p or 'scripts/' in p or p.endswith('.gguf') for p in archive.namelist()))
        before = {p.name: p.read_bytes() for p in release.iterdir()}
        with self.assertRaisesRegex(ValueError, 'exists|overwrite'):
            module['package_release'](self.root)
        self.assertEqual(before, {p.name: p.read_bytes() for p in release.iterdir()})

    def test_version_is_strict_and_bound_to_every_root_manifest(self):
        module = self.load()
        self.versions()
        self.assertEqual(module['release_version'](self.root), '0.2.0')
        for version in ('../0.2.0', '01.2.0', '0.2', '0.2.0\n', '0.2.0-01'):
            self.versions(version)
            with self.assertRaisesRegex(ValueError, 'version|SemVer'):
                module['release_version'](self.root)
        self.versions()
        (self.root / 'src-tauri/tauri.conf.json').write_text('{"version":"0.1.0"}')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            module['release_version'](self.root)


if __name__ == '__main__':
    unittest.main()
