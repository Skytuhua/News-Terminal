"""Installer verification unit tests; no installer execution or publishing."""
from pathlib import Path
import os
import runpy
import tempfile
import unittest


class InstallerTest(unittest.TestCase):
    def module(self):
        try:
            return runpy.run_path(str(Path(__file__).with_name('verify-installer.py')))
        except SystemExit as error:
            self.fail(f'Import must not parse CLI arguments or extract installers: {error}')

    def setup_fixture(self, base):
        import json
        root = Path(base) / 'repo'
        (root / 'src-tauri').mkdir(parents=True)
        config = {'bundle': {'active': True, 'targets': ['nsis'], 'windows': {
            'webviewInstallMode': {'type': 'offlineInstaller', 'silent': True},
            'nsis': {'compression': 'zlib', 'installMode': 'currentUser'}}}}
        (root / 'src-tauri/tauri.conf.json').write_text(json.dumps(config))
        source = Path(base) / 'Microsoft $` runtime fixture.exe'
        source.write_bytes(b'TEST FIXTURE MICROSOFT RUNTIME, NOT EXECUTABLE')
        escaped = str(source).replace('$', '$$').replace('`', '$\\`')
        script = '\n'.join(['SetCompressor /SOLID "zlib"', '!define INSTALLMODE "currentUser"',
                            '!define ARCH "x64"', '!define INSTALLWEBVIEW2MODE "offlineInstaller"',
                            '!define WEBVIEW2INSTALLERARGS "/silent"', '!define WEBVIEW2BOOTSTRAPPERPATH ""',
                            '!define MINIMUMWEBVIEW2VERSION ""', f'!define WEBVIEW2INSTALLERPATH "{escaped}"',
                            'File "/oname=$TEMP\\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"'])
        return root, source, script

    def test_generated_script_requires_offline_current_user_x64_and_one_define(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root, source, script = self.setup_fixture(temp)
            self.assertEqual(module['check_setup_script'](root, script), source)
            for old, new in (('"offlineInstaller"', '""'), ('"offlineInstaller"', '"embedBootstrapper"'),
                             ('"currentUser"', '"perMachine"'), ('"x64"', '"arm64"'),
                             ('"/silent"', '""'), ('"zlib"', '"lzma"'),
                             ('/oname=$TEMP\\MicrosoftEdgeWebView2RuntimeInstaller.exe', '/oname=extra.exe'),
                             ('!define WEBVIEW2BOOTSTRAPPERPATH ""', '!define WEBVIEW2BOOTSTRAPPERPATH "online.exe"')):
                with self.subTest(new=new), self.assertRaisesRegex(ValueError, 'NSIS'):
                    module['check_setup_script'](root, script.replace(old, new))
            with self.assertRaisesRegex(ValueError, 'exactly one'):
                module['check_setup_script'](root, script + '\n!define INSTALLMODE "currentUser"')
            source.unlink()
            with self.assertRaisesRegex(ValueError, 'existing nonempty'):
                module['check_setup_script'](root, script)

    def test_runtime_payload_must_be_exact_and_have_a_notice(self):
        import shutil
        module = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root, source, _ = self.setup_fixture(temp)
            payload = Path(temp) / 'payload'
            for name in ('licenses/LICENSE.txt', 'installer-notices/NOTICE.txt',
                         'installer-notices/Microsoft-WebView2-Runtime.md'):
                notice = root / 'resources' / name
                notice.parent.mkdir(parents=True, exist_ok=True)
                notice.write_bytes(b'TEST FIXTURE NOTICE')
                destination = payload / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(notice, destination)
            (root / 'THIRD_PARTY_NOTICES.md').write_bytes(b'TEST INDEX')
            (payload / 'THIRD_PARTY_NOTICES.md').write_bytes(b'TEST INDEX')
            for name in ('news-terminal.exe', 'uninstall.exe', '$PLUGINSDIR/modern-wizard.bmp'):
                path = payload / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'TEST FIXTURE')
            runtime = payload / module['TOOLS']['WEBVIEW2_MEMBER']
            runtime.parent.mkdir(parents=True)
            shutil.copyfile(source, runtime)
            check = module['check_payload_tree']
            check(root, payload, 'installer', set(), source)
            runtime.write_bytes(b'CHANGED RUNTIME')
            with self.assertRaisesRegex(ValueError, 'WebView2 installer bytes'):
                check(root, payload, 'installer', set(), source)
            runtime.unlink()
            with self.assertRaisesRegex(ValueError, 'missing installer payload'):
                check(root, payload, 'installer', set(), source)
            shutil.copyfile(source, runtime)
            extra = payload / '$TEMP/MicrosoftEdgeWebview2Setup.exe'
            extra.write_bytes(b'UNEXPECTED ONLINE BOOTSTRAPPER')
            with self.assertRaisesRegex(ValueError, 'Unexpected'):
                check(root, payload, 'installer', set(), source)
            extra.unlink()
            (root / 'resources/installer-notices/Microsoft-WebView2-Runtime.md').unlink()
            (payload / 'installer-notices/Microsoft-WebView2-Runtime.md').unlink()
            with self.assertRaisesRegex(ValueError, 'redistribution notice'):
                check(root, payload, 'installer', set(), source)
            uninstaller = Path(temp) / 'uninstaller'
            uninstaller.mkdir()
            (uninstaller / 'MicrosoftEdgeWebView2RuntimeInstaller.exe').write_bytes(source.read_bytes())
            with self.assertRaisesRegex(ValueError, 'Unexpected'):
                check(root, uninstaller, 'uninstaller', set(), source)

    def test_authenticode_reads_filename_as_data_and_rejects_other_publishers(self):
        import json
        import subprocess
        from unittest.mock import patch
        module = self.module()
        signature = {'status': 'Valid', 'subject': 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US', 'thumbprint': 'A' * 40}
        path = Path("C:/test/$([throw])/runtime with spaces.exe")
        with patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0, json.dumps(signature), '')) as run:
            self.assertEqual(module['microsoft_signature'](path), signature)
            args, kwargs = run.call_args
            self.assertNotIn(str(path), ' '.join(args[0]))
            self.assertEqual(kwargs['env']['NEWS_TERMINAL_WEBVIEW2_INSTALLER'], str(path))
            self.assertNotIn('shell', kwargs)
            self.assertIn('Get-AuthenticodeSignature -LiteralPath', args[0][-1])
            self.assertTrue(kwargs['check'])
        for field, value in (('status', 'NotSigned'), ('status', 'HashMismatch'),
                             ('subject', 'CN=Microsoft Corporation, O=Other Publisher'),
                             ('subject', 'CN=Microsoft Corporation'), ('thumbprint', 'missing')):
            with self.subTest(field=field, value=value), self.assertRaisesRegex(ValueError, 'Microsoft'):
                module['TOOLS']['check_microsoft_signature']({**signature, field: value})

    @unittest.skipUnless(os.name == 'nt', 'Requires Windows PowerShell and real Authenticode verification')
    def test_authenticode_recovers_from_incompatible_inherited_module_path(self):
        import shutil
        from unittest.mock import patch
        module = self.module()
        powershell = shutil.which('powershell.exe')
        self.assertIsNotNone(powershell, 'Windows PowerShell must be available for installer verification')
        with tempfile.TemporaryDirectory(prefix='news-terminal-incompatible-modules-') as temp:
            utility = Path(temp) / 'Microsoft.PowerShell.Utility'
            utility.mkdir()
            (utility / 'Microsoft.PowerShell.Utility.psd1').write_text(
                "@{ RootModule = 'Microsoft.PowerShell.Utility.psm1'; ModuleVersion = '99.0'; "
                "PowerShellVersion = '7.0'; FunctionsToExport = @('ConvertTo-Json'); "
                "CmdletsToExport = @(); AliasesToExport = @() }\n", encoding='utf-8')
            (utility / 'Microsoft.PowerShell.Utility.psm1').write_text(
                "function ConvertTo-Json { throw 'Incompatible fixture module must never run' }\n",
                encoding='utf-8')
            # Reproduce the incompatible module shadowing inherited through an
            # intermediate Python process, without requiring pwsh on the host.
            module_path = temp + os.pathsep + os.environ.get('PSModulePath', '')
            with patch.dict(os.environ, {'PSModulePath': module_path}):
                signature = module['microsoft_signature'](Path(powershell))
                self.assertEqual(signature['status'], 'Valid')
                self.assertIn('O=Microsoft Corporation', signature['subject'])
                self.assertEqual(os.environ['PSModulePath'], module_path,
                                 'The helper must preserve the parent module path')

    def test_authenticode_failure_reports_bounded_captured_output(self):
        import subprocess
        from unittest.mock import patch
        module = self.module()
        error = subprocess.CalledProcessError(
            1, ['powershell.exe'], output='x' * 12000 + 'stdout diagnostic',
            stderr='y' * 12000 + 'module autoload failed')
        with patch('subprocess.run', side_effect=error):
            with self.assertRaisesRegex(ValueError, 'Authenticode probe failed with exit 1') as caught:
                module['microsoft_signature'](Path('runtime.exe'))
        message = str(caught.exception)
        self.assertIn('module autoload failed', message)
        self.assertIn('stdout diagnostic', message)
        self.assertLessEqual(len(message), 6500)
        self.assertIs(caught.exception.__cause__, error)

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

    def test_real_historical_skip_payload_remains_an_extraction_fixture(self):
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
            # Historical skip-mode bytes exercise extraction and notices only.
            # They must never satisfy the current offline setup release gate.
            plugins = {'System.dll', 'nsDialogs.dll', 'StartMenu.dll', 'nsis_tauri_utils.dll'}
            module['check_payload_tree'](root, original, 'installer', plugins)
            nested = Path(temp) / 'nested-extraction'
            subprocess.run([str(seven), 'x', str(original / 'uninstall.exe'), '-o' + str(nested), '-y'], check=True, capture_output=True)
            module['check_payload_tree'](root, nested, 'uninstaller', {'System.dll', 'LangDLL.dll', 'nsis_tauri_utils.dll'})
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
