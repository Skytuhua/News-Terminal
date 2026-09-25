# Live metadata fixtures and review scope

These are reduced, unauthenticated responses retrieved during this implementation, not invented endpoint schemas. Only row selection/envelope counts were changed as described below; tests explicitly mutate fields to exercise failure cases.

- `openrouter.json`: first two actual rows from `https://openrouter.ai/api/v1/models?output_modalities=all&limit=500&offset=0`; fixture `total_count` changed to 2 and terminal link set to null. Actual first page: 500 of 625, next offset 500; 762,788 bytes. Metadata only, no inference or keys.
- `hf.json`: full two-row response from `https://huggingface.co/api/models?author=Qwen&sort=createdAt&direction=-1&limit=2&full=true&cardData=true`. Organization mapping verified against `https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md`, which links explicitly to `https://huggingface.co/Qwen`. Production discovery is the newest 50 public repositories, not an organization archive or launch-date feed. Individual model licenses are metadata, not blanket permission to download/use weights.
- `arena.json`: two actual rows and original feature/total envelope from `https://datasets-server.huggingface.co/rows?dataset=lmarena-ai/leaderboard-dataset&config=text&split=latest&offset=0&length=2`. Attribution: Arena / LMArena leaderboard dataset, **CC BY 4.0**. Dataset license verified directly in `https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/raw/main/README.md` (`license: cc-by-4.0`). License: https://creativecommons.org/licenses/by/4.0/ . Row `license` is the model's license, not the dataset license. Modifications: excerpt selection and JSON formatting; numeric scores unchanged. Production reads bounded complete text/latest pages, then selects overall. The Viewer /filter endpoint was tested but returned HTTP 500/timeouts, so it is not used.
- `swe.json`: first two actual results from the `Verified` member of the official `leaderboards` array at `https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/data/leaderboards.json`. Attribution: SWE-bench website/data contributors, **CC BY-NC 4.0**, personal/noncommercial use. License verified directly at `https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/LICENSE`; this is NOT the evaluation code's MIT license. Modifications: selected Verified split and two results, JSON formatting; scores unchanged. Actual artifact: 4,091,442 bytes, 180 Verified submissions; `resolved: 79.2` is percentage points, not 0.792 or a fraction. `Verified` identifies the benchmark split and does not imply that an individual `checked: false` submission has been checked.

Repeat the real production HTTP/parser/cache/dispatch path with:

```
cargo test --manifest-path src-tauri/Cargo.toml --test metadata_live -- --ignored --nocapture
```

The test uses a temporary isolated SQLite database, GET-only public endpoints, checks source status/counts, and reopens the database to test cache persistence. It does not use the user's app database or credentials. Deterministic suites run without network; this opt-in live suite can fail on genuine upstream availability/schema changes.
