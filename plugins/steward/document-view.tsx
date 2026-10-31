import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { DocumentResult, Registration, rpcContract } from "./contract";
import "./document-view.css";

const buttonClass =
  "cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function GitDocumentReader({
  registration,
  selected,
}: {
  registration: Registration;
  selected: "workbook" | "ledger";
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [view, setView] = useState<DocumentResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [read, setRead] = useState<{
    link?: { from: string; target: string; sha: string };
    cursor?: NonNullable<DocumentResult["next"]>;
    append: boolean;
  }>({ append: false });
  const open = (
    link?: { from: string; target: string; sha: string },
    cursor?: NonNullable<DocumentResult["next"]>,
    append = false,
  ) => {
    if (!append) setView(null);
    setError("");
    setBusy(true);
    setRead({ link, cursor, append });
  };
  useEffect(() => {
    let current = true;
    rpc
      .call("document", {
        threadId: registration.threadId,
        document: selected,
        ...(read.link ? { link: read.link } : {}),
        ...(read.cursor ? { cursor: read.cursor } : {}),
      })
      .then(
        (status) => {
          if (!current) return;
          if (!status.available) {
            setError(status.message);
            return;
          }
          setView((previous) =>
            read.append && previous
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
        },
        () => {
          if (current) setError("文档暂时无法读取，请确认主机连接后重试。");
        },
      )
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [rpc, registration.threadId, selected, read]);
  const snapshot = view?.snapshot;
  const path = view?.path;
  const follow = (target: string) => {
    if (snapshot && path)
      void open({
        from: view.kind === "directory" ? `${path}/` : path,
        target,
        sha: snapshot.sha,
      });
  };
  return (
    <section
      aria-label="Git 只读文档"
      className="flex h-full min-h-0 min-w-0 flex-col text-foreground"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-3">
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void open()}
        >
          刷新远端文档
        </button>
        {snapshot && path !== registration[selected] && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              void open(undefined, {
                path: registration[selected],
                sha: snapshot.sha,
                offset: 0,
              })
            }
          >
            返回入口索引
          </button>
        )}
        {view?.kind === "directory" && path !== "." && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => follow("../")}
          >
            上级目录
          </button>
        )}
        {busy && (
          <span role="status" className="text-xs">
            正在核实来源并读取…
          </span>
        )}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4">
        {error && (
          <p role="alert" className="mb-3 text-sm">
            {error}
          </p>
        )}
        {snapshot && path && (
          <>
            <details className="mb-4 break-all text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {path} · {snapshot.ref} · {snapshot.sha.slice(0, 8)}
              </summary>
              <p>
                {snapshot.repo} @ {snapshot.ref}
                <br />
                SHA：{snapshot.sha}
              </p>
            </details>
            <p className="mb-4 text-xs text-muted-foreground">{view.message}</p>
            {view.kind === "directory" ? (
              <section aria-label="Git 目录">
                <p className="mb-2 text-sm">
                  目录：{path}（已列出 {view.entries?.length ?? 0} /{" "}
                  {view.total} 项）
                </p>
                <ul className="space-y-2">
                  {view.entries?.map((entry) => (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={busy || entry.kind === "unsupported"}
                        onClick={() =>
                          follow(
                            encodeURIComponent(entry.name) +
                              (entry.kind === "directory" ? "/" : ""),
                          )
                        }
                      >
                        {entry.name}
                      </button>{" "}
                      <span className="text-xs text-muted-foreground">
                        {entry.kind === "directory"
                          ? "目录"
                          : entry.kind === "file"
                            ? "文件"
                            : "不支持的对象"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <article
                aria-label="文档正文"
                className="steward-markdown text-sm"
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => {
                      const relative =
                        href && !/^(?:[a-z][a-z0-9+.-]*:|[\/#])/i.test(href);
                      return (
                        <a
                          href={href}
                          target={
                            relative || href?.startsWith("#")
                              ? undefined
                              : "_blank"
                          }
                          rel="noopener noreferrer"
                          onClick={
                            relative
                              ? (event) => {
                                  event.preventDefault();
                                  if (!busy) follow(href);
                                }
                              : undefined
                          }
                        >
                          {children}
                        </a>
                      );
                    },
                    table: ({ children }) => (
                      <div className="overflow-x-auto">
                        <table>{children}</table>
                      </div>
                    ),
                  }}
                >
                  {view.content ?? ""}
                </ReactMarkdown>
              </article>
            )}
            {view.next && (
              <button
                type="button"
                className={`${buttonClass} mt-4`}
                disabled={busy}
                onClick={() => void open(undefined, view.next!, true)}
              >
                继续读取{view.kind === "directory" ? "目录" : "正文"}
              </button>
            )}
            {view.kind === "file" && view.total !== undefined && (
              <p className="mt-4 text-xs text-muted-foreground">
                {view.next ? "正文尚未完整读取" : "正文已完整读取"}（总计{" "}
                {view.total} UTF-8 字节）
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
