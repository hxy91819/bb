import { registerUsageSource } from "./src/usage-source.js";
import { z } from "zod";
import {
  parseClaudeHomeBindings,
  type ClaudeHomeBinding,
} from "./src/home-bindings.js";
import type {
  PluginProviderDeclaration,
  JsonValue,
  BbPluginApi,
} from "@get-bb/plugin-sdk";
import { CLAUDE_NATIVE_ROOTS_DECLARATION } from "./src/native-roots.js";

export default async function plugin(bb: BbPluginApi) {
  registerUsageSource(bb);
  bb.settings.define({
    memoryEnabled: {
      type: "boolean",
      label: "Claude Code memory",
      description:
        "Allow Claude Code to read and write its native auto-memory for bb threads.",
      default: true,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable provider subagents",
      description:
        "Hide Claude Code's native Task tool so agents use bb for delegation.",
      default: false,
    },
    workflowsDisabled: {
      type: "boolean",
      label: "Disable Workflow tool",
      description: "Hide Claude Code's native Workflow tool for bb threads.",
      default: false,
    },
    disable1MContext: {
      type: "boolean",
      label: "Disable 1M context",
      description:
        "Disable the 1M-token context window for Claude Code threads. Applies on the next turn.",
      default: false,
    },
    chromeEnabled: {
      type: "boolean",
      label: "Claude in Chrome",
      description:
        "Start Claude Code with the Claude in Chrome browser tools. Needs the Chrome extension and a claude.ai login on the host.",
      default: false,
    },
    artifactsEnabled: {
      type: "boolean",
      label: "Claude Artifacts",
      description:
        "Give Claude Code its Artifact tools to read, publish, and edit claude.ai artifacts. Claude may publish private pages to claude.ai without asking. Needs a claude.ai login on the host. Applies on the next turn.",
      default: false,
    },
    sandboxEnabled: {
      type: "boolean",
      label: "Claude Code sandbox",
      description:
        "Run Bash commands in Claude Code's sandbox in Accept Edits and Approve for me modes. Turn off to use Claude Code's own command approvals and sandbox settings instead.",
      default: true,
    },
  });

  const settings = bb.settings.define({
    homeBindings: {
      type: "string",
      label: "Claude Code home bindings",
      description:
        "JSON list of {id, displayName, claudeConfigDir}. Optional reasoningLevels, defaultReasoningLevel and supportsFastMode describe custom providers. Credentials stay in the host's Claude settings.",
      experimental_multiline: true,
      experimental_schema: z.string().superRefine((value, context) => {
        try {
          validateBindings(value);
        } catch (error) {
          context.addIssue({
            code: "custom",
            message:
              error instanceof Error ? error.message : "Invalid home bindings.",
          });
        }
      }),
      default: "[]",
    },
  });
  const database = bb.storage.database();
  bb.storage.migrate(database, [
    "CREATE TABLE claude_home_binding_identities (id TEXT PRIMARY KEY, config_dir TEXT NOT NULL)",
  ]);
  const identities = new Map(
    z
      .array(z.object({ id: z.string(), config_dir: z.string() }))
      .parse(
        database
          .prepare("SELECT id, config_dir FROM claude_home_binding_identities")
          .all(),
      )
      .map((row) => [row.id, row.config_dir]),
  );
  function validateBindings(value: string) {
    const bindings = parseClaudeHomeBindings(value);
    for (const binding of bindings) {
      const previous = identities.get(binding.id);
      if (previous !== undefined && previous !== binding.claudeConfigDir)
        throw new Error(
          `Binding "${binding.id}" already belongs to another directory. Use a new binding ID.`,
        );
    }
    return bindings;
  }
  bb.providers.register(
    createClaudeProvider("claude-code", "Claude Code", null),
  );
  let registrations: Array<{ dispose(): void }> = [];
  const apply = (value: string) => {
    const bindings = validateBindings(value);
    const insert = database.prepare(
      "INSERT OR IGNORE INTO claude_home_binding_identities (id, config_dir) VALUES (?, ?)",
    );
    database.transaction(() => {
      for (const binding of bindings)
        insert.run(binding.id, binding.claudeConfigDir);
    })();
    for (const binding of bindings)
      identities.set(binding.id, binding.claudeConfigDir);
    for (const registration of registrations) registration.dispose();
    registrations = bindings.map((binding) =>
      bb.providers.register(
        createClaudeProvider(
          `claude-code-${binding.id}`,
          `Claude Code · ${binding.displayName}`,
          binding,
        ),
      ),
    );
  };
  apply((await settings.get()).homeBindings);
  settings.onChange((next) => apply(next.homeBindings));
}

function createClaudeProvider(
  id: string,
  displayName: string,
  binding: ClaudeHomeBinding | null,
): PluginProviderDeclaration {
  return {
    id,
    displayName,
    icon: "./icons/claude-code.svg",
    strings: {
      signInHint:
        binding === null
          ? "Run `claude` on the machine to sign in."
          : `Configure Claude Code credentials in ${binding.claudeConfigDir} on the execution machine.`,
      expiredHint:
        binding === null
          ? "Your Claude session expired. Run `claude`, then reload."
          : `Refresh credentials in ${binding.claudeConfigDir} on the execution machine.`,
      installUrl: "https://claude.com/claude-code",
      brandPrefix: "Claude ",
      planModeCopy:
        "Claude Code will plan without normal full-access execution.",
      iconTint: { light: "#D97757", dark: "#D97757" },
    },
    ...CLAUDE_NATIVE_ROOTS_DECLARATION,
    ...(binding === null
      ? {}
      : {
          experimental_nativeSkillRoots: {
            ...CLAUDE_NATIVE_ROOTS_DECLARATION.experimental_nativeSkillRoots,
            user: binding.claudeConfigDir.startsWith("~/")
              ? [
                  {
                    path: `${binding.claudeConfigDir.slice(2)}/skills`,
                    skipIfManifest: ".claude-plugin/plugin.json",
                  },
                ]
              : [],
          },
        }),
    models: { scope: "host", experimental_cache: binding === null },
    experimental_deriveHostOptions(): Readonly<Record<string, JsonValue>> {
      return binding === null ? {} : { claudeExecution: binding };
    },
    maintenance: { health: true, usage: binding === null, installation: true },
    capabilities: {
      supportsServiceTier: binding?.supportsFastMode ?? true,
      supportsNativeUserQuestion: true,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: binding?.reasoningLevels ?? [
        "low",
        "medium",
        "high",
        "xhigh",
        "ultracode",
        "max",
      ],
    },
    reasoningLevels: binding?.reasoningLevels?.map((id) => ({
      id,
      label:
        id === "xhigh"
          ? "Extra High"
          : id.charAt(0).toUpperCase() + id.slice(1),
    })) ?? [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      {
        id: "ultracode",
        label: "Ultracode",
        description: "Extra-high effort plus standing workflow orchestration.",
      },
      { id: "max", label: "Max" },
    ],
    serviceTiers:
      binding?.supportsFastMode === false
        ? [{ id: "default", label: "Default" }]
        : [
            { id: "default", label: "Default" },
            {
              id: "fast",
              label: "Fast",
              description:
                "Faster responses on supported Opus models at a higher cost per token.",
            },
          ],
    composerActions: ["plan"],
    completedTurnDisplay: "flat",
    env: {
      passthrough: ["BB_CLAUDE_CODE_EXECUTABLE", "CLAUDE_CODE_OAUTH_TOKEN"],
    },
    deriveProviderOptions(context) {
      return {
        memoryEnabled: context.settings.memoryEnabled !== false,
        providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
        workflowsEnabled: context.settings.workflowsDisabled !== true,
        chromeEnabled: context.settings.chromeEnabled === true,
        disable1MContext: context.settings.disable1MContext === true,
        artifactsEnabled: context.settings.artifactsEnabled === true,
        sandboxEnabled: context.settings.sandboxEnabled !== false,
        ...(context.promptMode === "plan"
          ? { claudeCodePermissionMode: "plan" }
          : {}),
      };
    },
  };
}
