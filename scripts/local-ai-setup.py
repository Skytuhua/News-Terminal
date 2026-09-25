"""Download a pinned official portable Ollama release; no installer or PATH changes."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local-ai'
VERSION = '0.34.3'
URL = f'https://github.com/ollama/ollama/releases/download/v{VERSION}/ollama-windows-amd64.zip'
SHA256 = '306ce9e81e3491d147f558e60d7a389499f244d10f71859c6e4e899241d1b4ae'


def main():
    LOCAL.mkdir(exist_ok=True)
    # The entire folder is deliberately excluded without changing repository rules.
    (LOCAL / '.gitignore').write_text('*\n', encoding='utf-8')
    subprocess.run(['git', '-C', str(ROOT), 'check-ignore', '.local-ai/probe'], check=True)
    if shutil.disk_usage(LOCAL).free < 12 * 1024**3:
        raise RuntimeError('At least 12 GiB free disk required for runtime, archive and model.')
    archive = LOCAL / f'ollama-windows-amd64-{VERSION}.zip'
    if not archive.exists():
        partial = archive.with_suffix('.zip.part')
        print(f'Downloading official portable runtime: {URL}', flush=True)
        urllib.request.urlretrieve(URL, partial)
        partial.replace(archive)
    digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    if digest != SHA256:
        raise RuntimeError(f'Archive checksum mismatch: {digest}')
    runtime = LOCAL / f'ollama-{VERSION}'
    runtime.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            target = (runtime / member.filename).resolve()
            if not target.is_relative_to(runtime.resolve()):
                raise RuntimeError('Unsafe ZIP member')
        z.extractall(runtime)
    licenses = LOCAL / 'licenses'
    licenses.mkdir(exist_ok=True)
    for name, url in {
        'ollama-MIT.txt': f'https://raw.githubusercontent.com/ollama/ollama/v{VERSION}/LICENSE',
        'qwen3-Apache-2.0.txt': 'https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/raw/main/LICENSE',
    }.items():
        urllib.request.urlretrieve(url, licenses / name)
    result = {'version': VERSION, 'url': URL, 'archive_bytes': archive.stat().st_size,
              'sha256': digest, 'runtime': str(runtime),
              'runtime_bytes': sum(p.stat().st_size for p in runtime.rglob('*') if p.is_file())}
    (LOCAL / 'runtime-provenance.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
