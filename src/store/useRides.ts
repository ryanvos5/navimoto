import { create } from 'zustand';
import { db } from '@/services/db';
import { newId } from '@/lib/geo';
import type { RiddenTrack, SavedRoute } from '@/types';

export type NewRoute = Omit<SavedRoute, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string };
export type NewTrack = Omit<RiddenTrack, 'id' | 'userId'> & { id?: string };

export interface RidesState {
  routes: SavedRoute[];
  tracks: RiddenTrack[];
  loaded: boolean;
  userId: string | null;
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

export const useRides = create<RidesState>((set, get) => ({
  routes: [],
  tracks: [],
  loaded: false,
  userId: null,

  async load(userId) {
    const [routes, tracks] = await Promise.all([
      db.routes.where('userId').equals(userId).toArray(),
      db.tracks.where('userId').equals(userId).toArray(),
    ]);
    routes.sort(byUpdatedDesc);
    tracks.sort(byStartedDesc);
    set({ routes, tracks, loaded: true, userId });
  },

  clear() {
    set({ routes: [], tracks: [], loaded: false, userId: null });
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
    return route;
  },

  async renameRoute(id, name) {
    const current = get().routes.find((r) => r.id === id) ?? (await db.routes.get(id));
    if (!current) return;
    const route: SavedRoute = { ...current, name: name.trim() || current.name, updatedAt: Date.now() };
    await db.routes.put(route);
    set({ routes: [route, ...get().routes.filter((r) => r.id !== id)].sort(byUpdatedDesc) });
  },

  async deleteRoute(id) {
    await db.routes.delete(id);
    set({ routes: get().routes.filter((r) => r.id !== id) });
  },

  async saveTrack(input) {
    const userId = requireUserId(get().userId);
    const id = input.id ?? newId();
    const track: RiddenTrack = { ...input, id, userId };
    await db.tracks.put(track);
    set({ tracks: [track, ...get().tracks.filter((t) => t.id !== id)].sort(byStartedDesc) });
    return track;
  },

  async renameTrack(id, name) {
    const current = get().tracks.find((t) => t.id === id) ?? (await db.tracks.get(id));
    if (!current) return;
    const track: RiddenTrack = { ...current, name: name.trim() || current.name };
    await db.tracks.put(track);
    set({ tracks: [track, ...get().tracks.filter((t) => t.id !== id)].sort(byStartedDesc) });
  },

  async deleteTrack(id) {
    await db.tracks.delete(id);
    set({ tracks: get().tracks.filter((t) => t.id !== id) });
  },

  getRoute(id) {
    return get().routes.find((r) => r.id === id);
  },

  getTrack(id) {
    return get().tracks.find((t) => t.id === id);
  },
}));
