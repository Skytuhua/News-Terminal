"""Explicit online acquisition, separate from the offline generator.
Fetch immutable project license files for the original Windows gaps; capture
exact crate archives for MPL source availability and WebView2 SDK evidence.
Run only to refresh reviewed supplemental inputs, then run license-notices.py.
"""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'resources/licenses'
MANIFEST = OUT / 'upstream/manifest.json'


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'News-Terminal-license-evidence'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def capture(data, path, **metadata):
    target = OUT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return dict(path=path, sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), **metadata)


def main():
    inventory = json.loads((OUT / 'inventory.json').read_text(encoding='utf-8'))
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'schema_version': 1, 'artifacts': []}
    artifacts = {a['path']: a for a in manifest['artifacts']}
    names = {'alloc-stdlib', 'defmt-parser', 'selectors', 'tauri-plugin', 'unic-char-property',
             'unic-char-range', 'unic-common', 'unic-ucd-ident', 'unic-ucd-version',
             'webview2-com', 'webview2-com-macros', 'webview2-com-sys'}
    trees = {}
    for p in inventory['packages']:
        if p['ecosystem'] != 'cargo' or p['name'] not in names:
            continue
        repo = p['repository'].rstrip('/').removesuffix('.git')
        revision = p['upstream_vcs']['git']['sha1']
        key = (repo, revision)
        if key not in trees:
            url = repo.replace('https://github.com/', 'https://api.github.com/repos/') + '/git/trees/' + revision + '?recursive=1'
            trees[key] = json.loads(fetch(url))
        paths = [t['path'] for t in trees[key]['tree'] if t['type'] == 'blob' and '/' not in t['path']
                 and t['path'].lower().startswith(('license', 'copying', 'notice', 'copyright'))]
        if p['name'] == 'selectors':
            url = 'https://www.mozilla.org/media/MPL/2.0/index.txt'
            dest = 'upstream/selectors-0.36.1/LICENSE-MPL-2.0.txt'
            artifacts[dest] = capture(fetch(url), dest, package='cargo:selectors@0.36.1',
                kind='official-license-version', url=url, revision=revision,
                source_path='LICENSE-MPL-2.0.txt', package_checksum=p['checksum'],
                revision_evidence='.cargo_vcs_info.json; lib.rs MPL-2.0 source header',
                rationale='Exact stylo revision has no MPL license file. Published lib.rs explicitly incorporates Mozilla MPL 2.0 by URL; full official version-2.0 text supplied without inventing copyright.')
        elif not paths:
            raise ValueError(f'No root licenses: {key}')
        for source_path in paths:
            url = repo.replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/' + revision + '/' + source_path
            dest = 'upstream/' + p['name'] + '-' + p['version'] + '/' + source_path
            artifacts[dest] = capture(fetch(url), dest, package='cargo:' + p['name'] + '@' + p['version'],
                kind='pinned-upstream-project-license', url=url, revision=revision, source_path=source_path,
                package_checksum=p['checksum'], revision_evidence='.cargo_vcs_info.json',
                rationale='Full repository-root project license at the exact published crate VCS revision; not a synthesized copyright notice.')
            print(dest, flush=True)
        manifest['artifacts'] = sorted(artifacts.values(), key=lambda a: a['path'])
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    # Keep exact published MPL sources alongside binary distribution notices.
    for p in inventory['packages']:
        if 'MPL-2.0' not in (p['license_expression'] or ''):
            continue
        url = p['source_archive']
        data = fetch(url)
        if hashlib.sha256(data).hexdigest() != p['checksum']:
            raise ValueError('Source archive differs from Cargo.lock: ' + p['name'])
        dest = f"sources/{p['name']}-{p['version']}.crate"
        artifacts[dest] = capture(data, dest, package=f"cargo:{p['name']}@{p['version']}",
            kind='mpl-source-archive', url=url, package_checksum=p['checksum'],
            source_path=dest, modification_status='Unmodified published source; offline generator verifies every archive member against resolved Cargo source.')
    p = next(p for p in inventory['packages'] if p['name'] == 'webview2-com-sys')
    revision = p['upstream_vcs']['git']['sha1']
    url = f'https://raw.githubusercontent.com/wravery/webview2-rs/{revision}/crates/update-bindings/src/main.rs'
    data = fetch(url)
    import re
    version = re.search(rb'const WEBVIEW2_VERSION: &str = "([^"]+)"', data)[1].decode()
    dest = 'upstream/webview2-sdk/update-bindings.rs.txt'
    artifacts[dest] = capture(data, dest, package='cargo:webview2-com-sys@' + p['version'],
        kind='sdk-version-evidence', url=url, revision=revision, source_path='crates/update-bindings/src/main.rs', package_checksum=p['checksum'])
    url = f'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{version}/microsoft.web.webview2.{version}.nupkg'
    data = fetch(url)
    archive_sha = hashlib.sha256(data).hexdigest()
    z = zipfile.ZipFile(io.BytesIO(data))
    matches = []
    registry = next((Path.home() / '.cargo/registry/src').glob('index.crates.io-*'))
    for arch in ('x64', 'x86', 'arm64'):
        for filename in ('WebView2Loader.dll', 'WebView2Loader.dll.lib', 'WebView2LoaderStatic.lib'):
            member = f'build/native/{arch}/{filename}'
            native = z.read(member)
            local = registry / f"{p['name']}-{p['version']}" / arch / filename
            if native != local.read_bytes():
                raise ValueError('NuGet loader differs from crate: ' + member)
            matches.append({'source_path': arch + '/' + filename, 'nuget_member': member,
                            'sha256': hashlib.sha256(native).hexdigest(), 'bytes': len(native)})
    for member in ('LICENSE.txt', 'NOTICE.txt', 'Microsoft.Web.WebView2.nuspec'):
        dest = 'upstream/webview2-sdk/' + member
        artifacts[dest] = capture(z.read(member), dest, package='cargo:webview2-com-sys@' + p['version'],
            kind='native-sdk-license-or-notice' if member.endswith('.txt') else 'sdk-package-metadata',
            url=url, archive_sha256=archive_sha, sdk_version=version, source_path=member,
            revision=revision, package_checksum=p['checksum'])
    manifest['webview2_sdk'] = {'version': version, 'url': url, 'sha256': archive_sha,
                               'crate_package': 'cargo:webview2-com-sys@' + p['version'], 'loader_matches': matches}
    manifest['artifacts'] = sorted(artifacts.values(), key=lambda a: a['path'])
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('Captured', len(artifacts), 'artifacts; matched', len(matches), 'native loader files')


if __name__ == '__main__':
    main()
