import { Injectable } from '@nestjs/common';
import { PromptsService } from '../../prompts/prompts.service';
import { renderPromptTemplate } from '../../prompts/prompt-render.util';
import { RESPONDER_SYSTEM_TEMPLATE_KEY } from '../../prompts/seed/responder-system.v1';
import { PipelineContext, PipelineStage } from '../pipeline.types';

@Injectable()
export class PromptBuildStage implements PipelineStage {
  readonly name = 'prompt_build';

  constructor(private prompts: PromptsService) {}

  async execute(ctx: PipelineContext): Promise<void> {
    const startedAt = Date.now();

    const version = await this.prompts.getActiveVersion(RESPONDER_SYSTEM_TEMPLATE_KEY);
    ctx.promptVersionId = version.id;
    ctx.trace.promptVersionId = version.id;

    ctx.renderedSystemPrompt = renderPromptTemplate(version.body, {
      business_name: ctx.businessName,
      personality: ctx.personality,
      tenant_instructions: ctx.systemInstructions,
      knowledge_base: ctx.knowledgeContext,
    });

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
