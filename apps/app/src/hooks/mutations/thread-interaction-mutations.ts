import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PendingInteraction } from "@bb/domain";
import type { ResolvePendingInteractionRequest } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { useAcceptedThreadWorkPromotion } from "@/hooks/useAcceptedThreadWorkPromotion";
import { invalidateThreadPendingInteractionResolutionQueries } from "../cache-owners/mutation-cache-effects";

interface ResolveThreadPendingInteractionMutationRequest {
  threadId: string;
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
}

export function useResolveThreadPendingInteraction() {
  const queryClient = useQueryClient();
  const promoteAcceptedThreadWork = useAcceptedThreadWorkPromotion();

  return useMutation({
    meta: {
      errorMessage: "Failed to resolve pending interaction.",
      showErrorToast: false,
    },
    mutationFn: ({
      threadId,
      interactionId,
      resolution,
    }: ResolveThreadPendingInteractionMutationRequest): Promise<PendingInteraction> =>
      sdk.threads.interactions.resolve({
        interactionId,
        resolution,
        threadId,
      }),
    onSuccess: (interaction, variables) => {
      promoteAcceptedThreadWork({ threadId: variables.threadId });
      invalidateThreadPendingInteractionResolutionQueries({
        queryClient,
        threadId: variables.threadId,
      });
      return interaction;
    },
  });
}
