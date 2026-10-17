// Owner: Person 3. Reconnecting WebSocket to the room.
export function connectSocket(room, role, { onMessage, onStatus }) {
  let ws;
  let retryMs = 500;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(room)}&role=${role}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      retryMs = 500;
      onStatus?.("connected");
    };
    ws.onmessage = (e) => typeof e.data === "string" && onMessage(JSON.parse(e.data));
    ws.onclose = (e) => {
      if (e.code === 4404) return onStatus?.("unknown-room");
      onStatus?.("reconnecting");
      setTimeout(open, (retryMs = Math.min(retryMs * 2, 8000)));
    };
  };
  open();
  return {
    send: (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
    sendBinary: (buf) => ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1_000_000 && ws.send(buf),
  };
}

export const STATUS_TEXT = { connected: "Server connected", reconnecting: "Reconnecting…", "unknown-room": "Unknown room code" };
