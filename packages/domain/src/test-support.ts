import { DomainValidationError } from './shared/errors.js';

export const toolA = {
  name: 'alpha',
  description: 'First tool',
  inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query', 'limit'] },
};

export const toolB = {
  name: 'beta',
  description: 'Second tool',
  inputSchema: { type: 'object', properties: { mode: { enum: ['fast', 'slow'] } } },
};

export const withTools = (tools: unknown[]) => ({ tools, prompts: [], resources: [] });
export const withTool = (tool: unknown) => withTools([tool]);

export function reorderKeys<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

export function problemsOf(action: () => unknown): readonly string[] {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected a DomainValidationError but nothing was thrown');
}
