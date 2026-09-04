import { Injectable } from '@nestjs/common';
import { PromptsService } from '../../prompts/prompts.service';
import { renderPromptTemplate } from '../../prompts/prompt-render.util';
import { RESPONDER_SYSTEM_TEMPLATE_KEY } from '../../prompts/seed/responder-system.v1';
import { buildIdentityAndSafetyBlock } from '../../prompts/shared-identity-block';
import { SHARED_STYLE_RULES } from '../../prompts/shared-style-rules';
import { formatBusinessInfoBlock } from '../../prompts/business-info.util';
import { formatStateBlock } from '../../prompts/conversation-state.util';
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

    const body = renderPromptTemplate(version.body, {
      business_name: ctx.businessName,
      personality: ctx.personality,
      tenant_instructions: ctx.systemInstructions,
      knowledge_base: ctx.knowledgeContext,
      business_info: formatBusinessInfoBlock(ctx.businessInfo ?? {}, ctx.adContext),
      conversation_state: formatStateBlock(ctx.conversationState),
    });

    // Verz-AI unification, Phase D: identity/safety and shared style rules are
    // appended by code, not stored in the editable template body -- a tenant
    // admin customizing their prompt can no longer accidentally weaken either.
    ctx.renderedSystemPrompt = [
      body,
      ``,
      SHARED_STYLE_RULES,
      ``,
      buildIdentityAndSafetyBlock(ctx.businessName),
    ].join('\n');

    ctx.trace.stageTimings[this.name] = Date.now() - startedAt;
  }
}
