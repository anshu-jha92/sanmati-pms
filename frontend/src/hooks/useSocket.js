import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { authStore } from '../context/authStore.js';

// Same resolution as the REST client: explicit env → dev localhost → prod same-origin.
const ENV_SOCKET = import.meta.env.VITE_SOCKET_URL;
const SOCKET_URL = (ENV_SOCKET && ENV_SOCKET.trim())
  ? ENV_SOCKET
  : (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

const sockets = {}; // namespace -> client (singleton per namespace)

export function getSocket(namespace) {
  if (sockets[namespace]) return sockets[namespace];
  const s = io(`${SOCKET_URL}${namespace}`, {
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    auth: (cb) => {
      cb({ token: authStore.getState().accessToken });
    },
  });
  sockets[namespace] = s;
  return s;
}

export function closeAllSockets() {
  for (const s of Object.values(sockets)) s.close();
}

/**
 * React hook: subscribe to socket events, scoped to mount.
 *
 * useSocket('/ops', {
 *   'machine:events': (events) => { ... },
 *   'machine:status': (s) => { ... },
 * }, [plantId])
 *
 * The third arg is a dependency list — when it changes we re-run the subscribe
 * (and any emit in `onConnect`) to pick up new filters.
 */
export function useSocket(namespace, handlers, deps = [], onConnect) {
  const savedHandlers = useRef(handlers);
  savedHandlers.current = handlers;

  useEffect(() => {
    const s = getSocket(namespace);
    if (!s.connected) s.connect();

    const connectListener = () => onConnect?.(s);
    s.on('connect', connectListener);
    if (s.connected) connectListener();

    const entries = Object.entries(savedHandlers.current || {});
    const wrapped = entries.map(([ev, fn]) => {
      const w = (payload) => fn(payload, s);
      s.on(ev, w);
      return [ev, w];
    });

    return () => {
      s.off('connect', connectListener);
      for (const [ev, w] of wrapped) s.off(ev, w);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, ...deps]);
}
