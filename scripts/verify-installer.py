"""Inspect both NSIS layers and exact notice payload without installing."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import runpy
import subprocess
import struct
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
TOOLS = runpy.run_path(str(Path(__file__).with_name('package-release.py')))


def nsis_define(script, name):
    rows = [line.strip() for line in script.splitlines()
            if re.match(r'^\s*!define\s+' + re.escape(name) + r'(?:\s|$)', line)]
    if len(rows) != 1:
        raise ValueError('Generated NSIS script needs exactly one define: ' + name)
    match = re.fullmatch(r'!define\s+' + re.escape(name) + r'\s+"([^"\r\n]*)"', rows[0])
    if match is None:
        raise ValueError('Unsupported generated NSIS define: ' + name)
    value = match[1]
    # Tauri 2.11.5 escapes literal dollars and backticks in generated strings.
    decoded = []
    index = 0
    while index < len(value):
        if value[index] != '$':
            decoded.append(value[index])
            index += 1
        elif value.startswith('$$', index):
            decoded.append('$')
            index += 2
        elif value.startswith('$\\`', index):
            decoded.append('`')
            index += 3
        else:
            raise ValueError('Unsupported NSIS variable or escape in define: ' + name)
    return ''.join(decoded)


def check_setup_script(root, script):
    TOOLS['windows_setup_policy'](root)
    compressors = [line.strip() for line in script.splitlines() if line.lstrip().startswith('SetCompressor ')]
    if compressors != ['SetCompressor /SOLID "zlib"']:
        raise ValueError('Generated NSIS script must select only solid zlib compression')
    for name, expected in {'INSTALLMODE': 'currentUser', 'ARCH': 'x64',
                           'INSTALLWEBVIEW2MODE': 'offlineInstaller', 'WEBVIEW2INSTALLERARGS': '/silent',
                           'WEBVIEW2BOOTSTRAPPERPATH': '', 'MINIMUMWEBVIEW2VERSION': ''}.items():
        if nsis_define(script, name) != expected:
            raise ValueError('Generated NSIS script does not select required setting: ' + name)
    source = Path(nsis_define(script, 'WEBVIEW2INSTALLERPATH'))
    if not source.is_absolute() or not source.is_file() or source.stat().st_size == 0:
        raise ValueError('Generated NSIS WebView2 installer path must name an existing nonempty absolute file')
    directive = 'File "/oname=$TEMP\\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"'
    if directive not in {line.strip() for line in script.splitlines()}:
        raise ValueError('Generated NSIS script does not embed the expected temporary WebView2 installer')
    return source


def microsoft_signature(path):
    # Pass the filename as data through a child-only environment variable. A
    # Windows username/path must never become PowerShell command text.
    command = ("$ErrorActionPreference = 'Stop'; "
               "$s = Get-AuthenticodeSignature -LiteralPath $env:NEWS_TERMINAL_WEBVIEW2_INSTALLER; "
               "[pscustomobject]@{status=$s.Status.ToString(); subject=$s.SignerCertificate.Subject; "
               "thumbprint=$s.SignerCertificate.Thumbprint} | ConvertTo-Json -Compress")
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
                            env={**os.environ, 'NEWS_TERMINAL_WEBVIEW2_INSTALLER': str(path)},
                            capture_output=True, text=True, encoding='utf-8', errors='replace', check=True,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=45)
    signature = json.loads(result.stdout.lstrip('\ufeff'))
    TOOLS['check_microsoft_signature'](signature)
    return signature


def check_application(standalone, packaged):
    if standalone == packaged:
        return
    if len(standalone) == len(packaged):
        offset = next(i for i, (a, b) in enumerate(zip(standalone, packaged)) if a != b)
        if standalone[offset:offset + 3] == b'UNK' and packaged == standalone[:offset] + b'NSS' + standalone[offset + 3:]:
            return
    raise ValueError('Packaged application differs from current standalone beyond the Tauri UNK/NSS marker')


def check_payload_tree(root, destination, label, plugins, webview2_source=None):
    allowed = {'$PLUGINSDIR/' + name for name in plugins}
    notices = {}
    if label == 'installer':
        allowed.update(('news-terminal.exe', 'uninstall.exe', '$PLUGINSDIR/modern-wizard.bmp'))
        notices['THIRD_PARTY_NOTICES.md'] = root / 'THIRD_PARTY_NOTICES.md'
        for folder in ('licenses', 'installer-notices'):
            base = root / 'resources' / folder
            files = [p for p in base.rglob('*') if p.is_file()]
            if not files:
                raise ValueError('Missing source notices: ' + folder)
            notices.update({folder + '/' + p.relative_to(base).as_posix(): p for p in files})
        allowed.update(notices)
        if webview2_source is not None:
            if 'installer-notices/Microsoft-WebView2-Runtime.md' not in notices:
                raise ValueError('Missing Microsoft WebView2 redistribution notice')
            allowed.add(TOOLS['WEBVIEW2_MEMBER'])
    actual = {p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file()}
    TOOLS['check_distribution_names'](actual)
    if actual != allowed:
        raise ValueError(f'Unexpected or missing {label} payload: extra={sorted(actual - allowed)}, missing={sorted(allowed - actual)}')
    for name, source in notices.items():
        if source.read_bytes() != (destination / name).read_bytes():
            raise ValueError('Packaged notice bytes differ: ' + name)
    if label == 'installer' and webview2_source is not None:
        if TOOLS['sha256'](webview2_source) != TOOLS['sha256'](destination / TOOLS['WEBVIEW2_MEMBER']):
            raise ValueError('Packaged WebView2 installer bytes differ from the generated NSIS input')
    return {folder + '_files_compared': sum(name.startswith(folder + '/') for name in notices) for folder in ('licenses', 'installer-notices')}


def inspection_copy(archive, destination):
    """Work around 7-Zip's sig[3]==0x80 solid/non-solid heuristic, not bad data.

    Only an unsigned, CRC-checked NSIS solid raw-Deflate stream is eligible.
    Recompress an inspection-only copy and prove the entire decoded stream is
    identical; never replace or execute the release artifact. See NsisIn.cpp
    CInArchive::Open2 in https://github.com/ip7z/7zip/tree/26.03 .
    """
    original = archive.read_bytes()
    signature = bytes.fromhex('efbeadde') + b'NullsoftInst'
    offsets = [offset for offset in range(512, min(len(original) - 32, 1 << 20), 512)
               if original[offset + 4:offset + 20] == signature]
    if not original.startswith(b'MZ') or len(offsets) != 1:
        raise ValueError('Fallback requires one aligned NSIS header in a PE stub')
    offset = offsets[0]
    flags, = struct.unpack_from('<I', original, offset)
    header_size, archive_size = struct.unpack_from('<II', original, offset + 20)
    if flags not in (0, 1) or archive_size != len(original) - offset:
        raise ValueError('Fallback refuses unsupported flags, signed/trailing or truncated archives')
    if zlib.crc32(original[512:-4]) != struct.unpack('<I', original[-4:])[0]:
        raise ValueError('Original NSIS CRC mismatch')
    compressed = original[offset + 28:-4]
    if len(compressed) < 4 or compressed[3] != 0x80:
        raise ValueError('Not the known 7-Zip solid Deflate detection collision')
    decoder = zlib.decompressobj(-15)
    try:
        decoded = decoder.decompress(compressed, 256 * 1024 * 1024)
    except zlib.error as error:
        raise ValueError('Original stream is not valid raw Deflate') from error
    if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError('Original Deflate stream is incomplete, oversized or has trailing data')
    if len(decoded) < 4 or struct.unpack_from('<I', decoded)[0] != header_size or not 0 < header_size <= len(decoded) - 4:
        raise ValueError('Original solid NSIS header length mismatch')
    encoder = zlib.compressobj(9, zlib.DEFLATED, -15, 8, zlib.Z_FIXED)
    replacement = encoder.compress(decoded) + encoder.flush()
    if replacement[3] == 0x80 or zlib.decompress(replacement, -15) != decoded:
        raise ValueError('Inspection recompression did not resolve detection losslessly')
    converted = bytearray(original[:offset + 28] + replacement)
    struct.pack_into('<I', converted, offset + 24, len(converted) + 4 - offset)
    converted += struct.pack('<I', zlib.crc32(converted[512:]))
    with destination.open('xb') as stream:
        stream.write(converted)
    return {'reason': '7-Zip sig[3]==0x80 misidentifies solid Deflate as non-solid',
            'original_sha256': hashlib.sha256(original).hexdigest(),
            'inspection_copy_sha256': hashlib.sha256(converted).hexdigest(),
            'decoded_stream_sha256': hashlib.sha256(decoded).hexdigest(),
            'decoded_bytes_identical': True, 'original_crc_valid': True,
            'inspection_copy': str(destination)}


def verify_installer(root, sevenzip, out):
    version = TOOLS['release_version'](root)
    before = TOOLS['input_hashes'](root)
    exe = root / f'src-tauri/target/release/bundle/nsis/News Terminal_{version}_x64-setup.exe'
    standalone = root / 'src-tauri/target/release/news-terminal.exe'
    installer_hash = TOOLS['sha256'](exe)
    standalone_hash = TOOLS['sha256'](standalone)
    script = (root / 'src-tauri/target/release/nsis/x64/installer.nsi').read_text(encoding='utf-8-sig')
    runtime_source = check_setup_script(root, script)
    runtime_hash = TOOLS['sha256'](runtime_source)
    signature = microsoft_signature(runtime_source)
    cache = Path(os.environ['LOCALAPPDATA']) / 'tauri/NSIS/Plugins/x86-unicode'
    report = {}
    for label, archive, expected in (
        ('installer', exe, {'System.dll', 'nsDialogs.dll', 'StartMenu.dll', 'nsis_tauri_utils.dll'}),
        ('uninstaller', out / 'installer/uninstall.exe', {'System.dll', 'LangDLL.dll', 'nsis_tauri_utils.dll'}),
    ):
        destination = out / label
        if destination.exists():
            raise ValueError('Extraction destination already exists; refusing stale payload')
        listed = subprocess.run([sevenzip, 'l', '-slt', str(archive)], capture_output=True)
        normalization = None
        if listed.returncode:
            # Never weaken payload checks or alter the release EXE to make a
            # reader happy. The guarded helper proves decoded-stream identity.
            inspection = out / (label + '-inspection-only.exe')
            out.mkdir(parents=True, exist_ok=True)
            try:
                normalization = inspection_copy(archive, inspection)
            except ValueError as error:
                detail = (listed.stdout + listed.stderr).decode('utf-8', errors='replace')
                raise ValueError(f'7-Zip cannot list {label}; fallback refused: {error}\n{detail}') from error
            archive = inspection
            listed = subprocess.run([sevenzip, 'l', '-slt', str(archive)], capture_output=True, check=True)
        listing = listed.stdout.decode('utf-8', errors='replace')
        if 'Method = Deflate' not in listing.splitlines() or 'Solid = +' not in listing.splitlines():
            raise ValueError('Expected solid Deflate compression for ' + label)
        subprocess.run([sevenzip, 'x', str(archive), '-o' + str(destination), '-y'], capture_output=True, check=True)
        plugins = {f.name for f in (destination / '$PLUGINSDIR').glob('*.dll')}
        if plugins != expected:
            raise ValueError(f'Unexpected {label} plugins: {plugins}')
        hashes = {}
        for name in sorted(plugins):
            file = destination / '$PLUGINSDIR' / name
            reference = cache / ('additional/' + name if name == 'nsis_tauri_utils.dll' else name)
            if file.read_bytes() != reference.read_bytes():
                raise ValueError('Plugin bytes differ: ' + name)
            hashes[name] = TOOLS['sha256'](file)
        counts = check_payload_tree(root, destination, label, plugins, runtime_source)
        if label == 'installer':
            report.update(counts)
        report[label] = {'method': 'Deflate', 'plugin_sha256': hashes}
        if normalization is not None:
            report[label]['inspection_normalization'] = normalization
    packaged = out / 'installer/news-terminal.exe'
    check_application(standalone.read_bytes(), packaged.read_bytes())
    if (before != TOOLS['input_hashes'](root) or installer_hash != TOOLS['sha256'](exe)
            or standalone_hash != TOOLS['sha256'](standalone) or runtime_hash != TOOLS['sha256'](runtime_source)):
        raise ValueError('Release inputs changed during extraction')
    report['webview2'] = {**TOOLS['windows_setup_policy'](root), 'sha256': runtime_hash,
                          'bytes': runtime_source.stat().st_size, 'signature': signature,
                          'source_installer': str(runtime_source)}
    report.update({'version': version, 'installer_sha256': installer_hash, 'installer_bytes': exe.stat().st_size, 'standalone_application_sha256': standalone_hash, 'packaged_application_sha256': TOOLS['sha256'](packaged), 'all_notice_bytes_match': True, 'local_ai_excluded': True, 'input_sha256': before, 'extraction_dir': str(out)})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sevenzip', required=True, help='Path to full official 7z.exe (not reduced 7zr)')
    args = parser.parse_args()
    # Retain extraction for the separate packaged-native smoke test; never run it here.
    out = Path(tempfile.mkdtemp(prefix='news-terminal-package-'))
    report = verify_installer(ROOT, args.sevenzip, out)
    destination = ROOT / 'docs/evidence/installer-payload.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=destination.parent, delete=False) as stream:
        json.dump(report, stream, indent=2)
        temporary = Path(stream.name)
    try:
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
