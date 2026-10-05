import type { Mermaid } from "mermaid";

let mermaidImportPromise: Promise<Mermaid> | null = null;

export function loadMermaid(): Promise<Mermaid> {
  if (mermaidImportPromise === null) {
    mermaidImportPromise = Promise.all([
      import("mermaid"),
      import("@mermaid-js/layout-elk"),
    ]).then(([mermaidModule, elkLayoutsModule]) => {
      const mermaid = mermaidModule.default;
      mermaid.registerLayoutLoaders(elkLayoutsModule.default);
      return mermaid;
    });
  }

  return mermaidImportPromise;
}
