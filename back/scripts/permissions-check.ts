import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { Permission } from '../src/modules/rbac/rbac.entities';
import { declaredPermissionCodes, missingPermissionCodes } from '../src/seed/seed-data';

/**
 * Reports whether an environment holds a row for every permission code the guards check.
 *
 * Read-only on purpose, and a separate command from `permissions:sync` rather than a flag on it:
 * "what is this environment missing?" is a question worth being able to ask without changing the
 * answer. A deploy runs it after the sync, so a forgotten or half-applied reconcile stops the
 * deploy instead of surfacing later as a 403 nobody can explain.
 *
 * Extra rows are not an error. The catalog is additive by design — a code retired from the source
 * keeps its row so existing grants stay valid — so only MISSING codes fail this check.
 *
 * Run with `pnpm --filter back permissions:check`. Requires a reachable database.
 */
async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  try {
    const em = orm.em.fork();
    const declared = declaredPermissionCodes();
    const rows = await em.find(Permission, {}, { fields: ['code'] });
    const missing = missingPermissionCodes(rows.map((p) => p.code));

    if (missing.length) {
      // eslint-disable-next-line no-console
      console.error(
        `permissions:check FAILED: ${missing.length} of ${declared.length} declared code(s) have no row:\n` +
          missing.map((c) => `  - ${c}`).join('\n') +
          `\nRun \`pnpm --filter back permissions:sync\` against this database.`,
      );
      process.exitCode = 1;
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`permissions:check: all ${declared.length} declared code(s) present`);
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('permissions:check FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
