// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { expect, it } from "vitest";
import entry from "./app";
import { registrationSchema } from "./contract";

it("recovers a failed first read and refreshes missed registration changes after reconnect", async () => {
  const app = await loadPluginApp(entry);
  let offline = true;
  let registration: ReturnType<typeof registrationSchema.parse> | null =
    registrationSchema.parse({
      threadId: "thread",
      topic: "目标",
      workbook: "/repo/workbook.md",
      ledger: "/repo/ledger.md",
      checker: "/skills/steward_workbook.py",
      schemaVersion: 1,
      projectId: "project",
      hostId: "host",
      repoRoot: "/repo",
      workbookRelativePath: "workbook.md",
      registeredAt: "2026-10-27T00:00:00.000Z",
    });
  const slot = renderSlot(
    app.threadHeaderActions[0]!,
    { threadId: "thread", projectId: "project", isCompactViewport: false },
    {
      rpc: {
        show: () => {
          if (offline) throw new Error("offline");
          return registration;
        },
      },
    },
  );
  expect(slot.queryByRole("button", { name: "打开工作簿" })).toBeNull();
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  offline = false;
  await slot.behavior.setRealtimeConnectionState("connected");
  await slot.findByRole("button", { name: "打开工作簿" });
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  registration = null;
  await slot.behavior.setRealtimeConnectionState("connected");
  expect(slot.queryByRole("button", { name: "打开工作簿" })).toBeNull();
  slot.unmount();
});
