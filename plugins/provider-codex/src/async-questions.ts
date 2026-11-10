import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CODEX_ASYNC_QUESTION_EXTENSION_KIND,
  codexAsyncQuestionStateSchema,
  type CodexAsyncQuestionState,
} from "./extension-kinds.js";
import {
  CODEX_ASYNC_QUESTION_RENDERER_ID,
  asyncQuestionResponseSchema,
  formatAsyncQuestionAnswer,
} from "./async-question-form.js";

const CODEX_PROVIDER_ID = "codex";
const QUESTION_TIMEOUT_MS = 60 * 60 * 1000;
const EVENT_PAGE_SIZE = 100;

function cursorKey(threadId: string): string {
  return `async-question-cursor:${threadId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerAsyncQuestions(
  bb: BbPluginApi,
  providerIds: ReadonlySet<string> = new Set([CODEX_PROVIDER_ID]),
): void {
  const threadWork = new Map<string, Promise<void>>();

  function enqueue(threadId: string, work: () => Promise<void>): void {
    const next = (threadWork.get(threadId) ?? Promise.resolve())
      .then(work)
      .catch((error: unknown) => {
        bb.log.warn(
          `async question handling failed for thread ${threadId}: ${errorMessage(error)}`,
        );
      });
    threadWork.set(threadId, next);
    void next.then(() => {
      if (threadWork.get(threadId) === next) threadWork.delete(threadId);
    });
  }

  async function readNewQuestions(
    threadId: string,
  ): Promise<CodexAsyncQuestionState[]> {
    let cursor = (await bb.storage.kv.get<number>(cursorKey(threadId))) ?? 0;
    const questions: CodexAsyncQuestionState[] = [];
    for (;;) {
      const page = await bb.sdk.threads.events.list({
        threadId,
        afterSeq: String(cursor),
        order: "asc",
        limit: String(EVENT_PAGE_SIZE),
        types: ["thread/extensionState/updated"],
      });
      for (const row of page) {
        cursor = Math.max(cursor, row.seq);
        if (
          row.type !== "thread/extensionState/updated" ||
          row.data.kind !== CODEX_ASYNC_QUESTION_EXTENSION_KIND
        )
          continue;
        const state = codexAsyncQuestionStateSchema.safeParse(row.data.payload);
        if (state.success) questions.push(state.data);
      }
      if (page.length < EVENT_PAGE_SIZE) break;
    }
    await bb.storage.kv.set(cursorKey(threadId), cursor);
    return questions;
  }

  async function ask(
    threadId: string,
    state: CodexAsyncQuestionState,
  ): Promise<void> {
    const result = await bb.ui.requestInput({
      threadId,
      rendererId: CODEX_ASYNC_QUESTION_RENDERER_ID,
      title:
        state.questions.length === 1
          ? state.questions[0].title
          : `${state.questions.length} questions`,
      payload: {
        questions: state.questions,
        responseInstructions:
          'Response JSON example: {"answers":{"question-1":{"selected":["option-1"]}}}. Replace the example selection with your answer. Number questions and options from 1 in their listed order. Include an answer for each question. For a typed answer use {"selected":[],"freeText":"your answer"}. Submit the interaction to close the question card and deliver the answer to the thread.',
      },
      timeoutMs: QUESTION_TIMEOUT_MS,
      presentation: {
        label: { pending: "Asking a question", completed: "Asked a question" },
        icon: { glyph: "MessageQuestion" },
      },
      describeSubmission: () => ({ title: "Answered" }),
    });
    if (result.outcome !== "submitted") return;
    const response = asyncQuestionResponseSchema.parse(result.value);
    await bb.sdk.threads.send({
      threadId,
      mode: "auto",
      input: [
        {
          type: "text",
          text: formatAsyncQuestionAnswer(state.questions, response),
          mentions: [],
        },
      ],
    });
  }

  bb.events.on("experimental_thread.events", ({ thread }) => {
    if (!providerIds.has(thread.providerId)) return;
    enqueue(thread.id, async () => {
      for (const state of await readNewQuestions(thread.id)) {
        void ask(thread.id, state).catch((error: unknown) => {
          bb.log.warn(
            `async question handling failed for thread ${thread.id}: ${errorMessage(error)}`,
          );
        });
      }
    });
  });

  bb.events.on("thread.deleted", ({ thread }) => {
    void bb.storage.kv.delete(cursorKey(thread.id));
  });
}
