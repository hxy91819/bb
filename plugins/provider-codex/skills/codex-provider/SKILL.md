---
name: codex-provider
description: "Configure named Codex homes in BB and diagnose Codex session controls, model acceptance, and durable goals."
---

# Codex provider

Codex supports structured plan requests, editing and rerunning eligible messages,
and compaction through the corresponding core `bb thread` commands.
`bb thread clear-goal <id>` clears its durable active Goal and waits for provider
confirmation. Inspect the thread before recovery actions.

Unlisted model IDs are accepted by this provider; acceptance does not establish
account access. Inspect models on the actual execution host with
`bb provider models codex` using the machine or environment selector.

Service tiers are `default`, `fast`, and `ultrafast`. Codex reports the tiers
each model accepts for the signed-in account, so the model picker and
`bb provider models codex` (Service tiers column, `supportedServiceTiers` in
`--json`) list Ultrafast only for eligible models and accounts. Pass the id to
`--service-tier` on `bb thread spawn` or `bb thread tell`; bb sends an explicit
tier to Codex as given. When the model does not list it, Codex runs the turn
at its default tier and the thread shows its warning that the tier "is not
advertised as supported" and was omitted.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.

For named home bindings, configure `homeBindings` through `bb plugin config
provider-codex set homeBindings` with a JSON list of `id`, `displayName`, and
`codexHome`. Select `codex-<id>` in provider and thread commands. Paths resolve
on the execution machine; use the binding's health result for its login command.
Bindings use file authentication and preserve existing auth symlinks. They bypass
Account Pooler. Removing a binding preserves its threads; restore the same ID
and home to resume. Use a new ID when changing the home. Prepare file login with
`CODEX_HOME=<home> codex -c 'cli_auth_credentials_store="file"' login`.
