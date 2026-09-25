#!/usr/bin/env python3
"""Validate the bundled catalog; optionally probe reviewed endpoints (stdlib only).

This checks configuration, not legal clearance or runtime gate enforcement.
No network without --probe/--media. Never consumes an untrusted imported catalog.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
AI_IDS = {'nhc-atlantic', 'fed-press_monetary', 'fed-press_all'}
MEDIA_IDS = {'nasa-technology', 'mit-news-ai', 'esa-space-engineering', 'fed-feds-notes'}
SOCIAL_IDS = {'mastodon-official', 'lemmy-world-technology', 'youtube-nasa'}
FED_ITEM = 'https://www.federalreserve.gov/econres/notes/feds-notes/repo-markets-and-the-feds-balance-sheet-implications-for-monetary-policy-implementation-20260826.html'
FED_ASSET = {
    'itemGuid': FED_ITEM, 'itemUrl': FED_ITEM,
    'url': 'https://www.federalreserve.gov/econres/notes/feds-notes/fig1-4069.png',
    'kind': 'image', 'mime': 'image/png', 'bytes': 98752,
    'sha256': '56373565c12becc07967821a416196ef2f61b2237dd7444a9840cd04128369aa',
    'credit': 'Board of Governors of the Federal Reserve System; Sriya Anbil, Alyssa Anderson, Lucy Cordes and Romina Ruprecht, FEDS Notes, August 26, 2026. Public domain under Board website policy.',
    'caption': "Financial-market diagram — Figure 1. Effect of Balance Sheet Decline on Repo Markets. FEDS Notes authors' views, not Board concurrence; not an official recommendation or endorsement. Preserve the whole diagram; no cropping.",
    'evidenceUrl': FED_ITEM,
}
REVIEWED_IDS = AI_IDS | SOCIAL_IDS | MEDIA_IDS
MEDIA_PINS = {
    'https://www.nasa.gov/wp-content/uploads/2024/10/tdrs-data-stream-apr1080.mp4':
        ('8ed5f3d874c91213779b58d668bb3656f1d07088e27eada1ef396f6bcabada56', 13957869, 'video', 'video/mp4'),
    'https://www.nasa.gov/wp-content/uploads/2026/09/ribbon-cutting-edited.jpg':
        ('9edc61505384e8eff56548e2989b89586c3a568bdd2da136e33a6335ccd81dfa', 3468255, 'image', 'image/jpeg'),
}
NASA_LUNAR_ITEM = 'https://www.nasa.gov/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies/'
NASA_LUNAR_ASSET = {
    'itemGuid': 'https://www.nasa.gov/?post_type=press-release&p=1045129',
    'itemUrl': NASA_LUNAR_ITEM,
    'url': 'https://www.nasa.gov/wp-content/uploads/2026/09/lunar-image-reduced.png',
    'kind': 'image', 'mime': 'image/png', 'credit': 'NASA',
    'caption': 'Artistic concept of lunar surface technologies and infrastructure, not a photograph. NASA; informational/editorial display only, no endorsement. Incidental NASA insignia is not licensed for app branding or promotion. Preserve the whole concept and original article link.',
    'evidenceUrl': NASA_LUNAR_ITEM,
    'sha256': 'd2775cd0953b366fcf847d1910c3108614d0310ab18e17a26a1d1914d2ea83de',
    'bytes': 4620791,
}
MEDIA_ASSETS = {
    'mit-news-ai': {
        'rule': 'mit-exact-media-download-v1',
        'assets': {
            'https://news.mit.edu/sites/default/files/styles/news_article__cover_image__original/public/images/202609/MIT-VolumeRegistration-01-press.jpg?itok=oHDoDATr':
                (4655405, 'image', 'image/jpeg', 'Courtesy of the researchers; MIT News',
                 'https://news.mit.edu/2026/new-ai-technique-could-make-minimally-invasive-surgeries-safer-more-precise-0916',
                 'https://news.mit.edu/2026/new-ai-technique-could-make-minimally-invasive-surgeries-safer-more-precise-0916'),
        },
    },
    'esa-space-engineering': {
        'rule': 'esa-standard-licence-exact-assets-v1',
        'assets': {
            'https://www.esa.int/var/esa/storage/images/esa_multimedia/images/2026/07/the_silicon_brains_steering_next-generation_antennas/27387323-1-eng-GB/The_silicon_brains_steering_next-generation_antennas_card_full.jpg':
                (172054, 'image', 'image/jpeg', 'ESA - SJM Photography',
                 'https://www.esa.int/ESA_Multimedia/Images/2026/07/The_silicon_brains_steering_next-generation_antennas',
                 'https://www.esa.int/ESA_Multimedia/Images/2026/07/The_silicon_brains_steering_next-generation_antennas'),
            'https://www.esa.int/var/esa/storage/images/esa_multimedia/images/2026/07/plato_s_electronics_ready_for_space/27380984-1-eng-GB/Plato_s_electronics_ready_for_space_card_full.jpg':
                (198696, 'image', 'image/jpeg', "ESA - R. Moorkens O'Reilly",
                 'https://www.esa.int/ESA_Multimedia/Images/2026/07/Plato_s_electronics_ready_for_space',
                 'https://www.esa.int/ESA_Multimedia/Images/2026/07/Plato_s_electronics_ready_for_space'),
        },
    },
}
# Exact reviewed feeds; changing endpoints requires another rights review.
CONTRACTS = {
    'fed-feds-notes': ('https://www.federalreserve.gov/feeds/feds_notes.xml', 240, 'excerpt'),
    'nhc-atlantic': ('https://www.nhc.noaa.gov/index-at.xml', 15, 'excerpt'),
    'fed-press_monetary': ('https://www.federalreserve.gov/feeds/press_monetary.xml', 60, 'excerpt'),
    'fed-press_all': ('https://www.federalreserve.gov/feeds/press_all.xml', 60, 'excerpt'),
    'nasa-technology': ('https://www.nasa.gov/technology/feed/', 120, 'excerpt'),
    'mit-news-ai': ('https://news.mit.edu/rss/topic/artificial-intelligence2', 120, 'excerpt'),
    'esa-space-engineering': ('https://www.esa.int/rssfeed/Our_Activities/Space_Engineering_Technology', 120, 'excerpt'),
    'mastodon-official': ('https://mastodon.social/@Mastodon.rss', 15, 'excerpt'),
    'lemmy-world-technology': ('https://lemmy.world/feeds/c/technology.xml?sort=New', 15, 'metadata'),
    'youtube-nasa': ('https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ', 30, 'metadata'),
}


def validate_catalog(sources):
    errors = []
    ids = Counter(s.get('id') for s in sources)
    for source_id, count in ids.items():
        if count > 1:
            errors.append(f'duplicate id: {source_id}')
    for source in sources:
        sid = source.get('id', '<missing>')
        if not isinstance(sid, str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', sid):
            errors.append(f'{sid}: invalid id')
        for field in ('url', 'homepage', 'termsUrl'):
            parts = urlsplit(source.get(field, ''))
            if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.fragment:
                errors.append(f'{sid}: invalid HTTPS {field}')
        for field in ('name', 'kind', 'region', 'language', 'permissionNotes'):
            if not isinstance(source.get(field), str) or not source[field].strip():
                errors.append(f'{sid}: missing {field}')
        if not source.get('topics') or source.get('storage') not in ('excerpt', 'metadata'):
            errors.append(f'{sid}: missing topics or invalid storage')
        for field in ('enabled', 'aiAllowed', 'mediaAllowed'):
            if type(source.get(field)) is not bool:
                errors.append(f'{sid}: {field} must be explicit boolean')
        for field in ('reviewedAt', 'refreshMinutes'):
            if type(source.get(field)) is not int or source[field] <= 0:
                errors.append(f'{sid}: invalid {field}')
        if source.get('aiAllowed') is True and sid not in AI_IDS:
            errors.append(f'{sid}: unreviewed AI permission')
        if source.get('mediaAllowed') is True and sid not in MEDIA_IDS:
            errors.append(f'{sid}: unreviewed media permission')
        if source.get('storage') == 'metadata' and (source.get('aiAllowed') or source.get('mediaAllowed')):
            errors.append(f'{sid}: metadata source cannot grant AI/media')
        if sid in CONTRACTS:
            endpoint, floor, storage = CONTRACTS[sid]
            if source.get('url') != endpoint or source.get('storage') != storage:
                errors.append(f'{sid}: reviewed endpoint/storage changed')
            if source.get('refreshMinutes', 0) < floor:
                errors.append(f'{sid}: below reviewed refresh floor')
            if source.get('enabled') is not True:
                errors.append(f'{sid}: reviewed reader source unexpectedly disabled')
        if source.get('aiAllowed') or source.get('mediaAllowed'):
            policy = source.get('rightsPolicy', {})
            if policy.get('version') != 1 or policy.get('requiresItemGate') is not True or not policy.get('attribution'):
                errors.append(f'{sid}: missing item gate/version/attribution')
            if source.get('aiAllowed'):
                expected = 'nhc-origin-text-v1' if sid == 'nhc-atlantic' else 'fed-origin-text-v1'
                if policy.get('aiRule') != expected or not policy.get('outputLabel'):
                    errors.append(f'{sid}: missing AI rule/output label')
            if source.get('mediaAllowed'):
                assets = policy.get('mediaAllowlist', [])
                if sid == 'nasa-technology':
                    if (policy.get('mediaRule') != 'nasa-exact-assets-v1' or len(assets) != 3
                            or {a.get('url') for a in assets} != set(MEDIA_PINS) | {NASA_LUNAR_ASSET['url']}
                            or source.get('sectionScope')):
                        errors.append(f'{sid}: expected exact reviewed image/video allowlist without source-wide scope')
                    for asset in assets:
                        if asset.get('url') == NASA_LUNAR_ASSET['url']:
                            if asset != NASA_LUNAR_ASSET:
                                errors.append(f'{sid}: lunar concept requires exact item, bytes, hash, credit and restrictions')
                            continue
                        if (MEDIA_PINS.get(asset.get('url')) != (asset.get('sha256'), asset.get('bytes'), asset.get('kind'), asset.get('mime'))
                                or asset.get('credit') != 'NASA'
                                or asset.get('itemGuid') != 'https://www.nasa.gov/?p=1045713'
                                or not re.fullmatch(r'[a-f0-9]{64}', asset.get('sha256', ''))
                                or type(asset.get('bytes')) is not int or not 0 < asset['bytes'] <= 20 * 1024 * 1024
                                or asset.get('evidenceUrl') != CONTRACTS['nasa-technology'][0]
                                or urlsplit(asset.get('url', '')).netloc != 'www.nasa.gov'
                                or not asset.get('url', '').startswith('https://www.nasa.gov/wp-content/uploads/')
                                or not asset.get('itemUrl', '').startswith('https://www.nasa.gov/technology/')):
                            errors.append(f'{sid}: incomplete exact-asset approval')
                elif sid == 'fed-feds-notes':
                    if policy.get('mediaRule') != 'fed-exact-diagram-v1' or assets != [FED_ASSET]:
                        errors.append(f'{sid}: expected exact byte-pinned Figure 1 approval')
                    if (source.get('kind') != 'official notice' or source.get('sectionScope')
                            or source.get('termsUrl') != 'https://www.federalreserve.gov/disclaimer.htm'
                            or source.get('accessMode') != 'free-keyless'
                            or source.get('sourceAdapter') != 'feed'):
                        errors.append(f'{sid}: staff-analysis provenance, access or classification changed')
                else:
                    expected = MEDIA_ASSETS.get(sid, {})
                    approved = expected.get('assets', {})
                    if policy.get('mediaRule') != expected.get('rule') or len(assets) != len(approved):
                        errors.append(f'{sid}: expected reviewed exact-image allowlist')
                    for asset in assets:
                        pin = approved.get(asset.get('url'))
                        if (pin is None
                                or (asset.get('bytes'), asset.get('kind'), asset.get('mime'), asset.get('credit'), asset.get('itemGuid'), asset.get('itemUrl')) != pin
                                or asset.get('evidenceUrl') != pin[5]
                                or asset.get('integrity') != 'size-mime-reviewed-no-hash'
                                or 'sha256' in asset
                                or not asset.get('caption')):
                            errors.append(f'{sid}: incomplete exact no-hash asset approval')
    if not REVIEWED_IDS.issubset(ids):
        errors.append('missing reviewed sources')
    if {s['id'] for s in sources if s.get('aiAllowed') is True} != AI_IDS:
        errors.append('reviewed AI permissions changed')
    if {s['id'] for s in sources if s.get('mediaAllowed') is True} != MEDIA_IDS:
        errors.append('reviewed media permissions changed')
    return errors


def feed_stats(body):
    # Match the app's conservative XML boundary. Parse bytes (including UTF-8 BOM).
    if len(body) > 5 * 1024 * 1024 or b'\x00' in body or b'<!doctype' in body.lower() or b'<!entity' in body.lower():
        raise ValueError('unsafe or oversized feed XML')
    tree = ET.fromstring(body)
    if tree.tag == 'rss':
        entries = tree.findall('./channel/item')
        title_tag = 'title'
    elif tree.tag == '{http://www.w3.org/2005/Atom}feed':
        entries = tree.findall('{http://www.w3.org/2005/Atom}entry')
        title_tag = '{http://www.w3.org/2005/Atom}title'
    else:
        raise ValueError('response is not RSS/Atom')
    return {'items': len(entries), 'missingTitles': sum(not e.findtext(title_tag) for e in entries)}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # These exact endpoints were verified directly. Changed redirects need review.
        raise ValueError('probe refuses redirects; review the destination explicitly')


def bounded_get(url, limit):
    request = Request(url, headers={'User-Agent': 'NewsTerminal/0.2 source-review', 'Accept-Encoding': 'identity'})
    with build_opener(NoRedirect()).open(request, timeout=25) as response:
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError('response exceeds probe byte limit')
        if response.headers.get('Content-Encoding', 'identity') != 'identity':
            raise ValueError('unexpected content encoding')
        headers = {name: response.headers.get(name) for name in (
            'Content-Type', 'Cache-Control', 'ETag', 'Last-Modified', 'Retry-After') if response.headers.get(name)}
        return body, {'url': url, 'status': response.status, 'bytes': len(body), 'headers': headers}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe', action='store_true', help='GET the reviewed feeds once; never follows story links')
    parser.add_argument('--media', action='store_true', help='GET the three pinned NASA assets and verify SHA-256; no files retained')
    args = parser.parse_args()
    sources = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
    errors = validate_catalog(sources)
    result = {
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'total': len(sources),
        'enabled': sum(s.get('enabled') is True for s in sources),
        'aiConditional': sorted(s['id'] for s in sources if s.get('aiAllowed') is True),
        'mediaConditional': sorted(s['id'] for s in sources if s.get('mediaAllowed') is True),
        'errors': errors,
    }
    if args.probe and not errors:
        result['feeds'] = []
        for source in sources:
            if source['id'] not in REVIEWED_IDS:
                continue
            try:
                body, observation = bounded_get(source['url'], 5 * 1024 * 1024)
                observation.update(feed_stats(body))
                observation['id'] = source['id']
                result['feeds'].append(observation)
            except Exception as exc:
                errors.append(f'{source["id"]}: {type(exc).__name__}: {exc}')
    if args.media and not errors:
        result['assets'] = []
        nasa = next(s for s in sources if s['id'] == 'nasa-technology')
        for asset in nasa['rightsPolicy']['mediaAllowlist']:
            try:
                body, observation = bounded_get(asset['url'], asset['bytes'])
                observation['sha256'] = hashlib.sha256(body).hexdigest()
                observation['matchesReviewedBytes'] = len(body) == asset['bytes'] and observation['sha256'] == asset['sha256']
                observation['containerSignature'] = ('mp4/ftyp' if body[4:8] == b'ftyp' else 'jpeg' if body[:3] == b'\xff\xd8\xff' else 'unknown')
                result['assets'].append(observation)
                if not observation['matchesReviewedBytes']:
                    errors.append(f'{asset["url"]}: reviewed asset bytes changed; approval revoked pending review')
            except Exception as exc:
                errors.append(f'{asset["url"]}: {type(exc).__name__}: {exc}')
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
