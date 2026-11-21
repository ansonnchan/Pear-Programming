import { Client, type IMessage } from '@stomp/stompjs';
import { useEffect, useRef, useState } from 'react';
import SockJS from 'sockjs-client';
import { getStompConnectHeaders, STOMP_URL } from '../api';

type RoomConnectionHandlers = {
  onAnnotation: (message: IMessage) => void;
  /**
   * Runs before every connect and reconnect attempt. The server only accepts room messages from active
   * members, so this re-registers the user (and recovers an expired sign-in) before the socket opens.
   * Resolve to false to stop reconnecting, for example when the room is gone, full, or locked.
   */
  onBeforeConnect: () => Promise<boolean>;
  onChat: (message: IMessage) => void;
  onConnected: (client: Client) => void;
  onCursor: (message: IMessage) => void;
  onHeartbeat: (client: Client) => void;
  onMember: (message: IMessage, client: Client) => void;
  onProjectSwitch: (message: IMessage) => void;
};

export function useRoomConnection(roomCode: string | null, handlers: RoomConnectionHandlers) {
  const [client, setClient] = useState<Client | null>(null);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);
  const handlersRef = useRef(handlers);
  const connectionCountRef = useRef(0);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!roomCode) {
      clientRef.current = null;
      setClient(null);
      setConnected(false);
      return;
    }

    let heartbeatTimer: number | null = null;
    const connection = new Client({
      connectHeaders: getStompConnectHeaders(),
      reconnectDelay: 2000,
      beforeConnect: async () => {
        const shouldConnect = await handlersRef.current.onBeforeConnect().catch(() => true);
        // The CSRF token can change after a session is recovered, so read it for every attempt.
        connection.connectHeaders = getStompConnectHeaders();
        if (!shouldConnect) {
          console.info('Room realtime reconnect stopped', { roomCode });
          await connection.deactivate();
        }
      },
      webSocketFactory: () => new SockJS(STOMP_URL),
      onConnect: () => {
        connectionCountRef.current += 1;
        setConnected(true);
        console.info(connectionCountRef.current > 1 ? 'Room realtime reconnected' : 'Room realtime connection established', {
          roomCode,
          reconnect: connectionCountRef.current > 1
        });
        connection.subscribe(`/topic/room/${roomCode}/chat`, (message) => handlersRef.current.onChat(message));
        connection.subscribe(`/topic/room/${roomCode}/cursors`, (message) => handlersRef.current.onCursor(message));
        connection.subscribe(`/topic/room/${roomCode}/members`, (message) => handlersRef.current.onMember(message, connection));
        connection.subscribe(`/topic/room/${roomCode}/annotations`, (message) => handlersRef.current.onAnnotation(message));
        connection.subscribe(`/topic/room/${roomCode}/project-switch`, (message) => handlersRef.current.onProjectSwitch(message));
        console.info('Room realtime subscriptions established', { roomCode });
        handlersRef.current.onConnected(connection);
        if (heartbeatTimer !== null) {
          window.clearInterval(heartbeatTimer);
        }
        heartbeatTimer = window.setInterval(() => {
          if (connection.connected) {
            handlersRef.current.onHeartbeat(connection);
          }
        }, 25_000);
      },
      onWebSocketClose: () => {
        setConnected(false);
        console.info('Room realtime connection closed; reconnect scheduled', { roomCode });
      },
      onStompError: () => {
        setConnected(false);
        console.warn('Room realtime subscription error', { roomCode });
      }
    });

    clientRef.current = connection;
    setClient(connection);
    connection.activate();

    return () => {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }
      void connection.deactivate();
      if (clientRef.current === connection) {
        clientRef.current = null;
      }
      setConnected(false);
      setClient(null);
    };
  }, [roomCode]);

  return { client, clientRef, connected };
}
