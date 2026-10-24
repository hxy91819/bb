// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { TimelineSelectionMenu } from "./TimelineSelectionMenu";
import type { MessageProseSelection } from "./SelectableMessageProse";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeSelection(
  overrides: Partial<MessageProseSelection> = {},
): MessageProseSelection {
  return {
    text: "selected text",
    rect: new DOMRect(10, 10, 100, 20),
    sourceSeqEnd: 12,
    ...overrides,
  };
}

function mockCompactViewport() {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === COMPACT_VIEWPORT_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function mockPointerCoarse() {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("TimelineSelectionMenu", () => {
  it("renders from a pointer release point without a physical anchor node", () => {
    const { container } = render(
      <TimelineSelectionMenu
        selection={makeSelection({ anchorPoint: { x: 42, y: 84 } })}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("uses the selected anchor side when positioning from a pointer release", () => {
    render(
      <TimelineSelectionMenu
        selection={makeSelection({
          anchorPoint: { x: 42, y: 84 },
          anchorSide: "bottom",
        })}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(document.body.querySelector('[data-side="bottom"]')).toBeTruthy();
  });

  it("stays anchored instead of rendering as a compact viewport drawer", () => {
    mockCompactViewport();
    render(
      <TimelineSelectionMenu
        selection={makeSelection({ anchorSide: "top" })}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(document.body.querySelector('[data-side="top"]')).toBeTruthy();
  });

  it("uses a compact menu that prefers above coarse-pointer selections", () => {
    mockPointerCoarse();
    render(
      <TimelineSelectionMenu
        selection={makeSelection()}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(document.body.querySelector('[data-side="top"]')).toBeTruthy();
  });

  it("keeps the touch action mounted until click to avoid a retargeted Safari tap", () => {
    const onAddToChat = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TimelineSelectionMenu
        selection={makeSelection()}
        onAddToChat={onAddToChat}
        onDismiss={onDismiss}
      />,
    );

    const button = screen.getByRole("button", { name: "Add to chat" });
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    expect(onAddToChat).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(button);

    expect(onAddToChat).toHaveBeenCalledTimes(1);
    expect(onAddToChat).toHaveBeenCalledWith("selected text");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("preserves the reply caret placed synchronously by a touch selection action", () => {
    const composer = document.createElement("div");
    composer.contentEditable = "true";
    composer.tabIndex = 0;
    composer.textContent = "quoted text\n\nreply here";
    document.body.append(composer);
    try {
      render(
        <TimelineSelectionMenu
          selection={makeSelection()}
          onAddToChat={() => {
            composer.focus();
            const range = document.createRange();
            range.selectNodeContents(composer);
            range.collapse(false);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }}
          onDismiss={vi.fn()}
        />,
      );
      const action = screen.getByRole("button", { name: "Add to chat" });
      fireEvent.pointerDown(action, { pointerType: "touch" });
      fireEvent.pointerUp(action, { pointerType: "touch" });
      fireEvent.click(action);

      const selection = window.getSelection();
      expect(document.activeElement).toBe(composer);
      expect(selection?.rangeCount).toBe(1);
      expect(selection?.isCollapsed).toBe(true);
      expect(selection?.anchorNode).toBe(composer);
      expect(selection?.anchorOffset).toBe(composer.childNodes.length);
    } finally {
      window.getSelection()?.removeAllRanges();
      composer.remove();
    }
  });

  it("focuses the composer before a touch add-to-chat action returns", () => {
    function ComposerFocusHandoff() {
      const [selection, setSelection] = useState<MessageProseSelection | null>(
        makeSelection(),
      );
      const [focusRequest, setFocusRequest] = useState(0);
      const inputRef = useRef<HTMLInputElement>(null);
      useLayoutEffect(() => {
        if (focusRequest > 0) {
          inputRef.current?.focus();
        }
      }, [focusRequest]);

      return (
        <>
          <input ref={inputRef} aria-label="Chat composer" />
          <TimelineSelectionMenu
            selection={selection}
            onAddToChat={() => setFocusRequest((request) => request + 1)}
            onDismiss={() => setSelection(null)}
          />
        </>
      );
    }

    render(<ComposerFocusHandoff />);
    const action = screen.getByRole("button", { name: "Add to chat" });
    let focusedWhenGestureEnded: Element | null = null;
    const recordFocus = () => {
      focusedWhenGestureEnded = document.activeElement;
    };
    document.addEventListener("click", recordFocus);
    fireEvent.pointerDown(action, { pointerType: "touch" });
    fireEvent.pointerUp(action, { pointerType: "touch" });
    fireEvent.click(action);
    document.removeEventListener("click", recordFocus);

    expect(focusedWhenGestureEnded).toBe(
      screen.getByRole("textbox", { name: "Chat composer" }),
    );
  });
});
