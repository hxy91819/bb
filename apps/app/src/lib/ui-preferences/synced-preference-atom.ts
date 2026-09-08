import { atom, type SetStateAction, type WritableAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  getUiPreferenceDefault,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import type { SyncStorage } from "../browser-storage";
import {
  registerSyncedUiPreference,
  scheduleUiPreferenceWrite,
} from "./ui-preferences-sync";

export interface SyncedPreferenceAtomOptions<Key extends UiPreferenceKey> {
  debounceMs?: number;
  key: Key;
  storage: SyncStorage<UiPreferenceValue<Key>>;
  storageKey: string;
}

export type SyncedPreferenceAtom<Key extends UiPreferenceKey> = WritableAtom<
  UiPreferenceValue<Key>,
  [SetStateAction<UiPreferenceValue<Key>>],
  void
>;

export function createSyncedPreferenceAtom<Key extends UiPreferenceKey>({
  debounceMs = 0,
  key,
  storage,
  storageKey,
}: SyncedPreferenceAtomOptions<Key>): SyncedPreferenceAtom<Key> {
  const mirrorAtom = atomWithStorage<UiPreferenceValue<Key>>(
    storageKey,
    getUiPreferenceDefault(key),
    storage,
    { getOnInit: true },
  );
  registerSyncedUiPreference(key, { debounceMs, mirrorAtom });
  return atom(
    (get) => get(mirrorAtom),
    (get, set, update: SetStateAction<UiPreferenceValue<Key>>) => {
      const previous = get(mirrorAtom);
      set(mirrorAtom, typeof update === "function" ? update(previous) : update);
      scheduleUiPreferenceWrite(key, update);
    },
  );
}
