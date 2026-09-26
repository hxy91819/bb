// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderInfo } from "@bb/domain";
import { defaultAppSettings } from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { useThreadCreationOptions } from "./useThreadCreationOptions";

const mocks = vi.hoisted(() => ({
  executionOptions: vi.fn(),
  providerStates: vi.fn(),
  config: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    system: {
      executionOptions: mocks.executionOptions,
      providerStates: mocks.providerStates,
      config: mocks.config,
    },
    hosts: { list: vi.fn(async () => []) },
  },
}));

function provider(id: string): ProviderInfo {
  return makeProviderInfo({ id, logoUrl: null });
}

function executionOptionsResponse(
  providers: readonly ProviderInfo[],
): SystemExecutionOptionsResponse {
  return {
    providers: [...providers],
    models: [],
    selectedOnlyModels: [],
    permissionCeiling: "full",
    modelLoadError: null,
  };
}

const providers = [provider("alpha"), provider("beta"), provider("gamma")];

function seedConfig(hiddenProviders: string[]): void {
  mocks.config.mockResolvedValue(
    makeSystemConfig({
      generalSettings: { ...defaultAppSettings, hiddenProviders },
    }),
  );
}

function renderCreationOptions(
  options: {
    preferReadyProviderWhenUnset?: boolean;
    scope?: "new-thread" | "component-local";
    initialProviderId?: string;
  } = {},
) {
  const harness = createQueryClientTestHarness();
  const rendered = renderHook(
    () =>
      useThreadCreationOptions({
        scope: options.scope ?? "new-thread",
        initialProviderId: options.initialProviderId,
        preferReadyProviderWhenUnset:
          options.preferReadyProviderWhenUnset ?? false,
      }),
    { wrapper: harness.wrapper },
  );
  return { ...rendered, queryClient: harness.queryClient };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.executionOptions.mockImplementation(async () =>
    executionOptionsResponse(providers),
  );
  mocks.providerStates.mockResolvedValue({
    providers: [
      {
        providerId: "alpha",
        displayName: "alpha",
        status: "ready",
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
      },
      {
        providerId: "beta",
        displayName: "beta",
        status: "ready",
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
      },
      {
        providerId: "gamma",
        displayName: "gamma",
        status: "ready",
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useThreadCreationOptions with hiddenProviders", () => {
  it("keeps every provider selectable when nothing is hidden", async () => {
    seedConfig([]);
    const { result } = renderCreationOptions();
    await waitFor(() => expect(result.current.providerOptions).toHaveLength(3));
    expect(
      result.current.providerOptions.map((option) => option.value),
    ).toEqual(["alpha", "beta", "gamma"]);
    expect(result.current.selectedProviderId).toBe("alpha");
  });

  it("drops hidden providers from the picker options and falls back to the first visible provider", async () => {
    seedConfig(["alpha"]);
    const { result } = renderCreationOptions();
    await waitFor(() => expect(result.current.providerOptions).toHaveLength(2));
    expect(
      result.current.providerOptions.map((option) => option.value),
    ).toEqual(["beta", "gamma"]);
    expect(result.current.selectedProviderId).toBe("beta");
    expect(result.current.hasMultipleProviders).toBe(true);
  });

  it("falls back from a hidden stored provider preference without rewriting it", async () => {
    window.localStorage.setItem("bb.promptbox.provider", "gamma");
    seedConfig(["gamma"]);
    const { result } = renderCreationOptions();
    await waitFor(() => expect(result.current.providerOptions).toHaveLength(2));
    expect(
      result.current.providerOptions.map((option) => option.value),
    ).toEqual(["alpha", "beta"]);
    expect(result.current.selectedProviderId).toBe("alpha");
    expect(window.localStorage.getItem("bb.promptbox.provider")).toBe("gamma");
  });

  it("keeps an existing thread's hidden provider selected in component-local scope", async () => {
    seedConfig(["gamma"]);
    const { result } = renderCreationOptions({
      scope: "component-local",
      initialProviderId: "gamma",
    });
    await waitFor(() => expect(result.current.providerOptions).toHaveLength(2));
    expect(
      result.current.providerOptions.map((option) => option.value),
    ).toEqual(["alpha", "beta"]);
    expect(result.current.selectedProviderId).toBe("gamma");
    expect(result.current.selectedProviderDisplayName).toBe("gamma");
  });

  it("keeps a hidden provider selectable when a component-local thread runs on it and it is restored", async () => {
    seedConfig([]);
    const { result } = renderCreationOptions({
      scope: "component-local",
      initialProviderId: "gamma",
    });
    await waitFor(() => expect(result.current.providerOptions).toHaveLength(3));
    expect(result.current.selectedProviderId).toBe("gamma");
  });

  it("resolves the first visible ready provider when the unset preference resolves", async () => {
    window.localStorage.removeItem("bb.promptbox.provider");
    seedConfig(["alpha"]);
    const { result } = renderCreationOptions({
      preferReadyProviderWhenUnset: true,
    });
    await waitFor(() => expect(result.current.selectedProviderId).toBe("beta"));
    expect(mocks.executionOptions).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "beta" }),
    );
  });

  it("restores the hidden provider once the setting clears", async () => {
    seedConfig(["gamma"]);
    const { result, queryClient } = renderCreationOptions();
    await waitFor(() => expect(result.current.providerOptions).toHaveLength(2));
    expect(
      result.current.providerOptions.map((option) => option.value),
    ).toEqual(["alpha", "beta"]);

    queryClient.setQueryData(
      systemConfigQueryKey(),
      makeSystemConfig({ generalSettings: defaultAppSettings }),
    );
    await waitFor(() => expect(result.current.providerOptions).toHaveLength(3));
    expect(
      result.current.providerOptions.map((option) => option.value),
    ).toEqual(["alpha", "beta", "gamma"]);
  });
});
