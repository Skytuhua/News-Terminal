# Optional local AI for News Terminal (Windows x64)

AI is optional and summaries are requested explicitly. News Terminal supports
Ollama and an optional local OpenAI-compatible server such as LM Studio or
llama.cpp. The application blocks cloud provider kinds in zero-paid mode.

## Connect an existing LM Studio or llama.cpp server

In **Settings > AI providers > Local OpenAI-compatible**, enter the exact model
identifier configured in your server and its API base URL. For LM Studio, a
common base is `http://127.0.0.1:1234/v1`. For llama.cpp, use the port you set
when starting the server, for example `http://127.0.0.1:8080/v1` when you used
`--port 8080`. The server and model must already be available.

The accepted base is HTTP with `127.0.0.1`, `[::1]`, or `localhost`, an explicit
non-default port (1 through 65535, excluding port 80), and `/v1`. A trailing slash
is accepted. `localhost` is normalized to `127.0.0.1` before connecting, so it
does not rely on DNS. Credentials in URLs, query strings, fragments, LAN hosts,
cloud URLs and alternate API paths are rejected. Authenticated local servers
are not supported by this adapter; no API key is loaded or saved for it.

The form starts disabled and without consent. Choose **Enabled**, give consent
to sending permitted excerpts, and save. Saving only stores configuration and
does not contact the server. Editing the endpoint or model clears the form's
consent checkbox. Summaries still require a separate Generate action and the
existing source and item permissions. If both local providers are enabled and
consented, fallback tries Ollama before the compatible server.

**Local transport does not establish local execution.** Ollama can use cloud
models through localhost, and LM Studio LM Link can send localhost requests to
a preferred remote device. Disable Ollama cloud features (`OLLAMA_NO_CLOUD=1`,
with a runtime restart), LM Link and other remote delegation in the runtime you
choose. News Terminal does not inspect or attest the server process. Ollama's
native adapter checks the selected `/api/tags` entry and rejects known remote
metadata before sending excerpts, but trusts the server's metadata. Both local
adapters also reject model identifiers containing `cloud`, preserving the
existing conservative guard against explicit cloud model tags.

The compatible adapter sends plain-text messages to `/v1/chat/completions` with
`stream:false` and an output cap of 512 tokens for article summaries or 1024
tokens for sector quotations. It does not invoke tools, fetch article URLs,
install models or manage the runtime. Sector results still select host-created
quotation candidates and are validated against the supplied source inputs.
Requests use no proxies or redirects, a 5-second connection timeout and a
15-second HTTP deadline; the existing summary operation also has attempt and
overall limits. Responses are bounded to 64 KiB, and malformed, tool, refusal,
empty or incomplete compatible responses are rejected. Cancel discards the
pending result; immediate cancellation of the server's computation is not
guaranteed. A cold or busy model may time out. Originals remain readable.

Backups contain only the local endpoint, model and public provider settings.
Import disables providers and resets consent. Old backups without the optional
compatible provider remain accepted; backups containing it require this version
or a newer compatible host. Never put runtime credentials in provider fields.

References, checked 18 October 2026:
[LM Studio chat API](https://lmstudio.ai/docs/developer/openai-compat/chat-completions),
[LM Link routing](https://lmstudio.ai/docs/developer/core/lmlink),
[llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
[Ollama cloud configuration](https://docs.ollama.com/faq).

## Existing isolated Ollama setup

The following records the previously verified local inference setup. Its scripts
do not install a service, modify startup or global PATH/environment, or change
application settings. The application owner selects the Ollama provider/model
separately or uses the existing **Use local AI** action.

## Exact configuration

- API base: `http://127.0.0.1:11434`
- Model: **`qwen3:4b-instruct-2507-q4_K_M`** (Qwen3-4B-Instruct-2507, 4.0B parameters, GGUF Q4_K_M).
- Runtime: official **Ollama 0.34.3**, Windows AMD64 standalone ZIP.
- Model store: `<repo>/.local-ai/models`; runtime: `<repo>/.local-ai/ollama-0.34.3/ollama.exe`.
- Process-local settings: loopback only; `OLLAMA_NO_CLOUD=1`; context 4096; one parallel request; one loaded model; 15-minute model keepalive. NVIDIA acceleration; Vulkan/integrated GPU disabled for this tested machine.
- Runtime profile, temporary files, logs, and any automatically generated runtime identity stay under `.local-ai/`. The launcher constructs a minimal non-secret environment rather than inheriting API credentials. No API key is required, inspected, or saved by these scripts.

**Use the exact instruct tag, not `qwen3:4b`.** The current official `4b` alias points to the thinking-only 2507 model. That alias spent the token budget reasoning despite `think:false`; switching to the official instruct variant resolved this. The unused thinking model was removed from the isolated store. No weights or prompt templates were modified.

## Run

From the repository root with Python 3.11+ available:

```bash
# One-time download, SHA-256 verification and extraction (no installer):
python scripts/local-ai-setup.py

# Keep this process running while using AI; Ctrl+C stops it:
python scripts/local-ai-run.py

# In another terminal: first-time model download plus real inference tests:
python scripts/local-ai-verify.py --pull

# Subsequent verification, no model download:
python scripts/local-ai-verify.py
```

The launcher refuses to replace any process already listening on port 11434. It records its child PID and executable in `.local-ai/server-process.json`. When managed by Hermes, stop the specific launcher session with `process_manage(action="kill", session_id=...)`; do not kill unrelated Ollama processes. A future restart updates the PID record. There is no boot/login autostart.

Supported/tested API paths: `GET /api/version`, `GET /api/tags`, `POST /api/show`, `POST /api/pull`, `POST /api/generate`, and `GET /api/ps`. `/api/chat` is also available; the committed verification script uses `/api/generate` with `stream:false`, `think:false`, a 384-token output cap, and a fixed seed. No fixture response is substituted on error.

## Verified hardware and sizes

Test host: AMD Ryzen AI 9 HX 370, 12 cores / 24 logical processors; 33,412,722,688 bytes RAM (31.118 GiB). NVIDIA RTX 4060 Laptop GPU: 8,188 MiB VRAM per `nvidia-smi`. AMD Radeon 890M is also present. Do not rely on the 32-bit WMI `AdapterRAM` value for an 8 GiB card.

- Official runtime ZIP: **1,460,962,639 bytes**.
- Extracted runtime files: **1,929,045,302 bytes**.
- Installed instruct model as reported by `/api/tags`: **2,497,293,803 bytes**.
- Weight blob: **2,497,280,480 bytes**.
- Model manifest digest: `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`.
- Weight digest: `85e4a5b7b8ef0e48af0e8658f5aaab9c2324c76c1641493f4d1e25fce54b18b9`.
- `/api/ps` reported **3,178,149,969 bytes loaded, all in VRAM**, at 4096 context.
- `.local-ai/` is roughly 5.94 GB including the retained ZIP, runtime, model, temporary files and evidence. Logs/temp may grow. It is separate from the lightweight executable.

## Actual inference evidence

Synthetic text was explicitly labelled **public-domain test text, not real news**: the fictional town of Pinebridge opened a free library Monday; it has 1200 books, is open Tuesday–Saturday, offers volunteer reading classes next month, and has not announced a second-branch opening date.

Actual English output:

> On Monday, Pinebridge opened a free public library with 1200 books, open Tuesday through Saturday. Volunteers will start teaching free reading classes next month, and no opening date for a second branch was announced.

Observed first-load English latency: **2.927 s**. A recorded warm run: **0.852 s**, 45 generated tokens, **72.66 tokens/s**. A Ukrainian request also completed locally in **1.577 s**, 114 tokens, **75.45 tokens/s**. Both returned `done:true`, `done_reason:"stop"`, without thinking text. Latencies are measurements for these tiny inputs, not performance guarantees.

**Quality limitation:** This is an inference/transport smoke test, not an accuracy certification. The English summary preserved the supplied facts. Ukrainian outputs were grammatically weak and sometimes mistranslated “branch” as “gallery”; an earlier sample also changed Tuesday to Monday. Do not present multilingual factual accuracy as verified. Keep source articles visible and review important facts; lower temperature alone did not eliminate translation defects.

Local evidence files (not bundled):

- `.local-ai/runtime-provenance.json`: source archive, digest, exact sizes.
- `.local-ai/inference-evidence.json`: requests, actual responses, timings, installed and loaded model metadata.
- `.local-ai/inference-cases.json`: incremental responses, retained even if a later assertion fails.
- `.local-ai/model-show.json`: model details/template/license returned by the local API.
- `.local-ai/server-process.json` and `.local-ai/server.log`: process identity and runtime diagnostics.

## Provenance and licensing

- [Official portable Windows instructions](https://docs.ollama.com/windows)
- [Ollama v0.34.3 release](https://github.com/ollama/ollama/releases/tag/v0.34.3)
- [Pinned official ZIP](https://github.com/ollama/ollama/releases/download/v0.34.3/ollama-windows-amd64.zip)
- ZIP SHA-256, verified against GitHub release asset metadata: `306ce9e81e3491d147f558e60d7a389499f244d10f71859c6e4e899241d1b4ae`.
- [Ollama source license: MIT](https://github.com/ollama/ollama/blob/v0.34.3/LICENSE).
- [Official Ollama model tag](https://ollama.com/library/qwen3:4b-instruct-2507-q4_K_M)
- [Qwen upstream model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
- [Qwen model license: Apache-2.0](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/blob/main/LICENSE), also verified in `/api/show`.

Copies are retained under `.local-ai/licenses/`. The standalone ZIP also retains its bundled third-party license/notice files, including NVIDIA cuDNN/CUTLASS/NVTX and llama.cpp notices; do not characterize all GPU dependencies as MIT or redistribute them without reviewing their terms.

## Repository and packaging boundary

The original runtime setup created only `scripts/local-ai*`, `docs/local-ai*`,
and machine-local `.local-ai/`. `.local-ai/.gitignore` contains `*`, and
`git check-ignore` verified runtime/model artifacts and the nested ignore file
itself are ignored. The optional application adapter described above is separate
from this retained runtime and model evidence; its fixture tests do not establish
live inference or hardware performance for LM Studio or llama.cpp.

The inspected Tauri bundle configuration uses an explicit resource allowlist (`resources/installer-notices`, `resources/licenses`, and `THIRD_PARTY_NOTICES.md`) and frontend `dist`; `.local-ai/` is not included. Do not add this directory to bundle resources or copy it into `dist`. A final installer/executable payload check belongs to the release owner.
