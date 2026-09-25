"""Integration checks against the real lockfiles, cache, and generated bundle."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LicenseBundleTest(unittest.TestCase):
    def test_capture_excludes_copyright_named_program_files(self):
        import runpy
        import tempfile
        module = runpy.run_path(str(ROOT / "scripts/license-notices.py"))
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / "LICENSE").write_text("Actual fixture license")
            (directory / "copyright.js").write_text("export const icon = []")
            (directory / "copyright.js.map").write_text("{}")
            texts, evidence = module["collect"](directory, {})
            self.assertEqual([p["source_path"] for p in texts], ["LICENSE"])
            self.assertEqual(evidence, [])

    def test_mpl_sources_reject_modified_and_added_files(self):
        import runpy
        import tempfile
        import tarfile
        import io
        verify = runpy.run_path(str(ROOT / "scripts/license-notices.py"))["verify_source_archive"]
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            member = tarfile.TarInfo("fixture-1.0/lib.rs")
            member.size = 8
            archive.addfile(member, io.BytesIO(b"original"))
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / "lib.rs"
            source.write_bytes(b"original")
            self.assertEqual(verify(buffer.getvalue(), directory, "fixture", "1.0"), 1)
            source.write_bytes(b"modified")
            with self.assertRaisesRegex(ValueError, "modified"):
                verify(buffer.getvalue(), directory, "fixture", "1.0")
            source.write_bytes(b"original")
            (directory / "extra.rs").write_bytes(b"new code")
            with self.assertRaisesRegex(ValueError, "Additional"):
                verify(buffer.getvalue(), directory, "fixture", "1.0")

    def test_supplement_hash_tampering_is_rejected(self):
        import runpy
        import tempfile
        module = runpy.run_path(str(ROOT / "scripts/license-notices.py"))
        verify = module["supplements"]
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "upstream").mkdir()
            content = b"authentic fixture text"
            (directory / "upstream/license.txt").write_bytes(content)
            artifact = {"path": "upstream/license.txt", "sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
            (directory / "upstream/manifest.json").write_text(json.dumps({"artifacts": [artifact]}))
            verify.__globals__["OUT"] = directory
            self.assertEqual(len(verify({})["artifacts"]), 1)
            (directory / "upstream/license.txt").write_bytes(b"tampered fixture text")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                verify({})

    def test_distribution_scope_and_strict_modes(self):
        output = ROOT / "resources/licenses"
        report = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
        self.assertEqual(report["counts"]["windows_applicable_missing_license_issues"], 0)
        self.assertEqual(len(report["source_archives"]), 5)
        self.assertEqual(len(report["webview2_sdk"]["loader_matches"]), 9)
        for issue in report["missing_license_issues"]:
            self.assertEqual(issue["scope"], "other-target-or-resolved-optional-supplement")
        generator = str(ROOT / "scripts/license-notices.py")
        subprocess.run([sys.executable, generator, "--check", "--strict-windows"], cwd=ROOT, check=True, capture_output=True)
        result = subprocess.run([sys.executable, generator, "--check", "--strict"], cwd=ROOT, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Known missing license evidence remains", result.stderr)

    def test_locked_inventory_and_byte_exact_texts(self):
        generator = ROOT / "scripts/license-notices.py"
        self.assertTrue(generator.is_file(), "Reproducible license generator is missing")
        subprocess.run([sys.executable, str(generator), "--check"], cwd=ROOT, check=True)
        output = ROOT / "resources/licenses"
        report = json.loads((output / "inventory.json").read_text(encoding="utf-8"))
        cargo = tomllib.loads((ROOT / "src-tauri/Cargo.lock").read_text(encoding="utf-8"))
        expected_cargo = {(p["name"], p["version"], p.get("source")) for p in cargo["package"] if p.get("source")}
        actual_cargo = {(p["name"], p["version"], p["source"]) for p in report["packages"] if p["ecosystem"] == "cargo"}
        self.assertEqual(expected_cargo, actual_cargo)
        npm = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        expected_npm = {k for k, p in npm["packages"].items() if k and not p.get("dev")}
        actual_npm = {p["lock_path"] for p in report["packages"] if p["ecosystem"] == "npm" and p["scope"] == "production-lock-entry"}
        self.assertEqual(expected_npm, actual_npm)
        self.assertEqual(len(report["packages"]), report["counts"]["packages"])
        for p in report["packages"]:
            self.assertTrue(p["license_expression"], p["name"])
            for f in p["texts"] + p["evidence"]:
                data = (output / f["path"]).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), f["sha256"])
        missing = sum(not p["texts"] for p in report["packages"])
        self.assertEqual(missing, report["counts"]["packages_without_named_license_texts"])
        self.assertEqual((ROOT / "LICENSE").read_bytes(), (output / "APPLICATION-LICENSE.txt").read_bytes())
        self.assertEqual((ROOT / "THIRD_PARTY_NOTICES.md").read_bytes(), (output / "REFERENCE-NOTICES.md").read_bytes())


if __name__ == "__main__":
    unittest.main()
