import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { MOVEMENT_POST_ACTIONS, POST_JOURNAL } from '@erp/shared';
import { DocumentType } from '../src/modules/document/document.entities';
import { PLAN_POST_ACTION } from '../src/modules/budget/budget-plan.service';

/**
 * Boots the real Nest dependency-injection container and exits.
 *
 * Every spec in this repo constructs services by hand (`new FooService(dep)`) — fast, and it keeps
 * unit tests honest about what a service actually needs. The cost is that the container itself is
 * never exercised, so a provider Nest cannot resolve passes the entire suite and fails only when
 * someone starts the app.
 *
 * That is exactly how an interface-typed constructor parameter shipped: `CostingStrategy` has no
 * runtime representation, so Nest saw `Object`, found no provider, and threw at startup while the
 * whole suite stayed green. This script is the guard for that class of mistake — unresolvable
 * providers, missing module imports, and circular module dependencies all surface here.
 *
 * Lives as a script rather than a spec because it needs MikroORM's real entity discovery and a
 * live database, neither of which survives the Vitest/SWC transform of the `*.entities.ts` glob.
 *
 * Run with `pnpm --filter back boot:check`. Requires a reachable database.
 */
/**
 * Post-actions whose content lives OUTSIDE `document_line` and `doc_field_value` — on
 * `budget_movement` or `journal_voucher` — where the generic create form cannot write it.
 *
 * A type like this offered in the wizard walks the requester through four steps, spends a document
 * number, and is refused at submit for carrying no movement. `document_type.authoring_route` exists
 * to send them to the screen that CAN author it, and `CreateDocumentView` already honours it — the
 * customer's imported `BUDGET_PLAN` simply had none, so nothing redirected.
 *
 * Reported, never inferred: `document-engine` states the route "SHALL NOT be derived from
 * `post_action`" — that column answers what full approval does, which is a different question from
 * where the content is written, and deriving one from the other puts the answer in code rather than
 * configuration (invariant 7). So this names the suspects and leaves the fix to a human.
 */
const CONTENT_LIVES_ELSEWHERE = [
  ...MOVEMENT_POST_ACTIONS,
  PLAN_POST_ACTION,
  POST_JOURNAL,
] as const;

async function checkAuthoringRoutes(app: INestApplicationContext): Promise<string[]> {
  const em = app.get(EntityManager).fork();
  const stranded = await em.find(
    DocumentType,
    {
      isActive: true,
      postAction: { $in: [...CONTENT_LIVES_ELSEWHERE] },
      $or: [{ authoringRoute: null }, { authoringRoute: '' }],
    },
    { filters: { company: false }, populate: ['company'] },
  );
  return stranded.map(
    (t) => `${t.company.code}/${t.code} (post_action ${t.postAction}) has no authoring_route`,
  );
}

/**
 * Whether the front-end's configured API origin points at the port this backend will bind.
 *
 * Both values live in gitignored `.env` files, so they drift per machine while the committed
 * configuration stays consistent — `back/.env.example` and both READMEs say 3000, and `main.ts`
 * defaults to it. When a local override disagrees, every request fails at the network layer and
 * the login screen reports a connection error naming neither file. Checked here so the answer is
 * a command away.
 *
 * Absent or unparseable front-end config is not a failure: a backend-only checkout has no
 * `front-end/.env` to agree with.
 */
function checkApiOrigin(): string | null {
  const backendPort = process.env.PORT ?? '3000';
  let raw: string;
  try {
    raw = readFileSync(resolve(__dirname, '../../front-end/.env'), 'utf8');
  } catch {
    return null;
  }
  const declared = /^\s*VITE_API_URL\s*=\s*(.+)$/m.exec(raw)?.[1]?.trim();
  if (!declared) return null;
  let frontendPort: string;
  try {
    const url = new URL(declared);
    frontendPort = url.port || (url.protocol === 'https:' ? '443' : '80');
    // Only a localhost origin is this check's business: a deployed origin behind a proxy is
    // expected to differ from whatever port the process binds.
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
  } catch {
    return null;
  }
  if (frontendPort === backendPort) return null;
  return (
    `front-end/.env VITE_API_URL calls port ${frontendPort} (${declared}), but the backend binds ` +
    `port ${backendPort} (back/.env PORT, default 3000). The browser would get ` +
    'ERR_CONNECTION_REFUSED on login. Change whichever of the two is wrong for this machine.'
  );
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();

  const strandedTypes = await checkAuthoringRoutes(app);
  await app.close();

  const originMismatch = checkApiOrigin();
  if (originMismatch) {
    // eslint-disable-next-line no-console
    console.error(`boot-check FAILED: ${originMismatch}`);
    process.exit(1);
  }

  if (strandedTypes.length) {
    // eslint-disable-next-line no-console
    console.error(
      'boot-check FAILED: these document types are offered in the create wizard but their ' +
        'content cannot be authored there, so every attempt spends a document number on a draft ' +
        'that can never be submitted. Set authoring_route to the screen that owns each:\n  ' +
        strandedTypes.join('\n  '),
    );
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(
    'boot-check: every provider resolved; every content-elsewhere type names its screen; ' +
      'the front-end calls the port this backend binds',
  );
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('boot-check FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
