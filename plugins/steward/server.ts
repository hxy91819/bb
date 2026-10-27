import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  registrationSchema,
  registerInput,
  threadInput,
  rpcContract,
  hostContract,
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
      const removed = (await show({ threadId })) !== null;
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        remove: ["registration"],
      });
      changed();
      return { removed };
    });
  const register = (input: ReturnType<typeof registerInput.parse>) =>
    serialize(async () => {
      const thread = await bb.sdk.threads.get({ threadId: input.threadId });
      if (!thread.environmentId)
        throw new Error("此会话尚未绑定文件所在环境。");
      const environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
      const identity = await host.call(
        "identity",
        { workbook: input.workbook },
        { hostId: environment.hostId },
      );
      const previous = await show(input);
      const registration = registrationSchema.parse({
        ...input,
        ...identity,
        schemaVersion: 1,
        projectId: thread.projectId,
        hostId: environment.hostId,
        registeredAt: previous?.registeredAt ?? new Date().toISOString(),
      });
      try {
        for (let offset = 0; ; offset += 100) {
          const page = await bb.sdk.threads.list({
            projectId: thread.projectId,
            limit: 100,
            offset,
            includeHidden: true,
          });
          for (const candidate of page) {
            if (candidate.id === input.threadId) continue;
            const old = await show({ threadId: candidate.id });
            if (
              old &&
              old.hostId === registration.hostId &&
              old.repoRoot === registration.repoRoot &&
              old.workbookRelativePath === registration.workbookRelativePath
            ) {
              await bb.sdk.threads.updatePluginMetadata({
                threadId: candidate.id,
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
        }),
        { hostId: registration.hostId, timeoutMs: 50000 },
      );
    } catch {
      throw new Error("文件所在主机暂时无法连接，请连接后重试。");
    }
  };
  bb.rpc.register(rpcContract, {
    register,
    show,
    unregister,
    refresh,
    async document({ threadId, document }) {
      const registration = await show({ threadId });
      if (!registration)
        return { available: false, message: "此会话的管家登记已解除。" };
      try {
        return await host.call(
          "document",
          { path: registration[document] },
          { hostId: registration.hostId },
        );
      } catch {
        return {
          available: false,
          message: "文件所在主机暂时离线，请连接后重试。",
        };
      }
    },
  });
  const commands = [
    {
      name: "register",
      summary: "登记管家并撤销同一工作簿的旧管家标记",
      usage:
        "bb steward register --thread <id> --topic <名称> --workbook <绝对路径> --ledger <绝对路径> --checker <脚本绝对路径> [--json]",
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
        };
        for (let i = 0; i < args.length; i += 2) {
          const key = keys[args[i]];
          if (!key || !args[i + 1] || key in values)
            throw new Error(
              "请检查命令参数，使用 bb steward --help 查看用法。",
            );
          values[key] = args[i + 1];
        }
        const result =
          command === "register"
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
