import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../src/app.module';
import { AppUser } from '../src/modules/rbac/rbac.entities';
import { DeptDocTypeService } from '../src/modules/document/dept-doc-type.service';
import { FormTemplateService } from '../src/modules/document/form-template.service';
import { DocumentTypeService } from '../src/modules/document/document-type.service';
import { WorkflowConfigService } from '../src/modules/approval/workflow-config.service';
import { ExchangeRateService } from '../src/modules/currency/exchange-rate.service';
import { readConfig } from './golive/config';
import { resolve, UnresolvedReferences } from './golive/resolve';
import { apply } from './golive/apply';

/**
 * Reconcile a database to a go-live config file: routing, form publication, approval chains, rates.
 *
 * Idempotent and re-runnable, like `seed:prod` — applying a file twice changes nothing the second
 * time. Every reference in the file is resolved BEFORE the first write, and one company's
 * reconcile runs in one transaction, because a half-applied routing table is the worst outcome
 * available here: some types raisable and some not, no screen that shows the difference, and no
 * error left on the console.
 *
 * Refuses rather than defaults. A type the file does not mention is left alone and listed.
 *
 *   pnpm --filter back golive:apply golive.HAL.jsonc
 *   pnpm --filter back golive:apply golive.HAL.jsonc --dry-run
 *   pnpm --filter back golive:apply golive.HAL.jsonc --as someone.else
 */

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}
async function main(): Promise<void> {
  const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!path) {
    // eslint-disable-next-line no-console
    console.error('golive:apply FAILED: name the config file. Generate one with `golive:check --template <path>`.');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  // Whose change this is. `--as <username>` names it explicitly; otherwise the bootstrap admin,
  // which is the account `bootstrap:admin` guarantees exists in every environment.
  const actorName = argValue('--as') ?? 'admin';

  const config = readConfig(path);

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  try {
    const em = app.get(EntityManager);
    const actor = await em.fork().findOne(AppUser, { username: actorName }, { filters: { company: false } });
    if (!actor) {
      throw new Error(
        `no user "${actorName}" to attribute this reconcile to. Run \`bootstrap:admin\` first, ` +
          'or name an existing account with --as <username>.',
      );
    }
    // One transaction for the whole company. `--dry-run` reuses it and rolls back at the end, so
    // what it reports is what an apply would actually do rather than a separate prediction of it.
    await em.fork().transactional(async (tx) => {
      const resolved = await resolve(tx, config);
      const result = await apply(
        {
          em: tx,
          mappings: app.get(DeptDocTypeService),
          templates: app.get(FormTemplateService),
          types: app.get(DocumentTypeService),
          workflows: app.get(WorkflowConfigService),
          rates: app.get(ExchangeRateService),
        },
        config,
        resolved,
        actor.id,
      );

      const say = (label: string, lines: string[]): void => {
        if (!lines.length) return;
        // eslint-disable-next-line no-console
        console.log(`\n${label} (${lines.length})\n` + lines.map((l) => `  - ${l}`).join('\n'));
      };
      say(dryRun ? 'WOULD CHANGE' : 'CHANGED', result.changed);
      say('ALREADY AS STATED', result.unchanged);
      say('LEFT ALONE — the file says nothing about these', result.untouched);

      if (dryRun) {
        // eslint-disable-next-line no-console
        console.log('\ngolive:apply --dry-run: rolling back, nothing was written');
        throw new DryRun();
      }
      // eslint-disable-next-line no-console
      console.log(
        `\ngolive:apply: ${config.company} reconciled — ${result.changed.length} change(s). ` +
          'Run `golive:check` to see what is still outstanding.',
      );
    });
  } finally {
    await app.close();
  }
}

/** Rolls the dry run back without it looking like a failure. */
class DryRun extends Error {}

main().catch((error: unknown) => {
  if (error instanceof DryRun) return;
  if (error instanceof UnresolvedReferences) {
    // eslint-disable-next-line no-console
    console.error(`golive:apply FAILED before writing anything: ${error.message}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.error('golive:apply FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
