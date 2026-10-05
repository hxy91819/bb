import { registerCodexAiService } from "./src/ai-service.js";
import { registerUsageSource } from "./src/usage-source.js";
import { z } from "zod";
import {
  parseCodexHomeBindings,
  type CodexHomeBinding,
} from "./src/home-bindings.js";
import type {
  BbPluginApi,
  PluginProviderDeclaration,
  JsonValue,
} from "@get-bb/plugin-sdk";
import { codexExtensionKinds } from "./src/extension-kinds.js";
import { CODEX_NATIVE_ROOTS_DECLARATION } from "./src/native-roots.js";

export default async function plugin(bb: BbPluginApi) {
  registerUsageSource(bb);
  registerCodexAiService(bb);

  bb.settings.define({
    memoryEnabled: {
      type: "boolean",
      label: "Codex memory",
      description:
        "Allow Codex to recall existing memories and generate new memories from bb threads.",
      default: true,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable provider subagents",
      description:
        "Prevent Codex from starting native subagents so agents use bb for delegation.",
      default: false,
    },
  });

  let identities: Map<string, string> | null = null;
  const bindingIdentities = () => {
    if (identities !== null) return identities;
    const database = bb.storage.database();
    bb.storage.migrate(database, [
      "CREATE TABLE codex_home_binding_identities (id TEXT PRIMARY KEY, codex_home TEXT NOT NULL)",
    ]);
    identities = new Map(
      z
        .array(z.object({ id: z.string(), codex_home: z.string() }))
        .parse(
          database
            .prepare("SELECT id, codex_home FROM codex_home_binding_identities")
            .all(),
        )
        .map((row) => [row.id, row.codex_home]),
    );
    return identities;
  };
  const validateBindings = (value: string) => {
    const bindings = parseCodexHomeBindings(value);
    for (const binding of bindings) {
      const previous = bindingIdentities().get(binding.id);
      if (previous !== undefined && previous !== binding.codexHome)
        throw new Error(
          `Binding "${binding.id}" already belongs to another home. Use a new binding ID.`,
        );
    }
    return bindings;
  };
  const settings = bb.settings.define({
    homeBindings: {
      type: "string",
      label: "Codex home bindings",
      description:
        "JSON list of {id, displayName, codexHome}. Paths belong to the execution machine. Bound providers use their own login and bypass Account Pooler.",
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
  bb.providers.register(createCodexProvider("codex", "Codex", null));
  let registrations: Array<{ dispose(): void }> = [];
  const apply = (value: string) => {
    const bindings = validateBindings(value);
    if (bindings.length > 0) {
      const remembered = bindingIdentities();
      const database = bb.storage.database();
      const insert = database.prepare(
        "INSERT OR IGNORE INTO codex_home_binding_identities (id, codex_home) VALUES (?, ?)",
      );
      database.transaction(() => {
        for (const binding of bindings)
          insert.run(binding.id, binding.codexHome);
      })();
      for (const binding of bindings)
        remembered.set(binding.id, binding.codexHome);
    }
    for (const registration of registrations) registration.dispose();
    registrations = bindings.map((binding) =>
      bb.providers.register(
        createCodexProvider(
          `codex-${binding.id}`,
          `Codex · ${binding.displayName}`,
          binding,
        ),
      ),
    );
  };
  apply((await settings.get()).homeBindings);
  settings.onChange((next) => apply(next.homeBindings));
}

function createCodexProvider(
  id: string,
  displayName: string,
  binding: CodexHomeBinding | null,
): PluginProviderDeclaration {
  return {
    id,
    displayName,
    icon: "./icons/codex.svg",
    strings: {
      signInHint:
        binding === null
          ? "Run `codex` on the machine to sign in."
          : `Run \`codex login\` on the execution machine with \`CODEX_HOME\` set to \`${binding.codexHome}\`.`,
      expiredHint:
        binding === null
          ? "Your Codex session expired. Run `codex`, then reload."
          : `Your Codex session expired. Run \`codex login\` with \`CODEX_HOME\` set to \`${binding.codexHome}\` on the execution machine, then reload.`,
      installUrl: "https://developers.openai.com/codex/cli",
      brandPrefix: "GPT-",
    },
    models: { scope: "host", experimental_cache: binding === null },
    ...CODEX_NATIVE_ROOTS_DECLARATION,
    experimental_nativeSkillRoots:
      binding === null
        ? CODEX_NATIVE_ROOTS_DECLARATION.experimental_nativeSkillRoots
        : {
            ...CODEX_NATIVE_ROOTS_DECLARATION.experimental_nativeSkillRoots,
            user: [".agents/skills"],
          },
    maintenance: { health: true, usage: true, installation: true },
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    reasoningLevels: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
      {
        id: "ultra",
        label: "Ultra",
        description: "Max effort plus automatic task delegation.",
      },
    ],
    serviceTiers: [
      { id: "default", label: "Default" },
      { id: "fast", label: "Fast" },
      { id: "ultrafast", label: "Ultrafast" },
    ],
    composerActions: ["plan", "goal"],
    experimental_deriveHostOptions(): Readonly<Record<string, JsonValue>> {
      return {
        codexExecution:
          binding === null
            ? { kind: "default", providerId: id }
            : { kind: "home", providerId: id, codexHome: binding.codexHome },
      };
    },
    deriveProviderOptions(context) {
      return {
        memoryEnabled: context.settings.memoryEnabled !== false,
        providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
      };
    },
    extensionKinds: codexExtensionKinds,
  };
}
