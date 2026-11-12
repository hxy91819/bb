import type { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import type { ExperimentalThreadActivityArgs } from "@bb/sdk";

interface ActivityOptions {
  plugin: string;
  key: string;
  equals: string;
  from: string;
  to: string;
  thread?: string;
  project?: string;
  limit?: string;
  cursor?: string;
  json?: boolean;
}
export function registerActivityCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("experimental-activity")
    .description(
      "Query retained activity facts by plugin metadata and UTC range; compact JSON is bounded to 256 KiB",
    )
    .requiredOption("--plugin <id>", "Metadata namespace")
    .requiredOption("--key <key>", "Exact top-level metadata key")
    .requiredOption("--equals <json>", "JSON scalar, including quoted strings")
    .requiredOption("--from <ms>", "Inclusive UTC timestamp in milliseconds")
    .requiredOption("--to <ms>", "Exclusive UTC timestamp in milliseconds")
    .option(
      "--thread <id>",
      "Details for this thread; omitted queries summaries",
    )
    .option("--project <id>", "Restrict to a public project")
    .option("--limit <n>", "Page size, default 20, maximum 100")
    .option(
      "--cursor <cursor>",
      "Continue from an item cursorAfter or nextCursor",
    )
    .option("--json", "Print compact machine-readable JSON (also the default)")
    .action(
      action(async (opts: ActivityOptions) => {
        const equals: unknown = JSON.parse(opts.equals);
        if (
          equals !== null &&
          typeof equals !== "string" &&
          typeof equals !== "number" &&
          typeof equals !== "boolean"
        ) {
          throw new Error("--equals must be a JSON scalar");
        }
        const fields = {
          metadata: { pluginId: opts.plugin, key: opts.key, equals },
          from: Number(opts.from),
          to: Number(opts.to),
          ...(opts.project === undefined ? {} : { projectId: opts.project }),
          ...(opts.limit === undefined ? {} : { limit: Number(opts.limit) }),
          ...(opts.cursor === undefined ? {} : { cursor: opts.cursor }),
        };
        const request: ExperimentalThreadActivityArgs =
          opts.thread === undefined
            ? { mode: "summary", ...fields }
            : { mode: "details", ...fields, threadId: opts.thread };
        const result =
          await createCliBbSdk(getUrl()).threads.experimental_activity(request);
        process.stdout.write(JSON.stringify(result));
      }),
    );
}
