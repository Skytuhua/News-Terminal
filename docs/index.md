# News Terminal documentation

Start with the [Windows quick start](../README.md#start-on-windows) for installation and the [reading tools and shortcuts](../README.md#reading-tools) for daily use. Downloads are unsigned Windows x64 development builds; no tagged release is published yet.

## Reader reference

| Task | Where to look |
| --- | --- |
| Narrow a headline list | **More filters** combines publisher and publication age with search, content type and read status. Bounded ranges use publisher dates and exclude undated stories. |
| Triage a page | **Select this page** selects up to 100 visible stories without marking them read. **Invert selection** switches to the other stories on that page. Bulk actions include read/unread, save/unsave and hide. Page/filter changes clear selection. |
| Recover a hidden story | [Hidden stories and source health](v04-guide.md#recover-hidden-stories) |
| Understand saved content and backups | [Privacy and data handling](privacy.md) |
| Connect Ollama, LM Studio or llama.cpp | [Optional local AI](local-ai.md) |
| Inspect feed coverage and permissions | [Source catalog](sources.md) and [source policy](source-policy.md) |

Versioned guides record the behavior and evidence available when written. For current setup, local AI and distribution details, use the pages above; older catalog counts and installation notes are historical.

## Development

| Reference | Contents |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | Setup, useful checks, issue and pull-request guidance |
| [Development and verification](development.md) | Architecture, browser harness, native smoke commands and data bounds |
| [IPC contract](IPC-CONTRACT.md) | Frontend/host operations, revisions and replacement protections |
| [Product principles](../PRODUCT.md) and [design system](../DESIGN.md) | Reading workflow, layout, accessibility and interaction expectations |
| [Source policy](source-policy.md) | Independent access, storage, media and AI permissions |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Dependency and installer notices |

## Windows builds and evidence

- [Successful main-branch Windows builds](https://github.com/Skytuhua/News-Terminal/actions/workflows/ci.yml?query=branch%3Amain+is%3Asuccess): open a run and download `news-terminal-windows-unsigned` under Artifacts. GitHub sign-in is required and artifacts expire.
- [Installer payload verification](installer-payload.md): setup/portable requirements and release-owner checks.
- [Windows installation acceptance](windows-install-acceptance.md): installation scenarios and evidence requirements.
- [Native acceptance and evidence limits](v05-native-acceptance.md): historical native checks, fixture qualifications and reproduction commands.

A successful build or browser fixture run does not prove current native installation, multi-monitor behavior or live inference. Match evidence to the revision and environment tested.
