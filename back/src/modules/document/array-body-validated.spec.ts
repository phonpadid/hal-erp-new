// The DTO decorators need the metadata polyfill; Nest loads it at bootstrap, vitest does not.
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DocumentController } from './document.controller';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';

/**
 * The two endpoints whose body is a top-level array.
 *
 * A test at the DTO layer would have passed all along and caught nothing: `DocumentLineInput` was
 * always correct, and is enforced when it arrives nested inside `CreateDocumentDto`. What was
 * missing is that the global `ValidationPipe` treats an array metatype as a native type and skips
 * it, so the handler received whatever was sent — a line with no `lineAmount` reached the ORM and
 * came back as `500 INTERNAL_ERROR`, and a misspelt field was accepted with `204`.
 *
 * So these read the pipes Nest actually has bound to the body parameter and run them. That is the
 * layer the defect lived at, and asserting it here is what stops the binding being dropped again.
 */
const BODY_PARAMTYPE = 3;

function bodyPipes(method: 'setLines' | 'setFields'): PipeTransform[] {
  const args = Reflect.getMetadata('__routeArguments__', DocumentController, method) as
    | Record<string, { pipes?: PipeTransform[] }>
    | undefined;
  const body = Object.entries(args ?? {}).find(([k]) => k.startsWith(`${BODY_PARAMTYPE}:`));
  return body?.[1]?.pipes ?? [];
}

const META: ArgumentMetadata = { type: 'body', metatype: Array, data: undefined };

/** Run every pipe bound to that body, as Nest would. */
async function send(method: 'setLines' | 'setFields', payload: unknown): Promise<unknown> {
  let value = payload;
  for (const pipe of bodyPipes(method)) value = await pipe.transform(value, META);
  return value;
}

/**
 * The strings a refusal carries.
 *
 * `BadRequestException.message` is Nest's generic "Bad Request Exception"; the useful part is the
 * array on its response body, which is what reaches the wire and what `utils/apiError.ts` joins for
 * display. Asserting on `.message` would pass for any refusal at all, including one that never
 * named the offending field.
 */
async function refusalMessages(
  method: 'setLines' | 'setFields',
  payload: unknown,
): Promise<string[]> {
  try {
    await send(method, payload);
  } catch (e) {
    const body = (e as BadRequestException).getResponse();
    const message = (body as { message?: unknown }).message;
    return Array.isArray(message) ? (message as string[]) : [String(message)];
  }
  throw new Error('expected the payload to be refused, and it was accepted');
}

const LINE = { lineNo: 1, description: 'x', qty: '1', unitPrice: '5', lineAmount: '5' };

describe('an array body is validated', () => {
  it.each(['setLines', 'setFields'] as const)('%s has a validating pipe bound at all', (m) => {
    // The whole defect in one assertion: there was no pipe here, so nothing below could run.
    expect(bodyPipes(m)).toHaveLength(1);
  });

  describe('setLines', () => {
    it('refuses a line missing lineAmount — the request that answered 500', async () => {
      const { lineAmount: _drop, ...noAmount } = LINE;
      await expect(send('setLines', [noAmount])).rejects.toThrow(BadRequestException);
    });

    it('names the field it refused, so the caller can fix it', async () => {
      const { lineAmount: _drop, ...noAmount } = LINE;
      expect(await refusalMessages('setLines', [noAmount])).toEqual([
        expect.stringContaining('lineAmount'),
      ]);
    });

    it('refuses an unknown field — this answered 204 and ignored it', async () => {
      // `forbidNonWhitelisted` is configured globally and was simply never reaching this body.
      expect(await refusalMessages('setLines', [{ ...LINE, nonsense: 'yes' }])).toEqual([
        expect.stringContaining('nonsense'),
      ]);
    });

    it('refuses a body that is not an array', async () => {
      await expect(send('setLines', LINE)).rejects.toThrow(BadRequestException);
    });

    it('still accepts a valid array, and every element of it', async () => {
      // The assertion that stops the fix from simply breaking the endpoint.
      const out = (await send('setLines', [LINE, { ...LINE, lineNo: 2 }])) as unknown[];
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ lineNo: 1, lineAmount: '5' });
    });

    it('accepts an empty array — clearing a document\'s lines is a legitimate write', async () => {
      await expect(send('setLines', [])).resolves.toEqual([]);
    });
  });

  describe('setFields', () => {
    const FIELD = { formFieldId: '11111111-1111-4111-8111-111111111111', value: 'x' };

    it('refuses a non-UUID formFieldId', async () => {
      expect(await refusalMessages('setFields', [{ ...FIELD, formFieldId: 'not-a-uuid' }])).toEqual([
        expect.stringContaining('formFieldId'),
      ]);
    });

    it('refuses an unknown field', async () => {
      expect(await refusalMessages('setFields', [{ ...FIELD, nonsense: 'yes' }])).toEqual([
        expect.stringContaining('nonsense'),
      ]);
    });

    it('still accepts a valid array', async () => {
      await expect(send('setFields', [FIELD])).resolves.toHaveLength(1);
    });
  });

  it('produces the message shape the web app displays', async () => {
    // `utils/apiError.ts` joins an ARRAY of strings. `ParseArrayPipe` is a different pipe from the
    // global one, so that it produces the same structure is a fact to check, not to assume — a
    // different shape would degrade the toast without failing anything.
    const { lineAmount: _drop, ...noAmount } = LINE;
    let body: unknown;
    try {
      await send('setLines', [noAmount]);
    } catch (e) {
      body = (e as BadRequestException).getResponse();
    }
    expect(Array.isArray((body as { message?: unknown }).message)).toBe(true);
  });
});
