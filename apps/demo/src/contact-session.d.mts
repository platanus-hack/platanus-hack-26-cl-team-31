export function checkContactRuntime(): Promise<void>;
export function reportContactError(error: unknown): string;
export function runContactSession(question: string, options?: { signal?: AbortSignal; root?: string; bobFile?: string; janeFile?: string }): Promise<{
  text: string;
  traces: { tool: string; input: Record<string, unknown>; data: Record<string, unknown> }[];
}>;
