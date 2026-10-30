import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueName } from '@whatsapp-platform/shared-types';
import { RedisLike, RedisSimulationStore } from './simulation-store';
import { SIMULATION_STORE, SimulationLimitsService } from './simulation-limits.service';

/**
 * The backend has no Redis client of its own: BullMQ owns the connection. The limits borrow that SAME connection through a queue
 * handle (`Queue.client`), so nothing new is added and no new connection is opened. The queue is never used to enqueue anything.
 * Counter keys live under their own prefix (`verz:aisim:`), apart from BullMQ's `bull:` keys.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QueueName.AI_INTERACTION_EVAL })],
  providers: [
    {
      provide: SIMULATION_STORE,
      inject: [getQueueToken(QueueName.AI_INTERACTION_EVAL)],
      useFactory: (queue: Queue) => new RedisSimulationStore(() => queue.client as unknown as Promise<RedisLike>),
    },
    SimulationLimitsService,
  ],
  exports: [SimulationLimitsService],
})
export class SimulationLimitsModule {}
