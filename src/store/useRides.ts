import { create } from 'zustand';
import { db } from '@/services/db';
import { newId } from '@/lib/geo';
import * as cloud from '@/services/cloud';
import type { RiddenTrack, SavedRoute } from '@/types';

export type NewRoute = Omit<SavedRoute, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string };
export type NewTrack = Omit<RiddenTrack, 'id' | 'userId'> & { id?: string };

export interface RidesState {
  routes: SavedRoute[];
  tracks: RiddenTrack[];
  loaded: boolean;
  userId: string | null;
  /** true zolang de cloud-synchronisatie na het laden nog loopt. */
  syncing: boolean;
  load(userId: string): Promise<void>;
  clear(): void;
  saveRoute(input: NewRoute): Promise<SavedRoute>;
  renameRoute(id: string, name: string): Promise<void>;
  deleteRoute(id: string): Promise<void>;
  saveTrack(input: NewTrack): Promise<RiddenTrack>;
  renameTrack(id: string, name: string): Promise<void>;
  deleteTrack(id: string): Promise<void>;
  getRoute(id: string): SavedRoute | undefined;
  getTrack(id: string): RiddenTrack | undefined;
}

const byUpdatedDesc = (a: SavedRoute, b: SavedRoute): number => b.updatedAt - a.updatedAt;
const byStartedDesc = (a: RiddenTrack, b: RiddenTrack): number => b.startedAt - a.startedAt;

function requireUserId(userId: string | null): string {
  if (!userId) throw new Error('Niet ingelogd');
  return userId;
}

/**
 * Voegt lokale en cloudrijen samen: unie op id; bij routes wint de nieuwste updatedAt.
 * Geeft ook terug wat alleen lokaal bestond (moet naar de cloud) en wat uit de cloud kwam (naar IndexedDB).
 */
export function mergeRoutes(local: SavedRoute[], remote: SavedRoute[]): { merged: SavedRoute[]; toCloud: SavedRoute[]; toLocal: SavedRoute[] } {
  const byId = new Map<string, SavedRoute>();
  for (const r of local) byId.set(r.id, r);
  const toLocal: SavedRoute[] = [];
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.updatedAt > l.updatedAt) {
      byId.set(r.id, r);
      toLocal.push(r);
    }
  }
  const remoteIds = new Map(remote.map((r) => [r.id, r.updatedAt] as const));
  const toCloud = [...byId.values()].filter((r) => {
    const remoteUpdated = remoteIds.get(r.id);
    return remoteUpdated === undefined || r.updatedAt > remoteUpdated;
  });
  return { merged: [...byId.values()].sort(byUpdatedDesc), toCloud, toLocal };
}

export function mergeTracks(local: RiddenTrack[], remote: RiddenTrack[]): { merged: RiddenTrack[]; toCloud: RiddenTrack[]; toLocal: RiddenTrack[] } {
  const byId = new Map<string, RiddenTrack>();
  for (const t of local) byId.set(t.id, t);
  const toLocal: RiddenTrack[] = [];
  for (const t of remote) {
    if (!byId.has(t.id)) {
      byId.set(t.id, t);
      toLocal.push(t);
    }
  }
  const remoteIds = new Set(remote.map((t) => t.id));
  const toCloud = local.filter((t) => !remoteIds.has(t.id));
  return { merged: [...byId.values()].sort(byStartedDesc), toCloud, toLocal };
}

export const useRides = create<RidesState>((set, get) => ({
  routes: [],
  tracks: [],
  loaded: false,
  userId: null,
  syncing: false,

  async load(userId) {
    const [routes, tracks] = await Promise.all([
      db.routes.where('userId').equals(userId).toArray(),
      db.tracks.where('userId').equals(userId).toArray(),
    ]);
    routes.sort(byUpdatedDesc);
    tracks.sort(byStartedDesc);
    set({ routes, tracks, loaded: true, userId });

    if (!cloud.cloudEnabledFor(userId)) return;
    set({ syncing: true });
    try {
      const [remoteRoutes, remoteTracks] = await Promise.all([cloud.pullRoutes(userId), cloud.pullTracks(userId)]);
      if (get().userId !== userId) return; // intussen uitgelogd
      const r = mergeRoutes(get().routes, remoteRoutes);
      const t = mergeTracks(get().tracks, remoteTracks);
      if (r.toLocal.length) await db.routes.bulkPut(r.toLocal);
      if (t.toLocal.length) await db.tracks.bulkPut(t.toLocal);
      set({ routes: r.merged, tracks: t.merged });
      await Promise.all([cloud.pushRoutes(r.toCloud), cloud.pushTracks(t.toCloud)]);
    } catch (err) {
      console.warn('Cloud-sync mislukt (laden)', err);
    } finally {
      set({ syncing: false });
    }
  },

  clear() {
    set({ routes: [], tracks: [], loaded: false, userId: null, syncing: false });
  },

  async saveRoute(input) {
    const userId = requireUserId(get().userId);
    const id = input.id ?? newId();
    const existing = get().routes.find((r) => r.id === id) ?? (await db.routes.get(id));
    const now = Date.now();
    const route: SavedRoute = {
      ...input,
      id,
      userId,
      createdAt: existing && existing.userId === userId ? existing.createdAt : now,
      updatedAt: now,
    };
    await db.routes.put(route);
    set({ routes: [route, ...get().routes.filter((r) => r.id !== id)].sort(byUpdatedDesc) });
    if (cloud.cloudEnabledFor(userId)) cloud.background('route opslaan', () => cloud.pushRoute(route));
    return route;
  },

  async renameRoute(id, name) {
    const current = get().routes.find((r) => r.id === id) ?? (await db.routes.get(id));
    if (!current) return;
    const route: SavedRoute = { ...current, name: name.trim() || current.name, updatedAt: Date.now() };
    await db.routes.put(route);
    set({ routes: [route, ...get().routes.filter((r) => r.id !== id)].sort(byUpdatedDesc) });
    if (cloud.cloudEnabledFor(route.userId)) cloud.background('route hernoemen', () => cloud.pushRoute(route));
  },

  async deleteRoute(id) {
    await db.routes.delete(id);
    set({ routes: get().routes.filter((r) => r.id !== id) });
    if (cloud.cloudEnabledFor(get().userId)) cloud.background('route verwijderen', () => cloud.removeRoute(id));
  },

  async saveTrack(input) {
    const userId = requireUserId(get().userId);
    const id = input.id ?? newId();
    const track: RiddenTrack = { ...input, id, userId };
    await db.tracks.put(track);
    set({ tracks: [track, ...get().tracks.filter((t) => t.id !== id)].sort(byStartedDesc) });
    if (cloud.cloudEnabledFor(userId)) cloud.background('rit opslaan', () => cloud.pushTrack(track));
    return track;
  },

  async renameTrack(id, name) {
    const current = get().tracks.find((t) => t.id === id) ?? (await db.tracks.get(id));
    if (!current) return;
    const track: RiddenTrack = { ...current, name: name.trim() || current.name };
    await db.tracks.put(track);
    set({ tracks: [track, ...get().tracks.filter((t) => t.id !== id)].sort(byStartedDesc) });
    if (cloud.cloudEnabledFor(track.userId)) cloud.background('rit hernoemen', () => cloud.pushTrack(track));
  },

  async deleteTrack(id) {
    await db.tracks.delete(id);
    set({ tracks: get().tracks.filter((t) => t.id !== id) });
    if (cloud.cloudEnabledFor(get().userId)) cloud.background('rit verwijderen', () => cloud.removeTrack(id));
  },

  getRoute(id) {
    return get().routes.find((r) => r.id === id);
  },

  getTrack(id) {
    return get().tracks.find((t) => t.id === id);
  },
}));
