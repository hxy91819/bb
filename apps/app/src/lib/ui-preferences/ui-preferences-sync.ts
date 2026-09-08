import type { QueryClient } from "@tanstack/react-query";
import type { SetStateAction, WritableAtom } from "jotai";
import { getDefaultStore } from "jotai";
import {
  getUiPreferenceDefault,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import type { UiPreferencesResponse } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import {
  getCachedUiPreferences,
  invalidateCachedUiPreferences,
  setCachedUiPreferences,
} from "@/hooks/cache-owners/ui-preferences-cache-owner";
import { BbHttpError, sdk } from "../sdk";

type JotaiStore = ReturnType<typeof getDefaultStore>;

type MirrorAtom<Key extends UiPreferenceKey> = WritableAtom<
  UiPreferenceValue<Key>,
  [SetStateAction<UiPreferenceValue<Key>>],
  void
>;

interface RegisteredPreference<Key extends UiPreferenceKey> {
  debounceMs: number;
  mirrorAtom: MirrorAtom<Key>;
}

interface PreferenceOperation<Key extends UiPreferenceKey> {
  source: "migration" | "user";
  update: SetStateAction<UiPreferenceValue<Key>>;
}

interface PendingWrite<Key extends UiPreferenceKey> {
  operations: PreferenceOperation<Key>[];
}

interface PreferenceSyncState<Key extends UiPreferenceKey> {
  inFlight: Promise<void> | null;
  migrationAttempted: boolean;
  pending: PendingWrite<Key> | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface UiPreferencesSyncContext {
  queryClient: QueryClient;
  store: JotaiStore;
}

interface ServerEntry<Key extends UiPreferenceKey> {
  revision: number;
  value: UiPreferenceValue<Key>;
}

const registry = new Map<
  UiPreferenceKey,
  RegisteredPreference<UiPreferenceKey>
>();
const syncStates = new Map<
  UiPreferenceKey,
  PreferenceSyncState<UiPreferenceKey>
>();
let context: UiPreferencesSyncContext | null = null;
let syncFailureNotified = false;

function getSyncState<Key extends UiPreferenceKey>(
  key: Key,
): PreferenceSyncState<Key> {
  let state = syncStates.get(key);
  if (state === undefined) {
    state = {
      inFlight: null,
      migrationAttempted: false,
      pending: null,
      timer: null,
    };
    syncStates.set(key, state);
  }
  return state as PreferenceSyncState<Key>;
}

function getRegistered<Key extends UiPreferenceKey>(
  key: Key,
): RegisteredPreference<Key> | undefined {
  return registry.get(key) as RegisteredPreference<Key> | undefined;
}

export function areUiPreferenceValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyUpdate<Key extends UiPreferenceKey>(
  update: SetStateAction<UiPreferenceValue<Key>>,
  previous: UiPreferenceValue<Key>,
): UiPreferenceValue<Key> {
  return typeof update === "function" ? update(previous) : update;
}

function applyOperations<Key extends UiPreferenceKey>(
  operations: readonly PreferenceOperation<Key>[],
  base: UiPreferenceValue<Key>,
): UiPreferenceValue<Key> {
  return operations.reduce(
    (value, operation) => applyUpdate(operation.update, value),
    base,
  );
}

function composeOperation<Key extends UiPreferenceKey>(
  operations: readonly PreferenceOperation<Key>[],
  operation: PreferenceOperation<Key>,
): PreferenceOperation<Key>[] {
  return typeof operation.update === "function"
    ? [...operations, operation]
    : [operation];
}

export function registerSyncedUiPreference<Key extends UiPreferenceKey>(
  key: Key,
  registration: RegisteredPreference<Key>,
): void {
  registry.set(key, registration as RegisteredPreference<UiPreferenceKey>);
}

export function startUiPreferencesSync(
  nextContext: UiPreferencesSyncContext,
): () => void {
  context = nextContext;
  const cached = getCachedUiPreferences(nextContext.queryClient);
  if (cached !== undefined) reconcileUiPreferences(cached);
  return () => {
    if (context === nextContext) context = null;
  };
}

export function hasPendingUiPreferenceWrite(key: UiPreferenceKey): boolean {
  const state = syncStates.get(key);
  return (
    state !== undefined && (state.pending !== null || state.inFlight !== null)
  );
}

export function reconcileUiPreferences(response: UiPreferencesResponse): void {
  if (context === null) return;
  for (const [key, registration] of registry) {
    reconcileUiPreference(context, key, registration, response);
  }
}

function adoptServerEntry<Key extends UiPreferenceKey>(
  activeContext: UiPreferencesSyncContext,
  registration: RegisteredPreference<Key>,
  entry: ServerEntry<Key>,
): void {
  const local = activeContext.store.get(registration.mirrorAtom);
  if (areUiPreferenceValuesEqual(local, entry.value)) return;
  activeContext.store.set(registration.mirrorAtom, entry.value);
}

function reconcileUiPreference<Key extends UiPreferenceKey>(
  activeContext: UiPreferencesSyncContext,
  key: Key,
  registration: RegisteredPreference<Key>,
  response: UiPreferencesResponse,
): void {
  const state = getSyncState(key);
  if (state.pending !== null || state.inFlight !== null) return;
  const entry = response.preferences[key];
  if (entry.revision === 0) {
    const local = activeContext.store.get(registration.mirrorAtom);
    if (
      state.migrationAttempted ||
      areUiPreferenceValuesEqual(local, getUiPreferenceDefault(key))
    ) {
      return;
    }
    state.migrationAttempted = true;
    state.pending = { operations: [{ source: "migration", update: local }] };
    void flushUiPreference(key);
    return;
  }
  adoptServerEntry(activeContext, registration, entry);
}

function reconcileUiPreferenceFromCache<Key extends UiPreferenceKey>(
  activeContext: UiPreferencesSyncContext,
  key: Key,
): void {
  const registration = getRegistered(key);
  const cached = getCachedUiPreferences(activeContext.queryClient);
  if (registration === undefined || cached === undefined) return;
  const entry = cached.preferences[key];
  if (entry.revision === 0) return;
  adoptServerEntry(activeContext, registration, entry);
}

export function scheduleUiPreferenceWrite<Key extends UiPreferenceKey>(
  key: Key,
  update: SetStateAction<UiPreferenceValue<Key>>,
): void {
  if (context === null) return;
  const state = getSyncState(key);
  state.pending = {
    operations: composeOperation(state.pending?.operations ?? [], {
      source: "user",
      update,
    }),
  };
  if (state.inFlight !== null) return;
  const debounceMs = getRegistered(key)?.debounceMs ?? 0;
  if (state.timer !== null) clearTimeout(state.timer);
  if (debounceMs <= 0) {
    void flushUiPreference(key);
    return;
  }
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushUiPreference(key);
  }, debounceMs);
}

async function readCurrentUiPreferences(
  queryClient: QueryClient,
): Promise<UiPreferencesResponse> {
  const cached = getCachedUiPreferences(queryClient);
  if (cached !== undefined) return cached;
  return refetchUiPreferences(queryClient);
}

async function refetchUiPreferences(
  queryClient: QueryClient,
): Promise<UiPreferencesResponse> {
  const response = await sdk.system.uiPreferences.list();
  setCachedUiPreferences(queryClient, response);
  return response;
}

function isUiPreferenceConflict(error: unknown): boolean {
  return error instanceof BbHttpError && error.status === 409;
}

function recordServerEntry<Key extends UiPreferenceKey>(
  queryClient: QueryClient,
  key: Key,
  entry: ServerEntry<Key>,
): void {
  const cached = getCachedUiPreferences(queryClient);
  if (
    cached === undefined ||
    cached.preferences[key].revision >= entry.revision
  ) {
    return;
  }
  setCachedUiPreferences(queryClient, {
    preferences: { ...cached.preferences, [key]: entry },
  });
}

async function putUiPreference<Key extends UiPreferenceKey>(
  queryClient: QueryClient,
  key: Key,
  base: ServerEntry<Key>,
  operations: readonly PreferenceOperation<Key>[],
): Promise<"written" | "unchanged" | "conflict"> {
  const value = applyOperations(operations, base.value);
  if (areUiPreferenceValuesEqual(value, base.value)) return "unchanged";
  try {
    const response = await sdk.system.uiPreferences.set({
      expectedRevision: base.revision,
      key,
      value,
    });
    recordServerEntry(queryClient, key, {
      revision: response.revision,
      value: response.value,
    });
    return "written";
  } catch (error) {
    if (isUiPreferenceConflict(error)) return "conflict";
    throw error;
  }
}

async function writeUiPreference<Key extends UiPreferenceKey>(
  activeContext: UiPreferencesSyncContext,
  key: Key,
  write: PendingWrite<Key>,
): Promise<void> {
  const { queryClient } = activeContext;
  const current = await readCurrentUiPreferences(queryClient);
  const base = current.preferences[key];
  const userOperations = write.operations.filter(
    (operation) => operation.source === "user",
  );
  if (userOperations.length === 0 && base.revision !== 0) return;
  const first = await putUiPreference(queryClient, key, base, write.operations);
  if (first !== "conflict") return;
  const fresh = await refetchUiPreferences(queryClient);
  if (userOperations.length === 0) return;
  const retry = await putUiPreference(
    queryClient,
    key,
    fresh.preferences[key],
    userOperations,
  );
  if (retry === "conflict") await refetchUiPreferences(queryClient);
}

function notifySyncFailure(error: unknown): void {
  if (syncFailureNotified) return;
  syncFailureNotified = true;
  appToast.error("Couldn’t sync sidebar preferences", {
    description:
      error instanceof Error ? error.message : "Changes stay on this device.",
  });
}

async function flushUiPreference<Key extends UiPreferenceKey>(
  key: Key,
): Promise<void> {
  const activeContext = context;
  const state = getSyncState(key);
  const write = state.pending;
  if (activeContext === null || write === null || state.inFlight !== null) {
    return;
  }
  state.pending = null;
  let failed = false;
  const run = writeUiPreference(activeContext, key, write)
    .catch((error: unknown) => {
      failed = true;
      notifySyncFailure(error);
      invalidateCachedUiPreferences(activeContext.queryClient);
    })
    .finally(() => {
      state.inFlight = null;
      if (state.pending !== null) {
        void flushUiPreference(key);
        return;
      }
      if (!failed) reconcileUiPreferenceFromCache(activeContext, key);
    });
  state.inFlight = run;
  await run;
}

export async function waitForUiPreferenceWrites(): Promise<void> {
  let settled = false;
  while (!settled) {
    settled = true;
    for (const state of syncStates.values()) {
      if (state.inFlight !== null) {
        settled = false;
        await state.inFlight;
      }
    }
  }
}

export function resetUiPreferencesSyncForTest(): void {
  for (const state of syncStates.values()) {
    if (state.timer !== null) clearTimeout(state.timer);
  }
  syncStates.clear();
  context = null;
  syncFailureNotified = false;
}
