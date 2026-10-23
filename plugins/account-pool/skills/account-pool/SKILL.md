---
name: account-pool
description: "Configure or diagnose Account Pooler accounts, authentication, quota routing, and failover through bb pool."
---

# Account Pooler

Use `bb pool` for this plugin's accounts and routes. Inspect current state with
`bb pool status --json` and `bb pool account list --json` before changing routing.
Use `bb pool --help` for available commands.

For account login/import, secret handling, quota refresh, routing settings,
ordering, or failover, read
[references/accounts-and-routing.md](references/accounts-and-routing.md).

Use stdin or supported login/import flows for credentials; never put secret values
in command arguments or chat. Confirm the resulting account and routing state.
Do not enable the plugin or change accounts unless the requested task calls for it.

Pooled rate-limit failures can be retried by Provider Retry using the pool’s
earliest usable account, even if the provider omits structured quota events.
Inspect `bb provider-retry explain <thread-id> --json` for the last decision
and `bb provider-retry status <thread-id> --json` for pending retries.

For titles and commit messages without a local Codex login, Codex routing also
provides the `codex-pool` AI service. Inspect it with
`bb settings ai-services show --json` and test with
`bb settings ai-services test thread-title --json`. Automatic tries bb cloud,
then Account Pooler (Codex), then local Codex. To pin a task, use
`bb settings ai-services set <thread-title|commit-message> codex-pool`.
Turning Codex routing off makes the pool service unavailable. It does not
provide voice transcription.
