// The game server: the socket, and the same host over plain HTTP(S).
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
export const SERVER_HTTP = SERVER_URL.replace(/^ws/, 'http');
