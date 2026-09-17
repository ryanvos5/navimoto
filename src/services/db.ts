// Lokale opslag (IndexedDB via Dexie v4). Alle domeindata van Navimoto staat hier.
import Dexie, { type Table } from 'dexie';
import type { RiddenTrack, SavedRoute, UserProfile } from '@/types';

/** Lokaal account (alleen gebruikt door de LocalAuthProvider). */
export interface LocalUser {
  id: string;
  email: string; // altijd lowercase en getrimd
  displayName: string;
  passwordHash: string; // base64 (PBKDF2-SHA256, 32 bytes)
  salt: string; // base64 (16 bytes)
  iterations: number;
  createdAt: number; // epoch ms
}

/** Sleutel/waarde-opslag; wordt gebruikt als vervanging van localStorage (bijv. in Node/tests). */
export interface KvEntry {
  key: string;
  value: string;
}

export class NavimotoDb extends Dexie {
  profiles!: Table<UserProfile, string>;
  routes!: Table<SavedRoute, string>;
  tracks!: Table<RiddenTrack, string>;
  localUsers!: Table<LocalUser, string>;
  kv!: Table<KvEntry, string>;

  constructor() {
    super('navimoto');
    this.version(1).stores({
      profiles: 'id',
      routes: 'id, userId, updatedAt',
      tracks: 'id, userId, startedAt',
      localUsers: 'id, &email',
      kv: 'key',
    });
  }
}

export const db = new NavimotoDb();

// ---------------------------------------------------------------------------
// Kleine persistente sleutel/waarde-laag: localStorage in de browser, anders de kv-tabel.
// localStorage-sleutels krijgen het voorvoegsel 'navimoto.', kv-sleutels niet.
// ---------------------------------------------------------------------------

const LS_PREFIX = 'navimoto.';

function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch {
    // Toegang tot localStorage kan een SecurityError geven (bijv. geblokkeerde cookies).
    return null;
  }
}

/** Leest `navimoto.<key>` uit localStorage, of `<key>` uit de kv-tabel als localStorage ontbreekt. */
export async function storageGet(key: string): Promise<string | null> {
  const ls = getLocalStorage();
  if (ls) {
    try {
      return ls.getItem(LS_PREFIX + key);
    } catch {
      // val terug op de kv-tabel
    }
  }
  const entry = await db.kv.get(key);
  return entry ? entry.value : null;
}

export async function storageSet(key: string, value: string): Promise<void> {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.setItem(LS_PREFIX + key, value);
      return;
    } catch {
      // val terug op de kv-tabel (bijv. quota overschreden)
    }
  }
  await db.kv.put({ key, value });
}

export async function storageRemove(key: string): Promise<void> {
  const ls = getLocalStorage();
  if (ls) {
    try {
      ls.removeItem(LS_PREFIX + key);
    } catch {
      // negeren
    }
  }
  await db.kv.delete(key);
}
