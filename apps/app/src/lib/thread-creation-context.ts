import { ThreadCreationContextRegistry } from "@get-bb/plugin-sdk/internal/plugin-app-collector";

export const threadCreationContextRegistry =
  new ThreadCreationContextRegistry();

export const captureThreadCreationContext = () =>
  threadCreationContextRegistry.capture();
export function withThreadCreationContext<T extends object>(request: T) {
  return threadCreationContextRegistry.prepare(request);
}
