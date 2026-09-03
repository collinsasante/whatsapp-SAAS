import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { ChatToolDef } from '../providers/ai-provider.interface';
import { ProductsService } from '../../commerce/products/products.service';
import { OrdersService } from '../../commerce/orders/orders.service';
import { InternalTasksService } from '../../internal-tasks/internal-tasks.service';
import { buildCatalogueTools } from './catalogue.tools';
import { buildCommerceTools } from './commerce.tools';
import { buildTaskTools } from './task.tools';
import { ToolDefinition, ToolExecutionContext } from './tool-registry.types';

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
  ) {}

  onModuleInit() {
    for (const tool of [
      ...buildCatalogueTools(this.products),
      ...buildCommerceTools(this.orders),
      ...buildTaskTools(this.internalTasks, this.orders),
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

  async execute(name: string, ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      return await tool.execute(ctx, args);
    } catch (err) {
      this.logger.warn(`Tool ${name} failed: ${String(err)}`);
      return { error: err instanceof Error ? err.message : 'Tool execution failed' };
    }
  }
}
