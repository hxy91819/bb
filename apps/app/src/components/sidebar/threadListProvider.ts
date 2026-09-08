import { useAtomValue } from "jotai";
import {
  createSyncedReplacementPreferenceAtom,
  resolvePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

const THREAD_LIST_PROVIDER_STORAGE_KEY = "bb.sidebar.threadListProvider";

export const threadListProviderAtom = createSyncedReplacementPreferenceAtom(
  THREAD_LIST_PROVIDER_STORAGE_KEY,
  "sidebar.threadListProvider",
);

export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  return resolvePreferredReplacement(threadLists, preference);
}
