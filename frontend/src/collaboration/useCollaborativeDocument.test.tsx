import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Member, WorkspaceFile } from '../types';
import { useCollaborativeDocument } from './useCollaborativeDocument';

type Listener = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => ({
  providers: [] as Array<{ doc: Y.Doc }>,
  bindingObservations: [] as boolean[],
  remoteEditRef: { current: false }
}));

vi.mock('y-websocket', () => {
  class FakeAwareness {
    private listeners = new Map<string, Listener[]>();
    setLocalStateField() {}
    getStates() { return new Map([[1, {}]]); }
    on(event: string, listener: Listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]); }
    off() {}
  }
  class WebsocketProvider {
    awareness = new FakeAwareness();
    synced = true;
    doc: Y.Doc;
    constructor(_url: string, _room: string, doc: Y.Doc) {
      this.doc = doc;
      mocks.providers.push(this);
    }
    on() {}
    off() {}
    destroy() {}
  }
  return { WebsocketProvider };
});

vi.mock('y-monaco', () => ({
  MonacoBinding: class {
    private readonly observer: () => void;
    constructor(private readonly text: Y.Text) {
      // Mirrors y-monaco: remote Yjs changes reach Monaco from inside the text observer.
      this.observer = () => mocks.bindingObservations.push(mocks.remoteEditRef.current);
      text.observe(this.observer);
    }
    destroy() { this.text.unobserve(this.observer); }
  }
}));

const file: WorkspaceFile = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: 'workspace-1',
  path: 'main.py',
  language: 'python',
  content: 'print(1)',
  createdAt: '2026-07-15T00:00:00Z',
  updatedAt: '2026-07-15T00:00:00Z'
};

const user: Member = { id: 'user-1', name: 'Pear', color: '#627d31' };

describe('useCollaborativeDocument', () => {
  it('flags edits applied from collaborators but not local edits', async () => {
    let value = file.content;
    const editor = { current: { getModel: () => ({ getValue: () => value, setValue: (next: string) => { value = next; } }) } };
    const options = {
      applyingRemoteEdit: mocks.remoteEditRef,
      bound: { current: false },
      editor,
      editorMountVersion: 1,
      file,
      filesRef: { current: [file] },
      onFilesChange: vi.fn(),
      realtimeToken: 'token',
      roomCode: 'PEAR12',
      suppressEditorChange: { current: false },
      user,
      yjsUrl: 'ws://realtime.test'
    };
    renderHook(() => useCollaborativeDocument(options));

    await waitFor(() => expect(options.bound.current).toBe(true));
    expect(mocks.providers).toHaveLength(1);
    const provider = mocks.providers[0];
    const text = provider.doc.getText('monaco');
    mocks.bindingObservations.length = 0;

    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(provider.doc));
    remote.getText('monaco').insert(0, '# remote\n');
    Y.applyUpdate(provider.doc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(provider.doc)), provider);
    text.insert(0, '# local\n');

    expect(mocks.bindingObservations).toEqual([true, false]);
    expect(mocks.remoteEditRef.current).toBe(false);
  });
});
