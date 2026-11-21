import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomConnection } from './useRoomConnection';

type FakeClientConfig = {
  beforeConnect: () => Promise<void>;
  connectHeaders: Record<string, string>;
};

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    activate: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
    config: FakeClientConfig;
    connectHeaders: Record<string, string>;
  }>,
  headers: { 'X-XSRF-TOKEN': 'first-token' } as Record<string, string>
}));

vi.mock('../api', () => ({ getStompConnectHeaders: () => ({ ...mocks.headers }), STOMP_URL: 'http://localhost/stomp' }));
vi.mock('sockjs-client', () => ({ default: vi.fn() }));
vi.mock('@stomp/stompjs', () => ({
  Client: class Client {
    connected = false;
    activate = vi.fn();
    deactivate = vi.fn(async () => undefined);
    subscribe = vi.fn();
    config: FakeClientConfig;
    connectHeaders: Record<string, string>;
    constructor(config: FakeClientConfig) {
      this.config = config;
      this.connectHeaders = config.connectHeaders;
      mocks.instances.push(this);
    }
  }
}));

function handlers(onBeforeConnect = vi.fn(async () => true)) {
  return {
    onAnnotation: vi.fn(), onBeforeConnect, onChat: vi.fn(), onConnected: vi.fn(), onCursor: vi.fn(),
    onHeartbeat: vi.fn(), onMember: vi.fn(), onProjectSwitch: vi.fn()
  };
}

describe('useRoomConnection', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
    mocks.headers = { 'X-XSRF-TOKEN': 'first-token' };
  });

  it('owns one client per room and deactivates it on room changes and unmount', () => {
    const roomHandlers = handlers();
    const { rerender, unmount } = renderHook(({ room }) => useRoomConnection(room, roomHandlers), { initialProps: { room: 'ABC123' as string | null } });
    expect(mocks.instances).toHaveLength(1);
    expect(mocks.instances[0].activate).toHaveBeenCalledOnce();

    rerender({ room: 'XYZ789' });
    expect(mocks.instances[0].deactivate).toHaveBeenCalledOnce();
    expect(mocks.instances).toHaveLength(2);
    unmount();
    expect(mocks.instances[1].deactivate).toHaveBeenCalledOnce();
  });

  it('rejoins the room and refreshes the CSRF header before every connect attempt', async () => {
    const onBeforeConnect = vi.fn(async () => true);
    renderHook(() => useRoomConnection('ABC123', handlers(onBeforeConnect)));
    const client = mocks.instances[0];

    await client.config.beforeConnect();
    mocks.headers = { 'X-XSRF-TOKEN': 'token-after-session-recovery' };
    await client.config.beforeConnect();

    expect(onBeforeConnect).toHaveBeenCalledTimes(2);
    expect(client.connectHeaders).toEqual({ 'X-XSRF-TOKEN': 'token-after-session-recovery' });
    expect(client.deactivate).not.toHaveBeenCalled();
  });

  it('stops reconnecting when the room can no longer be joined', async () => {
    renderHook(() => useRoomConnection('ABC123', handlers(vi.fn(async () => false))));
    const client = mocks.instances[0];

    await client.config.beforeConnect();

    expect(client.deactivate).toHaveBeenCalledOnce();
  });

  it('keeps retrying when the rejoin request itself fails unexpectedly', async () => {
    renderHook(() => useRoomConnection('ABC123', handlers(vi.fn(async () => { throw new Error('offline'); }))));
    const client = mocks.instances[0];

    await client.config.beforeConnect();

    expect(client.deactivate).not.toHaveBeenCalled();
  });
});
