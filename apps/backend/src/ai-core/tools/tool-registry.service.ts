import { HttpException, Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { ChatToolDef } from '../providers/ai-provider.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../../commerce/products/products.service';
import { OrdersService } from '../../commerce/orders/orders.service';
import { InternalTasksService } from '../../internal-tasks/internal-tasks.service';
import { ConversationStateService } from '../../conversations/conversation-state.service';
import { buildCatalogueTools } from './catalogue.tools';
import { buildCommerceTools } from './commerce.tools';
import { buildTaskTools } from './task.tools';
import { buildMediaTools } from './media.tools';
import { buildStateTools } from './state.tools';
import { buildDeliveryTools } from './delivery.tools';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';
import { describeErrorForLog } from '../../common/privacy/prompt-redaction.util';

/**
 * Verz-AI unification, Phase A: a single shared tool registry so Commerce's tools
 * (previously private to CommerceAiService's own hand-rolled loop) are real, reusable
 * capabilities any tool-calling caller can offer -- the general pipeline eventually,
 * CommerceAiService today (refactored onto this same registry rather than its own
 * private switch statement). Registering a tool here does not make it available to
 * every conversation -- callers decide which subset of tool NAMES to offer per run
 * (e.g. via AiAgent.allowedTools / TenantSettings.commerceEnabled); this class only
 * owns the definitions and dispatch, not the per-tenant capability decision.
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    // ProductsService/OrdersService come from CommerceModule, which imports AiCoreModule
    // back (forwardRef() on both sides, see ai-core.module.ts/commerce.module.ts) --
    // forwardRef() is needed here too, on the injection site of the circular pair.
    // InternalTasksModule has no reverse edge, so InternalTasksService doesn't need it.
    @Inject(forwardRef(() => ProductsService)) private products: ProductsService,
    @Inject(forwardRef(() => OrdersService)) private orders: OrdersService,
    private internalTasks: InternalTasksService,
    private conversationState: ConversationStateService,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    for (const tool of [
      ...buildCatalogueTools(this.products),
      ...buildCommerceTools(this.orders),
      ...buildTaskTools(this.internalTasks, this.orders),
      ...buildMediaTools(this.products),
      ...buildStateTools(this.conversationState),
      ...buildDeliveryTools(this.prisma, this.internalTasks, this.orders),
    ]) {
      this.register(tool);
    }
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.def.name, tool);
  }

  /** Tool definitions for the given names, in the DeepSeek/OpenAI wire-format shape --
   * unknown names are silently dropped rather than thrown, so a stale/misconfigured
   * allowedTools entry never breaks a whole conversation. */
  getDefs(names: string[]): ChatToolDef[] {
    return names.map((n) => this.tools.get(n)?.def).filter((d): d is ChatToolDef => !!d);
  }

  isStateChanging(name: string): boolean {
    return this.tools.get(name)?.stateChanging === true;
  }

  /**
   * The context is built by the server, but a handler acts with it on the strength of one claim: that this conversation belongs to this workspace and this
   * contact. Checked here, on every call and before any handler runs, so a context assembled wrongly anywhere (a caller bug, a replayed or stale run)
   * cannot reach another workspace's data. A failed check, or a failure to check, refuses the call.
   */
  private async contextIsConsistent(ctx: ToolExecutionContext): Promise<boolean> {
    try {
      const n = await this.prisma.conversation.count({ where: { id: ctx.conversationId, tenantId: ctx.tenantId, contactId: ctx.contactId } });
      return n === 1;
    } catch (err) {
      this.logger.warn(`Tool context could not be verified: ${describeErrorForLog(err)}`);
      return false;
    }
  }

  async execute(name: string, ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    if (!(await this.contextIsConsistent(ctx))) {
      this.logger.warn(`Refused tool ${String(name).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)}: its conversation does not belong to the workspace and contact in the context`);
      return { error: 'This conversation is not available.' };
    }
    try {
      return await tool.execute(ctx, args);
    } catch (err) {
      this.logger.warn(`Tool ${name} failed: ${describeErrorForLog(err)}`);
      // Verz-AI unification, Phase H: a deliberately-worded HttpException (e.g.
      // OrdersService's NotFoundException('No order has been started yet')) is
      // already customer-safe -- but a raw Error/Prisma/axios failure previously
      // went into the model's own context verbatim, with nothing stopping the
      // model from repeating it back to the customer. Full error is still logged
      // above for debugging; only the message the model sees is sanitized.
      const message = err instanceof HttpException ? err.message : 'Something went wrong on our end -- try again in a moment.';
      return { error: message };
    }
  }
}
