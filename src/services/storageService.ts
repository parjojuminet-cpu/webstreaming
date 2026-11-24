import {
  DELOKEN_SCHEMA_VERSION,
  INITIAL_ACTIVITY_LOGS,
  INITIAL_MEMBERSHIPS,
  INITIAL_PROJECTS,
  INITIAL_SETTINGS,
  INITIAL_TRANSACTIONS,
  INITIAL_USERS,
} from '../data/initialProjects';
import type {
  ActivityLog,
  DelokenStoreState,
  LanguageCode,
  Membership,
  PlatformSettings,
  Project,
  RoleMode,
  Transaction,
  UserAccount,
} from '../types/deloken';

export const STORAGE_KEYS = {
  projects: 'deloken_projects',
  users: 'deloken_users',
  transactions: 'deloken_transactions',
  memberships: 'deloken_memberships',
  settings: 'deloken_settings',
  activityLogs: 'deloken_activity_logs',
  uiPrefs: 'deloken_ui_prefs',
} as const;

interface StoredCollection<T> {
  schemaVersion: number;
  data: T;
}

interface UiPrefs {
  schemaVersion: number;
  activeRole: RoleMode;
  language: LanguageCode;
}

function safeParseCollection<T>(
  raw: string | null,
  fallback: T,
  validator: (value: unknown) => value is T
): { data: T; corrupted: boolean } {
  if (!raw) return { data: fallback, corrupted: false };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCollection<unknown>>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.schemaVersion === 'number' &&
      validator(parsed.data)
    ) {
      return { data: parsed.data, corrupted: false };
    }
    return { data: fallback, corrupted: true };
  } catch {
    return { data: fallback, corrupted: true };
  }
}

function safeWriteCollection<T>(key: string, data: T): void {
  try {
    const envelope: StoredCollection<T> = {
      schemaVersion: DELOKEN_SCHEMA_VERSION,
      data,
    };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch (err) {
    console.error(`Failed to write localStorage key "${key}":`, err);
  }
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isProjectsArray(v: unknown): v is Project[] {
  return (
    isArray(v) &&
    v.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as Project).id === 'string' &&
        typeof (item as Project).title === 'object' &&
        typeof (item as Project).pricing === 'object'
    )
  );
}

function isUsersArray(v: unknown): v is UserAccount[] {
  return (
    isArray(v) &&
    v.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as UserAccount).id === 'string' &&
        typeof (item as UserAccount).role === 'string'
    )
  );
}

function isTransactionsArray(v: unknown): v is Transaction[] {
  return (
    isArray(v) &&
    v.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as Transaction).id === 'string' &&
        typeof (item as Transaction).status === 'string'
    )
  );
}

function isMembershipsArray(v: unknown): v is Membership[] {
  return (
    isArray(v) &&
    v.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as Membership).id === 'string' &&
        typeof (item as Membership).status === 'string'
    )
  );
}

function isActivityLogsArray(v: unknown): v is ActivityLog[] {
  return (
    isArray(v) &&
    v.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as ActivityLog).id === 'string' &&
        typeof (item as ActivityLog).action === 'string'
    )
  );
}

function isSettingsObject(v: unknown): v is PlatformSettings {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    typeof (v as PlatformSettings).membershipPriceIdr === 'number' &&
    typeof (v as PlatformSettings).membershipPriceUsd === 'number'
  );
}

function isUiPrefs(v: unknown): v is UiPrefs {
  if (!v || typeof v !== 'object') return false;
  const prefs = v as UiPrefs;
  return (
    (prefs.activeRole === 'viewer' ||
      prefs.activeRole === 'creator' ||
      prefs.activeRole === 'admin') &&
    (prefs.language === 'id' || prefs.language === 'en')
  );
}

export function loadDelokenState(): DelokenStoreState {
  if (typeof window === 'undefined') {
    return {
      schemaVersion: DELOKEN_SCHEMA_VERSION,
      projects: INITIAL_PROJECTS,
      users: INITIAL_USERS,
      transactions: INITIAL_TRANSACTIONS,
      memberships: INITIAL_MEMBERSHIPS,
      settings: INITIAL_SETTINGS,
      activityLogs: INITIAL_ACTIVITY_LOGS,
      activeRole: 'viewer',
      language: 'id',
      storageWarning: null,
    };
  }

  const corruptedKeys: string[] = [];

  const projRes = safeParseCollection(
    window.localStorage.getItem(STORAGE_KEYS.projects),
    INITIAL_PROJECTS,
    isProjectsArray
  );
  if (projRes.corrupted) corruptedKeys.push(STORAGE_KEYS.projects);

  const userRes = safeParseCollection(
    window.localStorage.getItem(STORAGE_KEYS.users),
    INITIAL_USERS,
    isUsersArray
  );
  if (userRes.corrupted) corruptedKeys.push(STORAGE_KEYS.users);

  const txRes = safeParseCollection(
    window.localStorage.getItem(STORAGE_KEYS.transactions),
    INITIAL_TRANSACTIONS,
    isTransactionsArray
  );
  if (txRes.corrupted) corruptedKeys.push(STORAGE_KEYS.transactions);

  const memRes = safeParseCollection(
    window.localStorage.getItem(STORAGE_KEYS.memberships),
    INITIAL_MEMBERSHIPS,
    isMembershipsArray
  );
  if (memRes.corrupted) corruptedKeys.push(STORAGE_KEYS.memberships);

  const setRes = safeParseCollection(
    window.localStorage.getItem(STORAGE_KEYS.settings),
    INITIAL_SETTINGS,
    isSettingsObject
  );
  if (setRes.corrupted) corruptedKeys.push(STORAGE_KEYS.settings);

  const logRes = safeParseCollection(
    window.localStorage.getItem(STORAGE_KEYS.activityLogs),
    INITIAL_ACTIVITY_LOGS,
    isActivityLogsArray
  );
  if (logRes.corrupted) corruptedKeys.push(STORAGE_KEYS.activityLogs);

  const defaultPrefs: UiPrefs = {
    schemaVersion: DELOKEN_SCHEMA_VERSION,
    activeRole: 'viewer',
    language: 'id',
  };
  let uiPrefs = defaultPrefs;
  const rawPrefs = window.localStorage.getItem(STORAGE_KEYS.uiPrefs);
  if (rawPrefs) {
    try {
      const parsed = JSON.parse(rawPrefs);
      if (isUiPrefs(parsed)) {
        uiPrefs = parsed;
      } else {
        corruptedKeys.push(STORAGE_KEYS.uiPrefs);
      }
    } catch {
      corruptedKeys.push(STORAGE_KEYS.uiPrefs);
    }
  }

  // Persist defaults on first load or auto-repair corrupted keys
  const state: DelokenStoreState = {
    schemaVersion: DELOKEN_SCHEMA_VERSION,
    projects: projRes.data.length > 0 ? projRes.data : INITIAL_PROJECTS,
    users: userRes.data.length > 0 ? userRes.data : INITIAL_USERS,
    transactions: txRes.data,
    memberships: memRes.data,
    settings: setRes.data,
    activityLogs: logRes.data,
    activeRole: uiPrefs.activeRole,
    language: uiPrefs.language,
    storageWarning:
      corruptedKeys.length > 0
        ? `Corrupted localStorage entries repaired automatically: ${corruptedKeys.join(', ')}`
        : null,
  };

  persistDelokenState(state);
  return state;
}

export function persistDelokenState(state: DelokenStoreState): void {
  if (typeof window === 'undefined') return;
  safeWriteCollection(STORAGE_KEYS.projects, state.projects);
  safeWriteCollection(STORAGE_KEYS.users, state.users);
  safeWriteCollection(STORAGE_KEYS.transactions, state.transactions);
  safeWriteCollection(STORAGE_KEYS.memberships, state.memberships);
  safeWriteCollection(STORAGE_KEYS.settings, state.settings);
  safeWriteCollection(STORAGE_KEYS.activityLogs, state.activityLogs);
  try {
    const prefs: UiPrefs = {
      schemaVersion: DELOKEN_SCHEMA_VERSION,
      activeRole: state.activeRole,
      language: state.language,
    };
    window.localStorage.setItem(STORAGE_KEYS.uiPrefs, JSON.stringify(prefs));
  } catch (err) {
    console.error('Failed to persist uiPrefs:', err);
  }
}

export function resetDelokenDemoData(
  currentRole: RoleMode = 'viewer',
  currentLanguage: LanguageCode = 'id'
): DelokenStoreState {
  const freshState: DelokenStoreState = {
    schemaVersion: DELOKEN_SCHEMA_VERSION,
    projects: INITIAL_PROJECTS,
    users: INITIAL_USERS,
    transactions: [],
    memberships: [],
    settings: INITIAL_SETTINGS,
    activityLogs: [
      {
        id: `log_reset_${Date.now()}`,
        actorId: 'usr_admin_demo',
        actorName: 'Kurator DELOKEN',
        action: 'demo_reset',
        entityId: 'system',
        timestamp: new Date().toISOString(),
        details: 'Prototype demo data reset to initial 3 curated projects.',
      },
      ...INITIAL_ACTIVITY_LOGS,
    ],
    activeRole: currentRole,
    language: currentLanguage,
    storageWarning: null,
  };
  persistDelokenState(freshState);
  return freshState;
}
