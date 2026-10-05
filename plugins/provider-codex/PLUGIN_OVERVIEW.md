Start a thread, pick Codex, and let it write and review code in your repository from bb. The plugin drives the Codex CLI on the host machine. It streams the agent's work into the bb timeline.

## What you get

- Permission modes `accept-edits`, `auto`, and `full`, plus plan and goal actions in the composer.
- Reasoning levels from Low to Ultra. Ultra adds automatic task delegation.
- A service tier picker that offers the tiers Codex reports for the selected model (Fast, and Ultrafast where the account has it).
- Checkpoint forks, manual compaction, thread rename, and thread archive.
- Codex skills from your home directory and project, listed next to bb skills.
- Health, usage, and install status on each host, with an install or update action.
- A Codex AI service for inference and voice that other bb features can use.

## Settings

- `Codex memory`: let Codex recall and create memories from bb threads.
- `Disable provider subagents`: stop native subagents so the agent delegates through bb.
- `Codex home bindings`: a JSON list of named Codex homes. Each adds a native provider with its own login, models, usage and skills.

## Requirements

- Install the Codex CLI (`codex`) on the host machine, version 0.136.0 or newer. The plugin can run the npm install for you.
- Sign in with `codex login` on that machine. A ChatGPT account or an OpenAI API key both work.
- Usage limits show only for ChatGPT accounts.

## Named Codex homes

Set `homeBindings` in the plugin settings, through the SDK plugin settings methods, or with:

```sh
bb plugin config provider-codex set homeBindings '[{"id":"work","displayName":"Work","codexHome":"~/.codex-work"}]'
bb provider models codex-work
bb thread spawn --provider codex-work --prompt 'Inspect this repository'
```

Paths are absolute or begin with `~/` and resolve on the execution machine. The local `codex` CLI launches with that home; a binding does not choose a separate executable. Prepare file authentication with `CODEX_HOME="$HOME/.codex-work" codex -c 'cli_auth_credentials_store="file"' login`. Existing file logins, including `auth.json` symlinks, are reused. BB does not copy or write authentication files; Codex owns token refresh.

A binding ID stays associated with its original directory expression, including after removal and plugin reload. Rename the display label freely; use a new ID for a different directory. Removing a binding preserves threads and Codex data; restore the same binding to continue. Fork and Side chat inherit the selected binding. Switching identities requires a new thread.

Model queries for bindings check the executing host each time. When the home is logged into another account or its shared authentication file changes, the next model query replaces the old model connection; refresh usage to read the current account's limits.

Fixed home bindings bypass Account Pooler and inherited pool routing. Default `codex` and the Codex AI service retain their current account selection. Homes are prepared separately on each execution machine; an unavailable login never falls back to another account. Concurrent token refresh retains Codex's existing shared-file behavior.
