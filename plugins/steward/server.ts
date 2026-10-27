import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  registrationSchema,
  registerInput,
  threadInput,
  rpcContract,
  hostContract,
  documentRequest,
} from "./contract";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const changed = () => bb.realtime.publish("changed", {});
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action);
    pending = result.catch(() => undefined);
    return result;
  };
  const show = async ({ threadId }: { threadId: string }) => {
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId });
    const parsed = registrationSchema.safeParse(metadata.registration);
    return parsed.success ? parsed.data : null;
  };
  const unregister = ({ threadId }: { threadId: string }) =>
    serialize(async () => {
      try {
        const removed = (await show({ threadId })) !== null;
        await bb.sdk.threads.updatePluginMetadata({
          threadId,
          remove: ["registration"],
        });
        changed();
        return { removed };
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          !("status" in cause) ||
          cause.status !== 404
        )
          throw cause;
        changed();
        return { removed: false };
      }
    });
  const register = (input: ReturnType<typeof registerInput.parse>) =>
    serialize(async () => {
      const thread = await bb.sdk.threads.get({ threadId: input.threadId });
      if (!thread.environmentId)
        throw new Error("此会话尚未绑定文件所在环境。");
      const environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      const previous = await show(input);
      const hostId = previous?.hostId ?? environment.hostId;
      const identity = await host.call(
        "identity",
        { workbook: input.workbook, source: input.source },
        { hostId },
      );
      const registration = registrationSchema.parse({
        ...input,
        ...identity,
        schemaVersion: 1,
        projectId: thread.projectId,
        hostId,
        registeredAt: previous?.registeredAt ?? new Date().toISOString(),
      });
      try {
        for (let offset = 0; ; offset += 100) {
          const page = await bb.sdk.threads.list({
            limit: 100,
            offset,
            includeHidden: true,
          });
          const batch = page.length
            ? await bb.sdk.threads.experimental_listPluginMetadata({
                threadIds: page.map((candidate) => candidate.id),
              })
            : { threads: [] };
          for (const candidate of batch.threads) {
            if (candidate.threadId === input.threadId) continue;
            const parsed = registrationSchema.safeParse(
              candidate.metadata.registration,
            );
            const old = parsed.success ? parsed.data : null;
            if (
              old &&
              old.hostId === registration.hostId &&
              old.repoRoot === registration.repoRoot &&
              old.workbookRelativePath === registration.workbookRelativePath &&
              old.source.kind === registration.source.kind &&
              (old.source.kind !== "git" ||
                (registration.source.kind === "git" &&
                  old.source.ref === registration.source.ref))
            ) {
              await bb.sdk.threads.updatePluginMetadata({
                threadId: candidate.threadId,
                remove: ["registration"],
              });
            }
          }
          if (page.length < 100) break;
        }
        await bb.sdk.threads.updatePluginMetadata({
          threadId: input.threadId,
          set: { registration },
        });
        return registration;
      } finally {
        changed();
      }
    });
  const refresh = async (input: { threadId: string }) => {
    const registration = await show(input);
    if (!registration)
      throw new Error("此会话尚未登记为管家，请重新执行管家会话开始步骤。");
    try {
      return await host.call(
        "check",
        registerInput.parse({
          threadId: registration.threadId,
          topic: registration.topic,
          workbook: registration.workbook,
          ledger: registration.ledger,
          checker: registration.checker,
          source: registration.source,
          ledgerKind: registration.ledgerKind,
        }),
        { hostId: registration.hostId, timeoutMs: 120000 },
      );
    } catch {
      throw new Error("文件所在主机暂时无法连接，请连接后重试。");
    }
  };
  const document = async ({
    threadId,
    ...request
  }: { threadId: string } & ReturnType<typeof documentRequest.parse>) => {
    const registration = await show({ threadId });
    if (!registration)
      return { available: false, message: "此会话的管家登记已解除。" };
    try {
      const input = registerInput.parse(
        Object.fromEntries(
          Object.entries(registration).filter(
            ([key]) => key in registerInput.shape,
          ),
        ),
      );
      return await host.call(
        "document",
        { registration: input, ...request },
        { hostId: registration.hostId, timeoutMs: 90000 },
      );
    } catch {
      return {
        available: false,
        message: "文件所在主机暂时离线，请连接后重试。",
      };
    }
  };
  bb.rpc.register(rpcContract, {
    register,
    show,
    unregister,
    refresh,
    document,
  });
  const commands = [
    {
      name: "register",
      summary: "登记管家并撤销同一工作簿的旧管家标记",
      usage:
        "bb steward register --thread <id> --topic <名称> --workbook <本地绝对路径或Git相对路径> --ledger <本地绝对路径或Git相对路径> --checker <脚本绝对路径> [--repo <仓库绝对路径> --ref <远端/分支>] [--ledger-kind standard|history] [--json]",
    },
    {
      name: "document",
      summary: "读取 Git 正文或检查本地入口",
      usage:
        "bb steward document --thread <id> --document workbook|ledger [--from <相对路径> --target <相对链接> --sha <SHA> | --cursor <JSON游标>] [--limit <256..65536字节>] [--json]",
    },
    ...["show", "unregister", "refresh"].map((name) => ({
      name,
      summary: {
        show: "查看管家登记",
        unregister: "解除管家标记",
        refresh: "按需检查工作簿与要求帐",
      }[name]!,
      usage: `bb steward ${name} --thread <id> [--json]`,
    })),
  ];
  bb.cli.register({
    name: "steward",
    summary: "管家工作簿与要求帐",
    commands,
    async run(argv) {
      const args = argv.filter((arg) => arg !== "--json");
      const command = args.shift();
      if (!command || command === "--help" || command === "help")
        return { exitCode: 0, stdout: commands.map((c) => c.usage).join("\n") };
      try {
        const values: Record<string, string> = {};
        const keys: Record<string, string> = {
          "--thread": "threadId",
          "--topic": "topic",
          "--workbook": "workbook",
          "--ledger": "ledger",
          "--checker": "checker",
          "--repo": "repo",
          "--ref": "ref",
          "--ledger-kind": "ledgerKind",
          "--document": "document",
          "--from": "from",
          "--target": "target",
          "--sha": "sha",
          "--cursor": "cursor",
          "--limit": "limit",
        };
        for (let i = 0; i < args.length; i += 2) {
          const key = keys[args[i]];
          if (!key || !args[i + 1] || key in values)
            throw new Error(
              "请检查命令参数，使用 bb steward --help 查看用法。",
            );
          values[key] = args[i + 1];
        }
        const allowed =
          command === "document"
            ? [
                "threadId",
                "document",
                "from",
                "target",
                "sha",
                "cursor",
                "limit",
              ]
            : command === "register"
              ? [
                  "threadId",
                  "topic",
                  "workbook",
                  "ledger",
                  "checker",
                  "repo",
                  "ref",
                  "ledgerKind",
                ]
              : ["threadId"];
        if (Object.keys(values).some((key) => !allowed.includes(key)))
          throw new Error("此操作不支持这些参数。");
        if (command === "register" && ("repo" in values || "ref" in values)) {
          const { repo, ref } = values;
          delete values.repo;
          delete values.ref;
          const input = registerInput.parse({
            ...values,
            source: { kind: "git", repo, ref },
          });
          return { exitCode: 0, stdout: JSON.stringify(await register(input)) };
        }
        const result =
          command === "document"
            ? await document(
                threadInput.extend(documentRequest.shape).parse({
                  threadId: values.threadId,
                  document: values.document,
                  ...(values.cursor
                    ? { cursor: JSON.parse(values.cursor) }
                    : {}),
                  ...(values.limit ? { limit: Number(values.limit) } : {}),
                  ...(values.from || values.target || values.sha
                    ? {
                        link: {
                          from: values.from,
                          target: values.target,
                          sha: values.sha,
                        },
                      }
                    : {}),
                }),
              )
            : command === "register"
              ? await register(registerInput.parse(values))
              : command === "show"
                ? await show(threadInput.parse(values))
                : command === "unregister"
                  ? await unregister(threadInput.parse(values))
                  : command === "refresh"
                    ? await refresh(threadInput.parse(values))
                    : undefined;
        if (result === undefined)
          throw new Error("未知操作，请使用 bb steward --help。");
        return { exitCode: 0, stdout: JSON.stringify(result) };
      } catch {
        return {
          exitCode: 1,
          stderr:
            "管家操作未完成，请检查参数和文件所在主机是否在线；用 bb steward --help 查看用法。",
        };
      }
    },
  });
}
