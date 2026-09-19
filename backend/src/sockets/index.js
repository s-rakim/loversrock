import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getActivePairForUser } from '../models/pairs.js';

// Held so the REST routes can push to a pair room after they change state.
// A game move arrives as an HTTP POST, not a socket event - the socket is
// how the *other* phone finds out about it.
let ioRef = null;

/** The live Server, or null before initSockets() has run (e.g. in tests). */
export function getIo() {
  return ioRef;
}

export function initSockets(httpServer, corsOrigins) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
  });

  // JWT-authenticated on handshake. The client never supplies its own
  // pair_id — we look up the caller's active pair server-side and join
  // exactly that room, so a socket can never join or address a pair it
  // doesn't belong to.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing token'));

      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const pair = await getActivePairForUser(payload.sub);
      if (!pair) return next(new Error('Not currently paired'));

      socket.userId = payload.sub;
      socket.pairId = pair.id;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  ioRef = io;

  io.on('connection', (socket) => {
    const room = `pair:${socket.pairId}`;
    socket.join(room);

    const broadcast = (event, payload) => {
      socket.to(room).emit(event, { ...payload, fromUserId: socket.userId });
    };

    socket.on('bucket:update', (payload) => broadcast('bucket:update', payload));

    socket.on('location:update', (payload) => broadcast('location:update', payload));

    // Thumb Kiss: two-device live touch sync, normalized 0..1 coordinates.
    socket.on('thumbkiss:move', (payload) => broadcast('thumbkiss:partner-move', payload));
    socket.on('thumbkiss:release', (payload) => broadcast('thumbkiss:partner-release', payload));

    // Draw Duel: strokes stream live, stroke-by-stroke, to the guessing partner.
    socket.on('drawduel:start', (payload) => broadcast('drawduel:started', payload));
    socket.on('drawduel:stroke', (payload) => broadcast('drawduel:stroke', payload));
    socket.on('drawduel:clear', (payload) => broadcast('drawduel:clear', payload));
    socket.on('drawduel:guess', (payload) => broadcast('drawduel:guess', payload));
    socket.on('drawduel:correct', (payload) => broadcast('drawduel:correct', payload));

    // Multiplayer games deliberately have NO move events here. A move is a
    // POST that the server validates; the server then emits 'game:moved' to
    // the room and each phone re-fetches its own redacted view. Accepting a
    // move over the socket would mean trusting the client's word for whose
    // turn it is, and pushing full state would mean emitting one player's
    // Uno hand into a room the other is sitting in.
    //
    // What does belong here is presence: letting your partner see you are
    // looking at the board.
    socket.on('game:watching', (payload) => broadcast('game:watching', payload));
    socket.on('game:left', (payload) => broadcast('game:left', payload));
  });

  return io;
}
