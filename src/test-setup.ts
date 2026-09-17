// Vitest setup: IndexedDB polyfill voor Dexie-tests in Node, en geen echte Supabase in tests
// (anders zou .env de tests naar het productieproject laten praten).
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', '');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
