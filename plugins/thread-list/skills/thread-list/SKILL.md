---
name: thread-list
description: "Inspect or change the sidebar thread list's layout preferences: organization mode, sort, section order, hidden groups, and collapsed groups."
---

# Thread list preferences

The Thread list plugin owns the sidebar's layout state. Read it with
`bb thread-list prefs list --json`; keys are `showProviderIcons`, `threadLifecycles`, `organizationMode`,
`environmentGrouping`, `chronologicalSort`, `dateGrouping`, `sortDirection`, `sectionOrder`,
`manualSectionOrder`, `machineSectionOrder`, `hiddenGroups` (including the
built-in `threads` group),
`collapsedSections`, `collapsedProjects`, `collapsedThreads`,
`collapsedEnvironments`, `collapsedThreadSections`, and `collapsedMachines`.

```sh
bb thread-list prefs list [--json]
bb thread-list prefs get <key> [--json]
bb thread-list prefs set <key> <value> [--json]
bb thread-list prefs reset <key> [--json]
```

`set` takes JSON; a bare word is read as a string, so
`bb thread-list prefs set organizationMode machine` and
`bb thread-list prefs set manualSectionOrder '["pinned","sections","threads"]'`
both work. A value the key's schema rejects fails with
`invalid_preference_value` and leaves the stored value alone. Every open
window applies a change immediately. Sections themselves and a thread's
section are bb core state: use `bb thread section` and `bb thread update`.

On first load the plugin copies any non-default `sidebar.*` values from
`bb settings ui` once; after that the two are independent.

The header's Filter menu selects Active, Archived, or both; at least one must
remain selected. `bb thread-list prefs set threadLifecycles '["archived"]'`
shows archived threads, and `'["active","archived"]'` shows both. The default
is `'["active"]'`. Archived results load in pages; use Show more at the end
of the list. The same preference is available through `setPreference` RPC.

Organize → Rows → Provider icons toggles the icon before each thread title.
`showProviderIcons` defaults to `false`; use
`bb thread-list prefs set showProviderIcons true` to show them. Unknown
provider ids have no icon.

## Date groups

`dateGrouping` defaults to `true`. Organize → Rows → Date groups toggles it;
`bb thread-list prefs set dateGrouping false` or `setPreference` RPC does the same.
It only groups root entries in Custom's built-in Threads section. Pinned,
custom sections, By project, and By machine are unchanged. Alphabetical sorting
disables the toggle and hides date groups without changing the saved preference.

Updated sorting uses `updatedAt`; Created sorting uses `createdAt`. Buckets use
local calendar days: Today, Yesterday, localized full weekday names for 2–6 days
ago, Previous 30 days for 7–29 days ago, then localized full month and numeric
year (for example, September 2026). Nested children and worktree siblings stay
with their root thread or environment representative's date. Archived threads
share the same buckets when included by Filter. Headings are display-only, not
collapsible, draggable, or keyboard jump targets; there are no priority or
needs-input buckets. Dates refresh at local midnight and on window focus.
