# Privacy and data handling

News Terminal is designed for personal local use. No mandatory account or hosted backend is required. Profiles, cached feed entries, saved excerpts and workspace state live in the application's Windows data directory. A local backup contains reading interests and history: store it privately.

The application feed-refresh code contacts only configured sources. Requests necessarily disclose your network address to those services. Publisher terms continue to apply. Saving a story saves only content the configured source permits; it is not a paywall bypass or a guarantee of an offline full article.

AI is optional and on-demand. Zero-paid mode blocks cloud AI providers before execution; local Ollama is the only runtime summary path and still requires explicit consent plus source-level AI permission. Provider API keys belong in Windows Credential Manager, not in backups or logs. Local Ollama runs separately and has its own model/hardware requirements. Free-tier eligibility and billing controls must be checked in your provider account; the app cannot guarantee a third party's current pricing.

Cancel stops the local request; it cannot recall data a provider or local process has already received. AI output can be wrong; check the original linked reporting. OpenRouter model and benchmark panels are metadata-only and do not run inference.

News Terminal adds no application analytics SDK or hosted tracking endpoint. However, the system Microsoft WebView2 runtime is a separate component: native process-tree testing observed external HTTPS sockets even with all feed sources disabled. This is not a zero-network/air-gapped application guarantee; runtime security, diagnostics or other platform behavior is governed by Microsoft and Windows settings. The test did not inspect or attribute packet payloads.

Alerts operate only while News Terminal is running. External article/social links open the system browser and are governed by that site's policies. Bluesky, Reddit and X shortcuts are not account sync, scraping, comment storage or moderation tracking. Source availability and permissions may change.
