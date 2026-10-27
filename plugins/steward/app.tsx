import { useCallback, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type {
  Checks,
  Registration,
  DocumentResult,
  rpcContract,
} from "./contract";

const buttonClass =
  "cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
function useSteward(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [value, setValue] = useState<{
    threadId: string;
    registration: Registration | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  useRealtime("changed", reload);
  useEffect(() => {
    let current = true;
    if (threadId && connection === "connected")
      rpc.call("show", { threadId }).then(
        (registration) => {
          if (current) {
            setValue({ threadId, registration });
            setError("");
          }
        },
        () => {
          if (current) setError("管家入口暂时未就绪，请稍后重试。");
        },
      );
    return () => {
      current = false;
    };
  }, [rpc, threadId, version, connection]);
  return {
    registration: value?.threadId === threadId ? value.registration : null,
    error,
    reload,
  };
}
function DocumentButtons({
  registration,
  compact = false,
}: {
  registration: Registration;
  compact?: boolean;
}) {
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [error, setError] = useState("");
  const [view, setView] = useState<DocumentResult | null>(null);
  const [selected, setSelected] = useState<"workbook" | "ledger">("workbook");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const open = async (
    document: "workbook" | "ledger",
    link?: { from: string; target: string; sha: string },
    cursor?: NonNullable<DocumentResult["next"]>,
    append = false,
  ) => {
    const id = ++request.current;
    if (!append) setView(null);
    setError("");
    setSelected(document);
    setBusy(true);
    try {
      const status = await rpc.call("document", {
        threadId: registration.threadId,
        document,
        ...(link ? { link } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (id !== request.current) return;
      if (!status.available) {
        setError(status.message);
        return;
      }
      if (registration.source.kind === "git") {
        setView((previous) =>
          append && previous
            ? {
                ...status,
                offset: previous.offset,
                ...(status.kind === "directory"
                  ? {
                      entries: [
                        ...(previous.entries ?? []),
                        ...(status.entries ?? []),
                      ],
                    }
                  : {
                      content:
                        (previous.content ?? "") + (status.content ?? ""),
                    }),
              }
            : status,
        );
        return;
      }
      const opened = navigate.experimental_openFilePreview({
        target: {
          kind: "host",
          hostId: registration.hostId,
          path: registration[document],
        },
        location: null,
      });
      setError(
        opened ? "" : "当前页面无法打开文件预览，请返回管家会话后重试。",
      );
    } catch {
      if (id === request.current)
        setError("文件预览暂时未就绪，请确认主机连接后重试。");
    } finally {
      if (id === request.current) setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        className={buttonClass}
        aria-label="打开工作簿"
        title="工作簿"
        onClick={() => open("workbook")}
      >
        {compact ? "▤" : "工作簿"}
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label="打开要求帐"
        title="要求帐"
        onClick={() => open("ledger")}
      >
        {compact ? "☷" : "要求帐"}
      </button>
      {busy && <span role="status">正在核实来源并读取…</span>}
      {view?.snapshot && view.path && (
        <section
          aria-label="Git 只读文档"
          className="basis-full space-y-2 border-t border-border p-2"
          style={{
            maxWidth: "min(80vw, 640px)",
            maxHeight: "50dvh",
            overflow: "auto",
          }}
        >
          <p className="break-all">
            {view.snapshot.repo} @ {view.snapshot.ref}
            <br />
            SHA：{view.snapshot.sha}
            <br />
            {view.path}
          </p>
          <p>{view.message}</p>
          <button
            type="button"
            className={buttonClass}
            onClick={() => open(selected)}
          >
            刷新远端文档
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              request.current++;
              setView(null);
              setBusy(false);
            }}
          >
            关闭正文
          </button>
          {view.kind === "directory" ? (
            <section aria-label="Git 目录" className="space-y-1">
              <p>
                目录：{view.path}（已列出 {view.entries?.length ?? 0} /{" "}
                {view.total} 项）
              </p>
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  open(selected, undefined, {
                    path: registration[selected],
                    sha: view.snapshot!.sha,
                    offset: 0,
                  })
                }
              >
                返回入口索引
              </button>
              {view.path !== "." && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() =>
                    open(selected, {
                      from: `${view.path}/`,
                      target: "../",
                      sha: view.snapshot!.sha,
                    })
                  }
                >
                  上级目录
                </button>
              )}
              <ul>
                {view.entries?.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={entry.kind === "unsupported"}
                      onClick={() =>
                        open(selected, {
                          from: `${view.path}/`,
                          target:
                            encodeURIComponent(entry.name) +
                            (entry.kind === "directory" ? "/" : ""),
                          sha: view.snapshot!.sha,
                        })
                      }
                    >
                      {entry.name}
                    </button>{" "}
                    {entry.kind === "directory"
                      ? "目录"
                      : entry.kind === "file"
                        ? "文件"
                        : "不支持的对象"}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">
              {(view.content ?? "")
                .split(/(\[[^\]]+\]\([^)]+\))/g)
                .map((part, i) => {
                  const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
                  if (!match) return part;
                  return (
                    <button
                      type="button"
                      key={i}
                      className="cursor-pointer underline"
                      onClick={() =>
                        open(selected, {
                          from: view.path!,
                          target: match[2],
                          sha: view.snapshot!.sha,
                        })
                      }
                    >
                      {match[1]}
                    </button>
                  );
                })}
            </pre>
          )}
          {view.next && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => open(selected, undefined, view.next!, true)}
            >
              继续读取{view.kind === "directory" ? "目录" : "正文"}
            </button>
          )}
          {view.kind === "file" && view.total !== undefined && (
            <p>
              {view.next ? "正文尚未完整读取" : "正文已完整读取"}（总计{" "}
              {view.total} UTF-8 字节）
            </p>
          )}
        </section>
      )}
      {error && (
        <span role="status" className="text-xs">
          {error}
        </span>
      )}
    </div>
  );
}
function Header({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const { registration, error } = useSteward(threadId);
  const { threadId: focusedThreadId } = useBbContext();
  if (!registration) return null;
  return (
    <div
      data-steward-header
      className="flex items-center gap-1"
      title={error || registration.topic}
    >
      <DocumentButtons
        key={`${threadId}:${JSON.stringify(registration)}`}
        registration={registration}
        compact={isCompactViewport}
      />
      {focusedThreadId === threadId &&
        createPortal(
          <FloatingCard
            key={`${registration.threadId}:${registration.registeredAt}:${registration.workbook}:${registration.ledger}:${registration.checker}:${JSON.stringify(registration.source)}:${registration.ledgerKind}`}
            registration={registration}
            error={error}
          />,
          document.body,
        )}
    </div>
  );
}
function Result({
  title,
  result,
}: {
  title: string;
  result: Checks["workbook"];
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium">
        {title}：
        {result.applicable === false
          ? "不适用"
          : result.ok
            ? "通过"
            : "需要处理"}
      </p>
      {result.errors.length > 0 && (
        <ul className="list-disc space-y-1 pl-4">
          {result.errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
function FloatingCard({
  registration,
  error,
}: {
  registration: Registration;
  error: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const key = `steward.collapsed.${registration.threadId}`;
  const [collapsed, setCollapsed] = useState(
    () =>
      localStorage.getItem(key) === "true" ||
      (localStorage.getItem(key) === null &&
        window.matchMedia("(max-width: 640px)").matches),
  );
  const [expanded, setExpanded] = useState(false);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkError, setCheckError] = useState("");
  const refresh = async () => {
    setBusy(true);
    setCheckError("");
    setChecks(null);
    try {
      setChecks(await rpc.call("refresh", { threadId: registration.threadId }));
    } catch {
      setCheckError(
        "无法检查文件。请确认文件所在主机在线，且管家技能与两份文件均已就绪。",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside
      aria-label="管家工作簿"
      data-steward-floating
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 96px)",
        right: 12,
        zIndex: 40,
        maxWidth: "calc(100vw - 24px)",
        width: collapsed ? "auto" : expanded ? 340 : "auto",
        maxHeight: "55dvh",
        overflowY: "auto",
        pointerEvents: "auto",
      }}
      className="rounded-lg border border-border bg-background p-2 text-xs text-foreground shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={buttonClass}
          aria-label={collapsed ? "展开管家浮窗" : "收合管家浮窗"}
          aria-expanded={!collapsed}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            localStorage.setItem(key, String(next));
          }}
        >
          {collapsed ? "管家 ▸" : "管家 ▾"}
        </button>
        {!collapsed && (
          <button
            type="button"
            className={buttonClass}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            摘要
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="mt-2 space-y-2">
          <p
            className="max-w-64 truncate font-medium"
            title={registration.topic}
          >
            {registration.topic}
          </p>
          <DocumentButtons registration={registration} />
          {error && <p role="status">{error}</p>}
          {expanded && (
            <section
              aria-label="管家摘要"
              className="space-y-3 border-t border-border pt-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span>文件检查</span>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={refresh}
                >
                  {busy ? "检查中…" : "刷新检查"}
                </button>
              </div>
              {checkError && <p role="alert">{checkError}</p>}
              {!checks && (
                <p role="status">
                  尚未检查。点击刷新后显示要求帐计数和检查结果。
                </p>
              )}
              {checks && (
                <>
                  <p>
                    進行中：
                    {checks.ledger.applicable === false
                      ? "不适用"
                      : (checks.ledger.summary?.["進行中"] ?? "未取得")}
                    　待使用者：
                    {checks.ledger.applicable === false
                      ? "不适用"
                      : (checks.ledger.summary?.["待使用者"] ?? "未取得")}
                  </p>
                  {checks.snapshot && (
                    <p className="break-all">
                      {checks.snapshot.repo} @ {checks.snapshot.ref} SHA：
                      {checks.snapshot.sha}
                    </p>
                  )}
                  <Result title="工作簿 check" result={checks.workbook} />
                  <Result title="要求帐 ledger-check" result={checks.ledger} />
                  <p className="text-muted-foreground">
                    检查时间：{new Date(checks.checkedAt).toLocaleString()}
                  </p>
                  {busy && <p role="status">正在更新；上方为上次检查结果。</p>}
                </>
              )}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "documents",
    title: "管家文件",
    component: Header,
  });
});
