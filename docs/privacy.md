# Privacy and data handling

News Terminal is designed for personal local use. No mandatory account or hosted backend is required. Profiles, cached feed entries, saved excerpts and workspace state live in the application's Windows data directory. A local backup contains reading interests and history: store it privately.

Native backup files preserve cached excerpts, revision history, profile reading
state and alert receipts in JSON. Large files are processed locally without
loading their contents into the Settings page. Restore validates a temporary
local copy before replacing the database, resets AI and automatic-image consent,
and excludes credentials and private permission receipts.

The application feed-refresh code contacts only configured sources. Requests necessarily disclose your network address to those services. Publisher terms continue to apply. Saving a story saves only content the configured source permits; it is not a paywall bypass or a guarantee of an offline full article.

AI is optional and on-demand. Zero-paid mode blocks cloud provider kinds before execution. Summaries support Ollama and an OpenAI-compatible local server, with explicit consent plus source-level AI permission. These runtimes and their models run separately and have their own hardware requirements. A loopback connection does not establish local inference: configure the runtime to disable cloud models or remote delegation. See [local AI setup and limitations](local-ai.md). Provider API keys belong in Windows Credential Manager, not in backups or logs; the local compatible adapter does not support API keys.

Cancel stops the local request; it cannot recall data a provider or local process has already received. AI output can be wrong; check the original linked reporting. OpenRouter model and benchmark panels are metadata-only and do not run inference.

News Terminal adds no application analytics SDK or hosted tracking endpoint. However, the system Microsoft WebView2 runtime is a separate component: native process-tree testing observed external HTTPS sockets even with all feed sources disabled. This is not a zero-network/air-gapped application guarantee; runtime security, diagnostics or other platform behavior is governed by Microsoft and Windows settings. The test did not inspect or attribute packet payloads.

Alerts operate only while News Terminal is running. External article/social links open the system browser and are governed by that site's policies. Bluesky, Reddit and X shortcuts are not account sync, scraping, comment storage or moderation tracking. Source availability and permissions may change.
