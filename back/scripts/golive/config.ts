import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * The go-live config file: what a company's routing, forms, chains and rates SHOULD be.
 *
 * Data, not code — reviewable as a diff, comparable between environments, and the record of what
 * the customer decided. It is a reconciler's input, never an owner: the screens stay authoritative
 * for day-to-day edits, and this states a desired end state to bring a fresh environment to.
 *
 * Money and rates are strings throughout, as everywhere else in this system. A rate parsed as a JS
 * number is a rate that has already lost digits by the time anyone looks at it.
 */

/** A rate is a decimal string. Rejected here rather than at the database, with the key named. */
const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'must be a decimal number written as a string, e.g. "21500.00"');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD');

const stepSchema = z.object({
  stepNo: z.number().int().positive(),
  /**
   * A role code, not a user. The check reports person-targeted chains as a finding, so the file
   * should not make repeating that the path of least resistance — a chain that names individuals
   * stops entirely when they are away, and has no role for a delegation to resolve against.
   */
  approverRole: z.string().min(1),
  amountMin: decimalString.nullable().optional(),
  amountMax: decimalString.nullable().optional(),
});

const documentTypeSchema = z.object({
  /** The screen that authors this type's content, for types whose content is not on the document. */
  authoringRoute: z.string().min(1).nullable().optional(),
  mappings: z
    .array(
      z.object({
        department: z.string().min(1),
        /** A form template version, as a number written plainly: `1`, `2`. */
        formTemplate: z.coerce.number().int().positive(),
        workflow: z.string().min(1),
      }),
    )
    .default([]),
});

export const goliveConfigSchema = z.object({
  company: z.string().min(1),
  documentTypes: z.record(z.string(), documentTypeSchema).default({}),
  /** `TYPECODE/DEPTCODE` pairs whose form template should end up `PUBLISHED`. */
  publishTemplates: z.array(z.string().regex(/^[^/]+\/[^/]+$/, 'must be "TYPE/DEPT"')).default([]),
  workflows: z.record(z.string(), z.object({ steps: z.array(stepSchema).min(1) })).default({}),
  exchangeRates: z
    .array(
      z.object({
        from: z.string().length(3),
        to: z.string().length(3),
        rate: decimalString,
        rateDate: isoDate,
        rateType: z.string().min(1).default('DAILY'),
      }),
    )
    .default([]),
});

export type GoliveConfig = z.infer<typeof goliveConfigSchema>;

/** Strip `//` line comments so the template's questions can stay in the file the customer returns. */
function stripComments(raw: string): string {
  return raw
    .split('\n')
    .map((line) => {
      // Only a comment that starts the line, so a `//` inside a string value survives. The template
      // never emits a trailing comment, and a stricter parser here would reject files people wrote
      // by hand around one.
      return /^\s*\/\//.test(line) ? '' : line;
    })
    .join('\n');
}

/**
 * Read and validate a config file, failing with the path of the offending key rather than a stack
 * trace. Whoever fills this in is not a TypeScript developer, and "expected string, received
 * number at exchangeRates.0.rate" is the whole of what they need.
 */
export function readConfig(path: string): GoliveConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read config file ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripComments(raw));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  }

  const result = goliveConfigSchema.safeParse(parsed);
  if (!result.success) {
    // Every problem at once. One run naming every bad key beats five runs naming one each.
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`${path} is not a valid go-live config:\n${problems}`);
  }
  return result.data;
}
