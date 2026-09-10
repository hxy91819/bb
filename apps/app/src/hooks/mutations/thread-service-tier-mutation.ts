import type { ServiceTier } from "@bb/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { applyThreadServiceTierResult } from "../cache-owners/thread-state-cache-owner";
import { usePromptBoxServiceTierPreference } from "../thread-creation-options/persisted-selection-fields";

interface UpdateThreadServiceTierRequest {
  threadId: string;
  serviceTier: ServiceTier;
}

export function useUpdateThreadServiceTier(threadId: string) {
  const queryClient = useQueryClient();
  const { setValue: setPreferredServiceTier } =
    usePromptBoxServiceTierPreference();
  return useMutation({
    scope: { id: `thread-service-tier:${threadId}` },
    meta: { errorMessage: "Failed to update fast mode." },
    mutationFn: async (request: UpdateThreadServiceTierRequest) => {
      await sdk.threads.update(request);
      setPreferredServiceTier(request.serviceTier);
      return sdk.threads.defaultExecutionOptions({
        threadId: request.threadId,
      });
    },
    onSuccess: (executionOptions, request) =>
      applyThreadServiceTierResult({
        queryClient,
        threadId: request.threadId,
        executionOptions,
      }),
  });
}
