"""Release gate sequencing tests. All process results and app bytes are fixtures."""
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch


class ReleaseRunnerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sevenzip = self.root / '7z-fixture.exe'
        self.sevenzip.write_bytes(b'TEST FIXTURE, NEVER EXECUTED')
        self.module = runpy.run_path(str(Path(__file__).with_name('verify-release.py')))
        self.calls = []

    def process_fixture(self, command, **kwargs):
        self.calls.append(command)
        self.assertEqual(kwargs['cwd'], self.root)
        if 'scripts/verify-installer.py' in command:
            extracted = self.root / 'extracted/installer/news-terminal.exe'
            extracted.parent.mkdir(parents=True)
            extracted.write_bytes(b'TEST FIXTURE, NEVER EXECUTED')
            payload = {'extraction_dir': str(self.root / 'extracted')}
            (self.root / 'docs/evidence/installer-payload.json').write_text(json.dumps(payload))
        return subprocess.CompletedProcess(command, 0, 'SYNTHETIC TEST OUTPUT', '')

    def test_native_smoke_uses_the_inspected_packaged_executable(self):
        with patch('subprocess.run', side_effect=self.process_fixture), redirect_stdout(StringIO()):
            report = self.module['run_checks'](self.root, self.sevenzip)
        self.assertTrue(report['passed'])
        self.assertEqual([row['name'] for row in report['checks']][-3:], ['windows-build', 'installer-payload', 'native-smoke'])
        self.assertEqual(self.calls[-1], ['node', 'scripts/native-smoke.mjs', str(self.root / 'extracted/installer/news-terminal.exe')])

    def test_failed_inspection_stops_before_native_smoke_and_preserves_failure(self):
        def failure(command, **kwargs):
            self.calls.append(command)
            code = 23 if 'scripts/verify-installer.py' in command else 0
            return subprocess.CompletedProcess(command, code, '', 'SYNTHETIC FAILURE' if code else '')
        with patch('subprocess.run', side_effect=failure), redirect_stdout(StringIO()):
            report = self.module['run_checks'](self.root, self.sevenzip)
        self.assertFalse(report['passed'])
        self.assertEqual(report['checks'][-1]['name'], 'installer-payload')
        self.assertEqual(report['checks'][-1]['exitCode'], 23)
        self.assertFalse(any('scripts/native-smoke.mjs' in command for command in self.calls))
        self.assertEqual(json.loads((self.root / 'docs/evidence/release-checks.json').read_text()), report)

    def test_missing_inspection_tool_or_missing_executable_cannot_pass(self):
        with patch('subprocess.run') as run, self.assertRaisesRegex(ValueError, '7z.exe'):
            self.module['run_checks'](self.root, self.root / 'missing.exe')
        run.assert_not_called()
        self.assertFalse((self.root / 'docs/evidence').exists())
        def no_application(command, **kwargs):
            result = self.process_fixture(command, **kwargs)
            if 'scripts/verify-installer.py' in command:
                (self.root / 'extracted/installer/news-terminal.exe').unlink()
            return result
        with patch('subprocess.run', side_effect=no_application), redirect_stdout(StringIO()):
            report = self.module['run_checks'](self.root, self.sevenzip)
        self.assertFalse(report['passed'])
        self.assertEqual(report['checks'][-1]['name'], 'native-smoke')
        self.assertNotEqual(report['checks'][-1]['exitCode'], 0)
        self.assertFalse(any('scripts/native-smoke.mjs' in command for command in self.calls))


if __name__ == '__main__':
    unittest.main()
