import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  registerLayoutLoaders: vi.fn(),
}));
const elkLayouts = vi.hoisted(() => [{ loader: vi.fn(), name: "elk" }]);

vi.mock("mermaid", () => ({ default: mermaid }));
vi.mock("@mermaid-js/layout-elk", () => ({ default: elkLayouts }));

describe("loadMermaid", () => {
  beforeEach(() => {
    vi.resetModules();
    mermaid.registerLayoutLoaders.mockClear();
  });

  it("registers the ELK loader once before sharing Mermaid", async () => {
    const { loadMermaid } = await import("./markdown-mermaid-loader.js");

    const [first, second] = await Promise.all([loadMermaid(), loadMermaid()]);

    expect(first).toBe(mermaid);
    expect(second).toBe(mermaid);
    expect(mermaid.registerLayoutLoaders).toHaveBeenCalledTimes(1);
    expect(mermaid.registerLayoutLoaders).toHaveBeenCalledWith(elkLayouts);
  });
});
