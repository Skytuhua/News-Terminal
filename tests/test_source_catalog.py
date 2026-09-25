"""Offline policy regression tests; network probes are explicitly opt-in."""
import importlib.util
import copy
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CatalogTests(unittest.TestCase):
    def test_focus_catalog_counts_and_cost_states_are_explicit(self):
        sources = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
        automatic = [
            s for s in sources
            if s.get('sourceAdapter', 'feed') in ('feed', 'openrouter-models', 'hf-models', 'arena-results', 'swebench-results')
            and s.get('accessMode') == 'free-keyless'
        ]
        focused = [
            s for s in automatic
            if set(s.get('topics', [])) & {'ai', 'technology', 'markets', 'business'}
        ]
        self.assertGreaterEqual(len(sources), 45)
        self.assertGreaterEqual(len(automatic), 35)
        self.assertGreaterEqual(len(focused), 28)
        for source in sources:
            with self.subTest(source=source.get('id')):
                self.assertIn(source.get('accessMode'), {'free-keyless', 'approval-free', 'external-only'})
                self.assertIn(source.get('sourceAdapter', 'feed'), {
                    'feed', 'openrouter-models', 'hf-models',
                    'arena-results', 'swebench-results', 'bluesky-author',
                    'external-link',
                })
                self.assertNotRegex(
                    ' '.join(str(source.get(k, '')) for k in ('accessMode', 'sourceAdapter', 'permissionNotes')).lower(),
                    r'\bpaid\b|trial converts|credit card|required subscription',
                )

    def test_reviewed_social_discovery_is_bundled_without_ai_or_media(self):
        sources = {s['id']: s for s in json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))}
        for source_id in ('mastodon-official', 'lemmy-world-technology', 'youtube-nasa'):
            self.assertIn(source_id, sources)
            source = sources[source_id]
            self.assertTrue(source['enabled'])
            self.assertFalse(source['aiAllowed'])
            self.assertFalse(source['mediaAllowed'])
        self.assertEqual(sources['lemmy-world-technology']['storage'], 'metadata')
        self.assertEqual(sources['youtube-nasa']['storage'], 'metadata')

    def test_permissions_are_scoped_to_reviewed_text_and_exact_media(self):
        sources = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
        ai = {s['id'] for s in sources if s['aiAllowed']}
        self.assertEqual(ai, {'nhc-atlantic', 'fed-press_monetary', 'fed-press_all'})
        media = [s for s in sources if s.get('mediaAllowed')]
        self.assertEqual({s['id'] for s in media}, {'nasa-technology', 'mit-news-ai', 'esa-space-engineering', 'fed-feds-notes'})
        for source in sources:
            if source['aiAllowed'] or source.get('mediaAllowed'):
                policy = source['rightsPolicy']
                self.assertEqual(policy['version'], 1)
                self.assertTrue(policy['attribution'])
                self.assertTrue(policy['requiresItemGate'])
        nasa = next(s for s in media if s['id'] == 'nasa-technology')
        approvals = nasa['rightsPolicy']['mediaAllowlist']
        self.assertEqual({a['kind'] for a in approvals}, {'image', 'video'})
        for asset in approvals:
            self.assertEqual(asset['credit'], 'NASA')
            if asset['url'] != 'https://www.nasa.gov/wp-content/uploads/2026/09/lunar-image-reduced.png':
                self.assertEqual(asset['itemGuid'], 'https://www.nasa.gov/?p=1045713')
            self.assertRegex(asset['sha256'], r'^[a-f0-9]{64}$')
            self.assertTrue(asset['evidenceUrl'].startswith('https://www.nasa.gov/'))
        mit = next(s for s in media if s['id'] == 'mit-news-ai')
        self.assertEqual(mit['rightsPolicy']['mediaRule'], 'mit-exact-media-download-v1')
        self.assertEqual(mit['rightsPolicy']['mediaAllowlist'][0]['integrity'], 'size-mime-reviewed-no-hash')
        self.assertNotIn('sha256', mit['rightsPolicy']['mediaAllowlist'][0])
        esa = next(s for s in media if s['id'] == 'esa-space-engineering')
        self.assertEqual(esa['rightsPolicy']['mediaRule'], 'esa-standard-licence-exact-assets-v1')
        self.assertEqual(len(esa['rightsPolicy']['mediaAllowlist']), 2)

    def test_nasa_lunar_concept_pin_does_not_expand_publisher_or_item_scope(self):
        spec = importlib.util.spec_from_file_location('source_check', ROOT / 'scripts/check-v02-sources.py')
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        original = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
        self.assertEqual(checker.validate_catalog(original), [])
        source = next(s for s in original if s['id'] == 'nasa-technology')
        self.assertNotIn('sectionScope', source)
        self.assertFalse(source['aiAllowed'])
        self.assertEqual(len(source['rightsPolicy']['mediaAllowlist']), 3)
        asset = source['rightsPolicy']['mediaAllowlist'][2]
        self.assertEqual(asset['bytes'], 4620791)
        self.assertEqual(asset['sha256'], 'd2775cd0953b366fcf847d1910c3108614d0310ab18e17a26a1d1914d2ea83de')
        self.assertEqual(asset['itemGuid'], 'https://www.nasa.gov/?post_type=press-release&p=1045129')
        self.assertEqual(asset['itemUrl'], 'https://www.nasa.gov/news-release/nasa-calls-for-proposals-to-accelerate-lunar-surface-technologies/')
        self.assertEqual(asset['mime'], 'image/png')
        for key, value in [('url', asset['url'] + '?w=1280'), ('itemGuid', 'https://www.nasa.gov/?p=1045713'),
                           ('itemUrl', 'https://www.nasa.gov/other-story/'), ('bytes', 4620790), ('sha256', '0' * 64),
                           ('credit', 'Third party'), ('caption', 'Photo; NASA endorses this app'),
                           ('mime', 'image/jpeg'), ('evidenceUrl', 'https://www.nasa.gov/')]:
            with self.subTest(field=key):
                changed = copy.deepcopy(original)
                next(s for s in changed if s['id'] == 'nasa-technology')['rightsPolicy']['mediaAllowlist'][2][key] = value
                self.assertTrue(checker.validate_catalog(changed))
        changed = copy.deepcopy(original)
        next(s for s in changed if s['id'] == 'nasa-technology')['sectionScope'] = ['technology']
        self.assertTrue(checker.validate_catalog(changed))

    def test_fed_diagram_catalog_is_exact_and_rejects_nearby_assets(self):
        spec = importlib.util.spec_from_file_location('source_check', ROOT / 'scripts/check-v02-sources.py')
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        original = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
        self.assertEqual(checker.validate_catalog(original), [])
        source = next(s for s in original if s['id'] == 'fed-feds-notes')
        self.assertNotIn('sectionScope', source)
        self.assertEqual(source['kind'], 'official notice')
        self.assertFalse(source['aiAllowed'])
        self.assertEqual(source['rightsPolicy']['mediaRule'], 'fed-exact-diagram-v1')
        self.assertEqual(len(source['rightsPolicy']['mediaAllowlist']), 1)
        asset = source['rightsPolicy']['mediaAllowlist'][0]
        self.assertEqual(asset['mime'], 'image/png')
        self.assertEqual(asset['bytes'], 98752)
        self.assertEqual(asset['sha256'], '56373565c12becc07967821a416196ef2f61b2237dd7444a9840cd04128369aa')
        for key, value in [('url', asset['url'].replace('fig1-', 'fig2-')),
                           ('itemGuid', 'https://www.federalreserve.gov/unrelated'),
                           ('itemUrl', asset['itemUrl'] + '?different=1'),
                           ('sha256', '0' * 64), ('bytes', 98753),
                           ('mime', 'image/jpeg'), ('credit', 'Unreviewed author'),
                           ('evidenceUrl', 'https://www.federalreserve.gov/')]:
            with self.subTest(field=key):
                changed = copy.deepcopy(original)
                next(s for s in changed if s['id'] == 'fed-feds-notes')['rightsPolicy']['mediaAllowlist'][0][key] = value
                self.assertTrue(checker.validate_catalog(changed))

    def test_checker_rejects_duplicate_ids(self):
        checker_path = ROOT / 'scripts/check-v02-sources.py'
        self.assertTrue(checker_path.is_file(), 'catalog checker must exist')
        spec = importlib.util.spec_from_file_location('source_check', checker_path)
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        sources = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
        self.assertEqual(checker.validate_catalog(sources), [])
        sources.append(copy.deepcopy(sources[0]))
        self.assertTrue(any('duplicate id' in e for e in checker.validate_catalog(sources)))

    def test_checker_rejects_permission_scope_regressions(self):
        spec = importlib.util.spec_from_file_location('source_check', ROOT / 'scripts/check-v02-sources.py')
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        original = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
        mutations = [
            ('hacker-news', 'aiAllowed', True),
            ('youtube-nasa', 'storage', 'excerpt'),
            ('lemmy-world-technology', 'mediaAllowed', True),
            ('nhc-atlantic', 'url', 'https://www.nhc.noaa.gov/other.xml'),
            ('mastodon-official', 'refreshMinutes', 1),
            ('nasa-technology', 'rightsPolicy', {}),
            ('fed-press_all', 'rightsPolicy', {'version': 1, 'requiresItemGate': False}),
            ('fed-press_all', 'termsUrl', 'http://www.federalreserve.gov/disclaimer.htm'),
        ]
        for sid, field, value in mutations:
            with self.subTest(source=sid, field=field):
                sources = copy.deepcopy(original)
                next(s for s in sources if s['id'] == sid)[field] = value
                self.assertTrue(checker.validate_catalog(sources), f'{sid}/{field} must fail')

    def test_feed_probe_parser_handles_bom_atom_and_rejects_nonfeeds(self):
        spec = importlib.util.spec_from_file_location('source_check', ROOT / 'scripts/check-v02-sources.py')
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        self.assertTrue(hasattr(checker, 'feed_stats'), 'bounded feed parser must exist')
        rss = b'\xef\xbb\xbf<?xml version="1.0" encoding="utf-8"?><rss><channel><item><title>Board</title><link>https://example.com/a</link></item></channel></rss>'
        self.assertEqual(checker.feed_stats(rss)['items'], 1)
        atom = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Video</title><link href="https://example.com/watch"/></entry></feed>'
        self.assertEqual(checker.feed_stats(atom)['items'], 1)
        for payload in (b'<html>not a feed</html>', b'<!DOCTYPE rss><rss><channel/></rss>', b'<rss>\x00</rss>'):
            with self.assertRaises(ValueError):
                checker.feed_stats(payload)

    def test_probe_cli_exposes_explicit_network_flags(self):
        import subprocess
        result = subprocess.run([__import__('sys').executable, str(ROOT / 'scripts/check-v02-sources.py'), '--help'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn('--probe', result.stdout)
        self.assertIn('--media', result.stdout)

    def test_checker_rejects_substituted_media_asset(self):
        spec = importlib.util.spec_from_file_location('source_check', ROOT / 'scripts/check-v02-sources.py')
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        original = json.loads((ROOT / 'resources/sources.json').read_text(encoding='utf-8'))
        for source_id, replacement in [
            ('nasa-technology', 'https://www.nasa.gov/wp-content/uploads/unreviewed.mp4'),
            ('mit-news-ai', 'https://news.mit.edu/sites/default/files/styles/news_article__cover_image__original/public/images/202609/unreviewed.jpg'),
            ('esa-space-engineering', 'https://www.esa.int/var/esa/storage/images/unreviewed.jpg'),
        ]:
            with self.subTest(source=source_id):
                sources = copy.deepcopy(original)
                asset = next(s for s in sources if s['id'] == source_id)['rightsPolicy']['mediaAllowlist'][0]
                asset['url'] = replacement
                self.assertTrue(checker.validate_catalog(sources), f'{source_id} domain is not an asset license')


if __name__ == '__main__':
    unittest.main()
