// Owner: Person 1. WebSocket at /ws?room=CODE&role=listener|presenter. Messages: docs/ARCHITECTURE.md.
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { findRoom, publicState, broadcast, setCurrentSlide, slideByNumber } from "./rooms.js";
import { pushAudio } from "./transcriber.js";

export function attachSockets(server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://localhost");
    const room = findRoom(url.searchParams.get("room"));
    if (!room) return ws.close(4404, "Unknown room");

    const client = { ws, role: url.searchParams.get("role") === "presenter" ? "presenter" : "listener" };
    if (process.env.DEBUG_FRAMES === "1") console.log(`[${new Date().toTimeString().slice(0, 8)}] socket ${client.role} joined ${room.id}`);
    room.clients.add(client);
    ws.send(JSON.stringify({ type: "state", state: publicState(room) }));
    if (client.role === "presenter") {
      for (const item of room.pending.values()) ws.send(JSON.stringify({ type: item.kind, [item.kind]: item }));
    }

    ws.on("message", (data, isBinary) => {
      if (isBinary) return client.role === "listener" && pushAudio(room, data);
      try {
        handle(room, client, JSON.parse(data.toString()));
      } catch (err) {
        console.warn("[socket]", err.message);
      }
    });
    ws.on("close", () => room.clients.delete(client));
  });
}

function handle(room, client, msg) {
  if (msg.type === "request-description" && client.role === "listener") {
    const request = { id: randomUUID(), kind: "request", note: String(msg.note || "").slice(0, 300), slide: room.current?.number ?? null, at: Date.now() };
    room.pending.set(request.id, request);
    broadcast(room, { type: "request", request }, { role: "presenter" });
    const hasPresenter = [...room.clients].some((c) => c.role === "presenter");
    client.ws.send(JSON.stringify({ type: "request-sent", hasPresenter }));
  } else if (msg.type === "respond" && client.role === "presenter") {
    const item = room.pending.get(msg.id);
    if (!item) return;
    room.pending.delete(msg.id);
    const action = msg.action === "accept" ? "accept" : "dismiss";
    broadcast(room, { type: "resolved", id: item.id }, { role: "presenter" });
    if (action === "accept" || item.kind === "request") {
      broadcast(room, { type: "presenter-response", kind: item.kind, action, slide: item.slide }, { role: "listener" });
    }
  } else if (msg.type === "set-slide" && client.role === "presenter") {
    const slide = slideByNumber(room, Number(msg.number));
    if (slide) setCurrentSlide(room, slide, "presenter");
  }
}
