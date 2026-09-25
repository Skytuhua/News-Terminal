"""Installer verification unit tests; no installer execution or publishing."""
from pathlib import Path
import runpy
import tempfile
import unittest


class InstallerTest(unittest.TestCase):
    def module(self):
        try:
            return runpy.run_path(str(Path(__file__).with_name('verify-installer.py')))
        except SystemExit as error:
            self.fail(f'Import must not parse CLI arguments or extract installers: {error}')

    def test_deflate_detection_collision_uses_lossless_inspection_copy(self):
        import struct
        import zlib
        module = self.module()
        self.assertIn('inspection_copy', module, 'Verifier needs a guarded solid-Deflate collision fallback')
        # Four empty fixed-Huffman blocks end on a byte boundary. Their fourth
        # byte collides with 7-Zip's non-solid detection, just like the real build.
        raw = struct.pack('<I', 7) + b'fixture'
        compressed = bytes.fromhex('0208208000') + zlib.compress(raw, wbits=-15)
        self.assertEqual(zlib.decompress(compressed, -15), raw)
        signature = bytes.fromhex('efbeadde') + b'NullsoftInst'
        stub = b'MZ' + bytes(1022)
        archive = stub + struct.pack('<I', 0) + signature + struct.pack('<II', 7, 28 + len(compressed) + 4) + compressed
        archive += struct.pack('<I', zlib.crc32(archive[512:]))
        with tempfile.TemporaryDirectory() as temp:
            original = Path(temp) / 'original.exe'
            copy = Path(temp) / 'inspection.exe'
            original.write_bytes(archive)
            evidence = module['inspection_copy'](original, copy)
            normalized = copy.read_bytes()
            self.assertEqual(original.read_bytes(), archive)
            self.assertEqual(normalized[:1048], archive[:1048])
            self.assertEqual(zlib.decompress(normalized[1052:-4], -15), raw)
            self.assertNotEqual(normalized[1055], 0x80)
            self.assertEqual(struct.unpack_from('<I', normalized, 1048)[0], len(normalized) - 1024)
            self.assertEqual(struct.unpack('<I', normalized[-4:])[0], zlib.crc32(normalized[512:-4]))
            self.assertTrue(evidence['decoded_bytes_identical'])
            # CRC failures, trailing data, unsupported flags and ordinary streams
            # must never be silently converted into an apparently good archive.
            for damaged in (archive[:-1] + bytes([archive[-1] ^ 1]), archive + b'extra',
                            archive[:1024] + b'\x04' + archive[1025:], normalized):
                original.write_bytes(damaged)
                rejected = Path(temp) / 'rejected.exe'
                with self.assertRaises(ValueError):
                    module['inspection_copy'](original, rejected)
                self.assertFalse(rejected.exists())

    def test_payload_rejects_extra_runtime_and_changed_or_missing_notices(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'repo'
            payload = Path(temp) / 'payload'
            for name in ('licenses/LICENSE.txt', 'installer-notices/NOTICE.txt'):
                source = root / 'resources' / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_bytes(b'GENUINE TEST FIXTURE NOTICE')
                destination = payload / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(source.read_bytes())
            (root / 'THIRD_PARTY_NOTICES.md').write_bytes(b'fixture index')
            (payload / 'THIRD_PARTY_NOTICES.md').write_bytes(b'fixture index')
            for name in ('news-terminal.exe', 'uninstall.exe', '$PLUGINSDIR/modern-wizard.bmp'):
                path = payload / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'fixture')
            module['check_payload_tree'](root, payload, 'installer', set())
            for name in ('.local-ai/model.gguf', 'ollama.exe', 'licenses/extra.txt', 'scripts/local-ai-run.py'):
                path = payload / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'EXTRA')
                with self.assertRaisesRegex(ValueError, 'Unexpected|payload'):
                    module['check_payload_tree'](root, payload, 'installer', set())
                path.unlink()
            (payload / 'licenses/LICENSE.txt').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'notice'):
                module['check_payload_tree'](root, payload, 'installer', set())
            (payload / 'licenses/LICENSE.txt').unlink()
            with self.assertRaisesRegex(ValueError, 'payload'):
                module['check_payload_tree'](root, payload, 'installer', set())

    def test_model_disguised_as_notice_is_not_allowed(self):
        module = self.module()
        with self.assertRaisesRegex(ValueError, 'runtime|model|helper'):
            module['TOOLS']['check_distribution_names'](['licenses/model.gguf'])
        for name in ('.local-ai/data', 'licenses/ollama.exe', 'scripts/local-ai-run.py', 'models/sha256-deadbeef', 'licenses/model.safetensors'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'runtime|model|helper'):
                module['TOOLS']['check_distribution_names']([name])
        module['TOOLS']['check_distribution_names'](['licenses/sources/cssparser-0.35.0.crate', 'news-terminal.exe'])

    def test_real_historical_installer_in_isolated_fixture(self):
        import json
        import shutil
        import subprocess
        repo = Path(__file__).resolve().parents[1]
        seven = Path('C:/Users/user/AppData/Local/Temp/nt-installer-review/7zip/7z.exe')
        old = repo / 'release/News-Terminal-0.1.0-windows-x64-setup.exe'
        if not seven.is_file() or not old.is_file():
            self.skipTest('Historical local installer/full 7-Zip not available; no download')
        module = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'fixture-repo'
            root.mkdir()
            original = Path(temp) / 'original-extraction'
            subprocess.run([str(seven), 'x', str(old), '-o' + str(original), '-y'], check=True, capture_output=True)
            for folder in ('licenses', 'installer-notices'):
                shutil.copytree(original / folder, root / 'resources' / folder)
            shutil.copy2(original / 'THIRD_PARTY_NOTICES.md', root / 'THIRD_PARTY_NOTICES.md')
            (root / 'package.json').write_text('{"version":"0.1.0"}')
            (root / 'package-lock.json').write_text('{"version":"0.1.0","packages":{"":{"version":"0.1.0"}}}')
            (root / 'src-tauri').mkdir()
            (root / 'src-tauri/Cargo.toml').write_text('[package]\nname="news-terminal"\nversion="0.1.0"\n')
            (root / 'src-tauri/Cargo.lock').write_text('[[package]]\nname="news-terminal"\nversion="0.1.0"\n')
            config = json.loads((repo / 'src-tauri/tauri.conf.json').read_text())
            config['version'] = '0.1.0'
            (root / 'src-tauri/tauri.conf.json').write_text(json.dumps(config))
            exe = root / 'src-tauri/target/release/bundle/nsis/News Terminal_0.1.0_x64-setup.exe'
            exe.parent.mkdir(parents=True)
            shutil.copy2(old, exe)
            shutil.copy2(original / 'news-terminal.exe', root / 'src-tauri/target/release/news-terminal.exe')
            script = root / 'src-tauri/target/release/nsis/x64/installer.nsi'
            script.parent.mkdir(parents=True)
            script.write_text('  SetCompressor /SOLID "zlib"\n!define INSTALLWEBVIEW2MODE ""\n!define WEBVIEW2BOOTSTRAPPERPATH ""\n!define WEBVIEW2INSTALLERPATH ""\n')
            report = module['verify_installer'](root, str(seven), Path(temp) / 'verified-extraction')
            self.assertEqual(report['version'], '0.1.0')
            self.assertTrue(report['all_notice_bytes_match'])
            self.assertTrue(report['local_ai_excluded'])
            self.assertFalse((root / 'docs/evidence/installer-payload.json').exists())

    def test_only_expected_bundle_marker_may_differ(self):
        module = self.module()
        compare = module['check_application']
        compare(b'prefixUNKsuffix', b'prefixNSSsuffix')
        compare(b'identical', b'identical')
        for old, new in [(b'prefixUNKsuffix', b'prefixNSSchange'), (b'old', b'new'), (b'UNKUNK', b'NSSNSS')]:
            with self.assertRaisesRegex(ValueError, 'application'):
                compare(old, new)


if __name__ == '__main__':
    unittest.main()
