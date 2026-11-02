import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import * as jwt from 'jsonwebtoken';
import { JwtPayload, SocketEvent } from '@whatsapp-platform/shared-types';
import { conversationRoom, isValidId, tenantRoom, userRoom } from './rooms';

// No fallback value: a well-known default secret would let anyone mint a valid token.
const JWT_SECRET: string = (() => {
  const secret = process.env['JWT_SECRET'];
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
})();

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    tenantId: string;
    role: string;
  };
}

interface RealtimeEvent {
  event: string;
  payload: {
    tenantId?: string;
    conversationId?: string;
    userId?: string;
    data?: unknown;
    [key: string]: unknown;
  };
}

export class SocketGateway {
  constructor(
    private io: Server,
    private redis: Redis,
  ) {}

  initialize() {
    this.io.use(this.authMiddleware.bind(this));
    this.io.on('connection', this.handleConnection.bind(this));
    this.redis.subscribe('realtime:events', (err) => {
      if (err) console.error('Redis subscribe error:', err);
    });
    this.redis.on('message', this.handleRedisMessage.bind(this));
    console.log('Socket gateway initialized');
  }

  private authMiddleware(socket: Socket, next: (err?: Error) => void) {
    const token = socket.handshake.auth['token'] as string | undefined ?? socket.handshake.headers['authorization']?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      (socket as AuthenticatedSocket).data = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role,
      };
      next();
    } catch {
      next(new Error('Invalid authentication token'));
    }
  }

  private handleConnection(socket: Socket) {
    const authSocket = socket as AuthenticatedSocket;
    const { userId, tenantId } = authSocket.data;

    console.log(`Client connected: ${userId} (tenant: ${tenantId})`);

    void authSocket.join(tenantRoom(tenantId));
    void authSocket.join(userRoom(userId));

    this.io.to(tenantRoom(tenantId)).emit(SocketEvent.AGENT_ONLINE, { userId });

    authSocket.on(SocketEvent.JOIN_CONVERSATION, (conversationId: unknown) => {
      if (!isValidId(conversationId)) return;
      void authSocket.join(conversationRoom(tenantId, conversationId));
    });

    authSocket.on(SocketEvent.LEAVE_CONVERSATION, (conversationId: unknown) => {
      if (!isValidId(conversationId)) return;
      void authSocket.leave(conversationRoom(tenantId, conversationId));
    });

    authSocket.on(SocketEvent.TYPING_START, (data: { conversationId: string }) => {
      if (!isValidId(data?.conversationId)) return;
      authSocket.to(conversationRoom(tenantId, data.conversationId)).emit(SocketEvent.TYPING_START, {
        conversationId: data.conversationId,
        userId,
        isTyping: true,
      });
    });

    authSocket.on(SocketEvent.TYPING_STOP, (data: { conversationId: string }) => {
      if (!isValidId(data?.conversationId)) return;
      authSocket.to(conversationRoom(tenantId, data.conversationId)).emit(SocketEvent.TYPING_STOP, {
        conversationId: data.conversationId,
        userId,
        isTyping: false,
      });
    });

    authSocket.on('disconnect', () => {
      console.log(`Client disconnected: ${userId}`);
      this.io.to(tenantRoom(tenantId)).emit(SocketEvent.AGENT_OFFLINE, { userId });
    });
  }

  private handleRedisMessage(_channel: string, raw: string) {
    try {
      const { event, payload } = JSON.parse(raw) as RealtimeEvent;

      // Personal user events (notifications, etc.)
      if (payload.userId && !payload.tenantId) {
        this.io.to(userRoom(payload.userId)).emit(event, payload.data ?? payload);
        return;
      }

      const { tenantId, conversationId, ...rest } = payload;
      if (!isValidId(tenantId)) {
        console.error(`Dropped realtime event ${String(event)}: no tenantId`);
        return;
      }

      if (isValidId(conversationId)) {
        const room = conversationRoom(tenantId, conversationId);
        this.io.to(room).emit(event, payload);
        this.io.to(tenantRoom(tenantId)).except(room).emit(event, { ...rest, tenantId, conversationId });
      } else {
        this.io.to(tenantRoom(tenantId)).emit(event, { ...rest, tenantId, conversationId });
      }
    } catch (error) {
      console.error('Failed to handle Redis message:', error);
    }
  }
}
