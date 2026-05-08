import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import * as jwt from 'jsonwebtoken';
import { JwtPayload, SocketEvent } from '@whatsapp-platform/shared-types';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'changeme';

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
    tenantId: string;
    conversationId?: string;
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

    void authSocket.join(`tenant:${tenantId}`);
    void authSocket.join(`user:${userId}`);

    this.io.to(`tenant:${tenantId}`).emit(SocketEvent.AGENT_ONLINE, { userId });

    authSocket.on(SocketEvent.JOIN_CONVERSATION, (conversationId: string) => {
      void authSocket.join(`conversation:${conversationId}`);
    });

    authSocket.on(SocketEvent.LEAVE_CONVERSATION, (conversationId: string) => {
      void authSocket.leave(`conversation:${conversationId}`);
    });

    authSocket.on(SocketEvent.TYPING_START, (data: { conversationId: string }) => {
      authSocket.to(`conversation:${data.conversationId}`).emit(SocketEvent.TYPING_START, {
        conversationId: data.conversationId,
        userId,
        isTyping: true,
      });
    });

    authSocket.on(SocketEvent.TYPING_STOP, (data: { conversationId: string }) => {
      authSocket.to(`conversation:${data.conversationId}`).emit(SocketEvent.TYPING_STOP, {
        conversationId: data.conversationId,
        userId,
        isTyping: false,
      });
    });

    authSocket.on('disconnect', () => {
      console.log(`Client disconnected: ${userId}`);
      this.io.to(`tenant:${tenantId}`).emit(SocketEvent.AGENT_OFFLINE, { userId });
    });
  }

  private handleRedisMessage(_channel: string, raw: string) {
    try {
      const { event, payload } = JSON.parse(raw) as RealtimeEvent;
      const { tenantId, conversationId, ...rest } = payload;

      if (conversationId) {
        // Users in the conversation room receive the event once here
        this.io.to(`conversation:${conversationId}`).emit(event, payload);
        // Users in the tenant room but NOT viewing this conversation still get notified
        this.io.to(`tenant:${tenantId}`).except(`conversation:${conversationId}`).emit(event, { ...rest, tenantId, conversationId });
      } else {
        this.io.to(`tenant:${tenantId}`).emit(event, { ...rest, tenantId, conversationId });
      }
    } catch (error) {
      console.error('Failed to handle Redis message:', error);
    }
  }
}
