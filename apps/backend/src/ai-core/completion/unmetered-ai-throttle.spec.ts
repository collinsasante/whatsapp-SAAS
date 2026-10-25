import { AiLogsController } from '../../ai-logs/ai-logs.controller';
import { ConversationsController } from '../../conversations/conversations.controller';
import { AiTestChatController } from '../test-chat/ai-test-chat.controller';
import { CommerceTestChatController } from '../../commerce/test-chat/commerce-test-chat.controller';

describe('rate limits for AI endpoints outside tenant credit metering', () => {
  const cases = [
    { endpoint: 'conversation summarize', handler: ConversationsController.prototype.summarize },
    { endpoint: 'AI logs sandbox test', handler: AiLogsController.prototype.test },
    { endpoint: 'AI test chat', handler: AiTestChatController.prototype.send },
    { endpoint: 'commerce test chat', handler: CommerceTestChatController.prototype.send },
  ];

  it.each(cases)('$endpoint is limited to three calls per minute', ({ handler }) => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
