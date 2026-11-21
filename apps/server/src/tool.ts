import type { PoolClient } from "pg";
import { z } from "zod";

export function defineTool<S extends z.ZodRawShape, R extends Record<string, unknown>>(
  name: string,
  description: string,
  schema: z.ZodObject<S>,
  handle: (db: PoolClient, me: string, input: z.output<z.ZodObject<S>>) => Promise<R>,
) {
  const strict = schema.strict();
  return {
    name, description, inputSchema: z.toJSONSchema(strict),
    run(db: PoolClient, me: string, input: unknown) {
      return handle(db, me, strict.parse(input));
    },
  };
}
