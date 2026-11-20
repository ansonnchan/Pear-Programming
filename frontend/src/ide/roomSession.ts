import type { RoomSessionState } from '../types';

const ROOM_SESSION_STORAGE_KEY = 'pearprogram-room-session';
const CONNECTION_SESSION_STORAGE_KEY = 'pearprogram-connection-session';

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export function getJoinCode() {
  const match = window.location.pathname.match(/^\/(?:join|room)\/([^/]+)/);
  return match?.[1] ?? null;
}

export function getOrCreateConnectionId() {
  const stored = sessionStorage.getItem(CONNECTION_SESSION_STORAGE_KEY);
  if (stored) {
    return stored;
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(CONNECTION_SESSION_STORAGE_KEY, id);
  return id;
}

export function loadRoomSession(): RoomSessionState | null {
  const stored = sessionStorage.getItem(ROOM_SESSION_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored) as RoomSessionState;
    return parsed.room?.code ? parsed : null;
  } catch {
    sessionStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    return null;
  }
}

// sessionStorage is usually limited to about 5 MB per origin, so large workspaces keep only room
// metadata and reload file contents from the server.
export const MAX_SESSION_FILE_CONTENT_CHARS = 1_000_000;

export function persistRoomSession(state: RoomSessionState) {
  const contentChars = state.files.reduce((total, file) => total + (file.content?.length ?? 0), 0);
  const snapshot = contentChars > MAX_SESSION_FILE_CONTENT_CHARS ? withoutFiles(state) : state;
  try {
    sessionStorage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    try {
      sessionStorage.setItem(ROOM_SESSION_STORAGE_KEY, JSON.stringify(withoutFiles(state)));
    } catch {
      sessionStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
    }
  }
}

function withoutFiles(state: RoomSessionState): RoomSessionState {
  return { ...state, files: [], filesOmitted: true };
}

export function clearRoomSession() {
  sessionStorage.removeItem(ROOM_SESSION_STORAGE_KEY);
}

export function buildWakeUrl(baseUrl: string, path: string) {
  try {
    const url = new URL(baseUrl);
    const currentPath = url.pathname.replace(/\/+$/, '');
    const basePath = currentPath === '/health' || currentPath === '/healthz' ? '' : currentPath;
    url.pathname = `${basePath}/${path.replace(/^\/+/, '')}`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function isValidRoomCode(value: string) {
  return /^[A-Z0-9]{6}$/.test(value);
}

export function formatPacificTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short'
  }).format(new Date(value));
}

export function saveStatusText(state: SaveState, lastSavedAt: string | null) {
  if (state === 'saving') return 'Autosaving...';
  if (state === 'saved') return lastSavedAt ? `Autosaved ${formatPacificTime(lastSavedAt)}` : 'Autosaved';
  if (state === 'offline') return 'Local changes';
  if (state === 'error') return 'Autosave retrying';
  return 'Autosave ready';
}
