"""Real inference smoke test; synthetic/public-domain input is NOT live news."""
from pathlib import Path
import argparse
import json
import time
import urllib.request

LOCAL = Path(__file__).resolve().parents[1] / '.local-ai'
BASE = 'http://127.0.0.1:11434'
MODEL = 'qwen3:4b-instruct-2507-q4_K_M'
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(path, payload=None, timeout=180):
    body = None if payload is None else json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(BASE + path, data=body, headers={'Content-Type': 'application/json'})
    with HTTP.open(req, timeout=timeout) as response:
        return json.load(response)


def pull():
    request = urllib.request.Request(BASE + '/api/pull',
        data=json.dumps({'model': MODEL, 'stream': True}).encode(),
        headers={'Content-Type': 'application/json'})
    previous = None
    with HTTP.open(request, timeout=1200) as response:
        final = {}
        for line in response:
            final = json.loads(line)
            if 'error' in final:
                raise RuntimeError(final['error'])
            marker = (final.get('status'), int(final.get('completed', 0) / max(final.get('total', 1), 1) * 10))
            if marker != previous:
                print(json.dumps(final), flush=True)
                previous = marker
    if final.get('status') != 'success':
        raise RuntimeError('Model pull did not finish successfully')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pull', action='store_true', help='Download the official library model first')
    args = parser.parse_args()
    LOCAL.mkdir(exist_ok=True)
    print(json.dumps(call('/api/version')), flush=True)
    if args.pull:
        pull()
    tags = call('/api/tags')
    model = next(item for item in tags['models'] if item['name'] == MODEL)
    expected_digest = '0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0'
    if model['digest'] != expected_digest:
        raise RuntimeError('Official model tag changed; review provenance before accepting new weights')
    shown = call('/api/show', {'model': MODEL})
    if 'Apache License' not in shown.get('license', ''):
        raise RuntimeError('Expected Apache model license was not returned by local model')
    (LOCAL / 'model-show.json').write_text(json.dumps(shown, ensure_ascii=False, indent=2), encoding='utf-8')
    text = ('SYNTHETIC TEST TEXT, dedicated to the public domain; not real news. '
            'On Monday, the fictional town of Pinebridge opened a free public library. '
            'The library has 1200 books and is open Tuesday through Saturday. '
            'Volunteers will teach free reading classes starting next month. '
            'No opening date for a second branch was announced.')
    cases = [('English', 'Summarize the test text in two concise English sentences.'),
             ('Ukrainian', 'Summarize the test text in two concise Ukrainian sentences.')]
    results = []
    for language, instruction in cases:
        payload = {'model': MODEL, 'stream': False, 'think': False, 'keep_alive': '15m',
                   'prompt': instruction + ' Preserve the facts and do not invent details.\n\n' + text,
                   'options': {'num_ctx': 4096, 'num_predict': 384, 'temperature': 0.7,
                               'top_p': 0.8, 'top_k': 20, 'seed': 42}}
        start = time.perf_counter()
        output = call('/api/generate', payload)
        elapsed = time.perf_counter() - start
        result = {'language': language, 'wall_seconds': elapsed, 'request': payload, 'response': output}
        results.append(result)
        # Retain real responses even when a later case or assertion fails.
        (LOCAL / 'inference-cases.json').write_text(
            json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
        if not output.get('done') or not output.get('response', '').strip():
            raise RuntimeError('Actual model returned no completed summary')
        if output.get('done_reason') == 'length':
            raise RuntimeError('Summary was truncated by the token cap')
        if output.get('thinking') or '<think>' in output['response'] or '</think>' in output['response']:
            raise RuntimeError('Expected a direct instruct summary, not a thinking-model response')
        print(json.dumps({'language': language, 'wall_seconds': elapsed, 'response': output['response'],
                          'eval_count': output.get('eval_count'), 'eval_duration': output.get('eval_duration')},
                         ensure_ascii=True), flush=True)
    evidence = {'label': 'REAL LOCAL INFERENCE ON SYNTHETIC PUBLIC-DOMAIN TEST TEXT; NOT LIVE NEWS',
                'endpoint': BASE, 'version': call('/api/version'), 'model': model,
                'results': results, 'loaded_models': call('/api/ps')}
    destination = LOCAL / 'inference-evidence.json'
    destination.write_text(json.dumps(evidence, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'Evidence saved: {destination}', flush=True)


if __name__ == '__main__':
    main()
