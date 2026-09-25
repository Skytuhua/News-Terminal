#!/usr/bin/env python3
"""Live NASA -> unchanged Rust loader -> Chromium data-URL playback evidence.

Run from any directory: python scripts/v02-media-probe.py
Requires Cargo, Node and the repository's installed Playwright Chromium.
No app/frontend/catalog edits, external players, transcoding, or MIME overrides.
Writes only the owned evidence JSON, ignored .hermes/backups/v02-video.mp4,
and a first-frame PNG in the OS temporary directory. Network failure fails the run.
"""
import datetime
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/evidence/v02-media-live.json"
PAGE = "https://svs.gsfc.nasa.gov/4709/"
HELP = "https://svs.gsfc.nasa.gov/help/"
VIDEO = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004709/orbit_720p30.mp4"
CREDIT = "NASA's Scientific Visualization Studio"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError(f"Unexpected HTTP redirect for fixed NASA resource: {code}")


def request(url, method="GET"):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(urllib.request.Request(url, method=method), timeout=30) as response:
        assert response.status == 200
        body = response.read(2 * 1024 * 1024 + 1) if method == "GET" else b""
        assert len(body) <= 2 * 1024 * 1024, "metadata document too large"
        return body, dict(response.headers.items())


def run(command, **kwargs):
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", **kwargs)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {command[0]}\n"
                           f"{result.stdout}\n{result.stderr}")
    return result


BROWSER_PROBE = r"""
const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
(async () => {
  const artifact = process.env.V02_VIDEO;
  const bytes = fs.readFileSync(artifact);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== process.env.V02_SHA256) throw new Error('Not the Rust loader bytes');
  const csp = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>NASA live loader verification</title>
  <style>body{margin:24px;background:#111;color:#eee;font:18px sans-serif}video{display:block;width:960px;height:540px;background:black}p{margin:12px 0}</style></head>
  <body><h1>The Moon's Rotation — actual NASA MP4</h1><video controls muted playsinline preload="auto"></video>
  <p>Credit: NASA's Scientific Visualization Studio</p><p>Source: https://svs.gsfc.nasa.gov/4709/</p>
  <p>Decoded bytes returned by production Rust media::load_media. No endorsement implied.</p></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp});
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage({viewport:{width:1040,height:790}});
    const browserErrors = [], requests = [];
    page.on('pageerror', e => browserErrors.push(String(e)));
    page.on('request', r => { if (!r.url().startsWith('data:')) requests.push(r.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(dataUrl => {
      const video = document.querySelector('video');
      window.mediaEvents = [];
      for (const event of ['loadedmetadata','loadeddata','playing','ended','error'])
        video.addEventListener(event, () => window.mediaEvents.push({event,currentTime:video.currentTime}));
      video.src = dataUrl;
      video.load();
    }, 'data:video/mp4;base64,' + bytes.toString('base64'));
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      if (v.error) throw Error(`decoder error ${v.error.code}: ${v.error.message}`);
      return v.readyState >= 2 && v.videoWidth > 0;
    }, null, {timeout:30000});
    const firstFrame = await page.evaluate(() => {
      const v = document.querySelector('video');
      const c = document.createElement('canvas'); c.width=160; c.height=90;
      const ctx = c.getContext('2d'); ctx.drawImage(v,0,0,160,90);
      const pixels = ctx.getImageData(0,0,160,90).data;
      const colors = new Set();
      for (let i=0;i<pixels.length;i+=4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
      return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,readyState:v.readyState,
        currentTime:v.currentTime,uniqueRgbColors:colors.size,
        totalVideoFrames:v.getVideoPlaybackQuality().totalVideoFrames,error:v.error};
    });
    if (!(firstFrame.duration > 10 && firstFrame.width === 1280 && firstFrame.height === 720
          && firstFrame.uniqueRgbColors > 50 && !firstFrame.error))
      throw Error(`No genuine decoded video frame: ${JSON.stringify(firstFrame)}`);
    const screenshot = path.join(process.env.V02_SCREENSHOT_DIR, 'first-frame.png');
    await page.screenshot({path:screenshot,fullPage:true});
    await page.evaluate(async () => {
      const v=document.querySelector('video');
      window.presentedFrames=0;
      const count=()=>{window.presentedFrames++;v.requestVideoFrameCallback(count);};
      v.requestVideoFrameCallback(count);
      await v.play();
    });
    await page.waitForFunction(() => document.querySelector('video').currentTime >= 2,
      null,{timeout:10000});
    const normalPlayback = await page.evaluate(() => {
      const v=document.querySelector('video');
      return {currentTime:v.currentTime,paused:v.paused,readyState:v.readyState,
        presentedFrames:window.presentedFrames,totalVideoFrames:v.getVideoPlaybackQuality().totalVideoFrames};
    });
    if (normalPlayback.paused || normalPlayback.presentedFrames < 20 || normalPlayback.readyState < 2)
      throw Error(`Playback did not advance: ${JSON.stringify(normalPlayback)}`);
    await page.evaluate(() => { document.querySelector('video').playbackRate=4; });
    await page.waitForFunction(() => {
      const v=document.querySelector('video');
      if(v.error) throw Error(`late decoder error ${v.error.code}: ${v.error.message}`);
      return v.ended;
    },null,{timeout:60000});
    const complete = await page.evaluate(() => {
      const v=document.querySelector('video'), q=v.getVideoPlaybackQuality();
      return {ended:v.ended,currentTime:v.currentTime,duration:v.duration,readyState:v.readyState,
        totalVideoFrames:q.totalVideoFrames,droppedVideoFrames:q.droppedVideoFrames,
        presentedFrames:window.presentedFrames,error:v.error,events:window.mediaEvents};
    });
    if (!complete.ended || Math.abs(complete.currentTime-complete.duration)>0.1
        || complete.totalVideoFrames<100 || browserErrors.length)
      throw Error('Complete playback checks failed');
    if(requests.some(u => !u.startsWith(`http://127.0.0.1:${server.address().port}/`)))
      throw Error('Browser unexpectedly requested remote media');
    console.log('V02_BROWSER='+JSON.stringify({engine:'Playwright Chromium',version:browser.version(),
      platform:process.platform,delivery:'data:video/mp4;base64 from exact Rust-exported bytes',
      sha256,csp,firstFrame,normalPlayback,complete,browserErrors,requests,
      screenshot,screenshotSha256:crypto.createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex')}));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode=1; });
"""


def main():
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    # Metadata-only preflight. The video body is fetched ONLY by production Rust.
    page_bytes, _ = request(PAGE)
    help_bytes, _ = request(HELP)
    page_text = html.unescape(re.sub(r"<[^>]+>", " ", page_bytes.decode()))
    help_text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", help_bytes.decode())).split())
    assert CREDIT in page_text and "/vis/a000000/a004700/a004709/orbit_720p30.mp4" in page_bytes.decode()
    permission_quote = "All of our content is in the public domain (unless otherwise noted), meaning that it is free to download, use, and redistribute for whatever purposes you see fit."
    assert permission_quote in help_text, "NASA usage guidance changed; review manually"
    _, headers = request(VIDEO, "HEAD")
    normalized = {k.lower(): v for k, v in headers.items()}
    assert normalized["content-type"].split(";")[0].strip() == "video/mp4"
    assert 100_000 < int(normalized["content-length"]) <= 32 * 1024 * 1024
    cargo_command = ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--test",
                     "v02_media_live", "--", "--ignored", "--nocapture"]
    cargo = run(cargo_command, env={**os.environ, "NEWS_TERMINAL_MEDIA_LIVE": "1"}, timeout=600)
    marker = next(line.removeprefix("V02_MEDIA_LIVE=") for line in cargo.stdout.splitlines()
                  if line.startswith("V02_MEDIA_LIVE="))
    loader = json.loads(marker)
    artifact = ROOT / loader["videoArtifact"]
    assert artifact.stat().st_size == loader["video"]["bytes"] == int(normalized["content-length"])
    assert hashlib.sha256(artifact.read_bytes()).hexdigest() == loader["video"]["sha256"]
    screenshot_dir = tempfile.mkdtemp(prefix="news-terminal-v02-media-")
    browser = run(["node", "-e", BROWSER_PROBE], timeout=120, env={**os.environ,
        "V02_VIDEO": str(artifact), "V02_SHA256": loader["video"]["sha256"],
        "V02_SCREENSHOT_DIR": screenshot_dir})
    playback = json.loads(next(line.removeprefix("V02_BROWSER=") for line in browser.stdout.splitlines()
                               if line.startswith("V02_BROWSER=")))
    evidence = {
        "schemaVersion": 1, "startedAt": started,
        "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "passed": True, "reproduce": "python scripts/v02-media-probe.py",
        "source": {"page": PAGE, "title": "The Moon's Rotation", "credit": CREDIT,
                   "pageSha256": hashlib.sha256(page_bytes).hexdigest(),
                   "permissionUrl": HELP, "permissionQuote": permission_quote,
                   "permissionPageSha256": hashlib.sha256(help_bytes).hexdigest(),
                   "mediaGuidelines": "https://www.nasa.gov/nasa-brand-center/images-and-media/",
                   "rightsReview": "NASA SVS visualization, NASA/JPL DE421 data. Item-specific credit is NASA SVS; no separately licensed music or third-party media exception was identified on the item page. Informational test with attribution; no endorsement implied."},
        "head": {"status": 200, "url": VIDEO, "headers": headers},
        "rust": {"command": cargo_command, "env": {"NEWS_TERMINAL_MEDIA_LIVE": "1"},
                 "exitCode": cargo.returncode, "stdout": cargo.stdout, "stderr": cargo.stderr,
                 "loader": "news_terminal_lib::media::load_media", "result": loader},
        "browser": playback,
        "boundaries": [
            "This proves unchanged production Rust loader -> exact exported bytes -> Chromium decoding and complete playback, not the application UI or WebView2 itself.",
            "No source-catalog permission, article ingestion, host trusted-source gate, or application frontend was changed or bypassed in production; the ignored test invokes the loader directly with the fixed, reviewed NASA item.",
            "First 2 seconds play at normal speed, then remaining clip at 4x until ended. No transcoding, MIME relaxation, replacement download, synthetic container, or remote browser media request.",
            "Video artifact is ignored .hermes/backups/v02-video.mp4; screenshot is an OS-temp local artifact and is not distributed with the repository.",
            "Image is separately fetched by the production loader from the same NASA item; browser playback assertions apply to video only.",
            "Live URLs and rights notices can change; rerun explicitly and review rights before reusing a different item."
        ]
    }
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": True, "evidence": str(EVIDENCE), "video": loader["video"],
                      "firstFrame": playback["firstFrame"], "normalPlayback": playback["normalPlayback"],
                      "complete": playback["complete"], "screenshot": playback["screenshot"]}, indent=2))


if __name__ == "__main__":
    main()
