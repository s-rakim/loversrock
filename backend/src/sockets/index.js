import jwt from "jsonwebtoken";
import { getActivePairForUser } from "../models/pairs.js";

// Socket.io auth: JWT passed in the handshake `auth` payload, verified server-side.
// Never trust a client-supplied pair_id — always derive it from the authenticated
// user's actual active pair (SPEC.md 9.3).
export function attachSockets(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing auth token"));
    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      socket.userId = payload.sub;
      next();
    } catch (err) {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", async (socket) => {
    const pair = await getActivePairForUser(socket.userId);
    if (!pair) {
      socket.disconnect(true);
      return;
    }

    const room = `pair:${pair.id}`;
    socket.join(room);

    socket.on("disconnect", () => {
      // no-op for now; room membership cleans up automatically
    });
  });

  return io;
}

// Helper other route files can import to broadcast, e.g. after a bucket list change:
//   import { io } from "../server.js"; io.to(`pair:${pairId}`).emit("bucket:update", item);
