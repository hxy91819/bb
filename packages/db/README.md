# @bb/db

## Migration Workflow

Schema changes must be checked in as generated SQL migrations:

```sh
pnpm --filter @bb/db db:generate
```

Review the generated SQL before committing it. `db:push` is intentionally not
exposed for this package because it mutates the target database directly and can
hide migration drift in persistent BB data directories.

Local aggregates may have applied the Fast and Recent activity columns before
the stable release's machine-provider migration. Startup replays that skipped
machine migration and preserves existing activity values while applying the
regenerated Recent migration. Its temporary column is recovered on retry if
startup was interrupted. Keep the original migration ledger; exercise upgrades
on a database copy before deploying against an existing data directory.
