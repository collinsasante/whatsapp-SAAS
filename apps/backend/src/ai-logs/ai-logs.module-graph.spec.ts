import { AiCoreModule } from '../ai-core/ai-core.module';
import { AiLogsModule } from './ai-logs.module';
import { MessagesModule } from '../messages/messages.module';

/**
 * AiLogsModule imports AiCoreModule directly (for the admin sandbox's pipeline). That is only safe while AiCoreModule's own import
 * graph never leads back to AiLogsModule; otherwise it would need forwardRef and risks an undefined module at startup. This reads
 * the real module metadata, so a future import that closes the loop fails here with the path, not at boot.
 */
type ModuleRef = { name: string } | { forwardRef: () => { name: string } } | { module: { name: string } };
const resolve = (m: ModuleRef): { name: string } => ('forwardRef' in m ? m.forwardRef() : 'module' in m ? m.module : m);
const importsOf = (mod: object): ModuleRef[] => (Reflect.getMetadata('imports', mod) ?? []) as ModuleRef[];

function reachable(start: object): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const walk = (m: ModuleRef, path: string[]) => {
    const mod = resolve(m);
    if (!mod?.name || seen.has(mod.name)) return;
    seen.set(mod.name, path);
    for (const next of importsOf(mod)) walk(next, [...path, mod.name]);
  };
  walk(start as ModuleRef, []);
  return seen;
}

describe('AiLogsModule <-> AiCoreModule', () => {
  it('AiCoreModule\'s import graph does not reach AiLogsModule or MessagesModule (so no cycle is created)', () => {
    const fromCore = reachable(AiCoreModule);
    expect(fromCore.size).toBeGreaterThan(10); // the walk really traversed the graph
    expect(fromCore.has('AiLogsModule') ? fromCore.get('AiLogsModule') : null).toBeNull();
    expect(fromCore.has('MessagesModule') ? fromCore.get('MessagesModule') : null).toBeNull();
  });

  it('AiLogsModule imports AiCoreModule directly, as a plain import (no forwardRef needed)', () => {
    expect(importsOf(AiLogsModule)).toContain(AiCoreModule);
  });

  it('MessagesModule still imports both, and neither of them imports it back', () => {
    const messagesImports = importsOf(MessagesModule).map((m) => resolve(m));
    expect(messagesImports).toContain(AiLogsModule);
    expect(messagesImports).toContain(AiCoreModule);
    expect(reachable(AiLogsModule).has('MessagesModule')).toBe(false);
  });
});
