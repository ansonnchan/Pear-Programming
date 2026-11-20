import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomSessionState } from '../types';
import {
  buildWakeUrl,
  isValidRoomCode,
  loadRoomSession,
  MAX_SESSION_FILE_CONTENT_CHARS,
  normalizeRoomCode,
  persistRoomSession
} from './roomSession';

function sessionWithContent(content: string): RoomSessionState {
  return {
    room: {
      code: 'PEAR12', workspaceId: 'workspace-1', active: true, createdAt: '2026-07-15T00:00:00Z',
      memberCount: 1, maxUsers: 5, locked: false, leadUserId: 'user-1'
    },
    files: [{
      id: 'file-1', workspaceId: 'workspace-1', path: 'main.py', language: 'python', content,
      createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z'
    }],
    openFileIds: ['file-1'],
    activeFileId: 'file-1',
    expandedFolderPaths: [],
    cursorPosition: { line: 1, col: 1 },
    roomLocked: false,
    leadUserId: 'user-1',
    chatOpen: true,
    explorerOpen: true,
    landingCode: 'PEAR12',
    chatDraft: ''
  };
}

describe('room session helpers', () => {
  it('normalizes shared room links consistently', () => {
    expect(normalizeRoomCode(' abc-123 ')).toBe('ABC123');
    expect(isValidRoomCode('ABC123')).toBe(true);
    expect(isValidRoomCode('ABC12')).toBe(false);
  });

  it('replaces an existing health path when building a wake URL', () => {
    expect(buildWakeUrl('https://api.example.test/healthz', '/healthz')).toBe('https://api.example.test/healthz');
    expect(buildWakeUrl('https://api.example.test/base', '/healthz')).toBe('https://api.example.test/base/healthz');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('keeps small workspaces with their file contents', () => {
    persistRoomSession(sessionWithContent('print(1)'));
    expect(loadRoomSession()?.files[0].content).toBe('print(1)');
    expect(loadRoomSession()?.filesOmitted).toBeUndefined();
  });

  it('stores only room metadata for workspaces too large for sessionStorage', () => {
    persistRoomSession(sessionWithContent('x'.repeat(MAX_SESSION_FILE_CONTENT_CHARS + 1)));
    const restored = loadRoomSession();
    expect(restored?.files).toEqual([]);
    expect(restored?.filesOmitted).toBe(true);
    expect(restored?.activeFileId).toBe('file-1');
  });

  it('falls back to metadata when the browser storage quota is exceeded', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(() => persistRoomSession(sessionWithContent('print(1)'))).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(loadRoomSession()?.filesOmitted).toBe(true);
  });
});
