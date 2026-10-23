import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../ai-core/tools/tool-registry.service';
import { buildLeadTools } from '../ai-core/tools/lead.tools';
import { LeadsService } from './leads.service';

/**
 * Registers `qualify_lead` into the shared tool registry from the Leads side,
 * rather than having ToolRegistryService import LeadsService directly the way it
 * does for Commerce's tools (tool-registry.service.ts). ToolRegistryService already
 * sits in a 3-module circular-require cycle with Commerce/Conversations/AiCore
 * (see commerce.module.ts) -- adding LeadsModule as a 4th participant there would
 * risk another surprise `undefined`-module boot failure for no real benefit. This
 * registrar keeps the dependency one-directional: LeadsModule depends on
 * AiCoreModule, AiCoreModule never needs to depend back on LeadsModule.
 */
@Injectable()
export class LeadToolsRegistrar implements OnModuleInit {
  constructor(
    private toolRegistry: ToolRegistryService,
    private leads: LeadsService,
  ) {}

  onModuleInit() {
    for (const tool of buildLeadTools(this.leads)) {
      this.toolRegistry.register(tool);
    }
  }
}
