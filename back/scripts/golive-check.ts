import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../src/app.module';
import { ExchangeRateService } from '../src/modules/currency/exchange-rate.service';
import { inspect, type CompanyReport, type Finding, type FindingKind } from './golive/inspect';
import { templateFor } from './golive/template';

/**
 * Reports what stands between a migrated, loginable database and one people can raise documents in.
 *
 * Read-only, and a separate command from `golive:apply` rather than a flag on it — the same split
 * as `permissions:check` / `permissions:sync`, for the same stated reason: "what is this
 * environment missing?" is a question worth being able to ask without changing the answer.
 *
 * It matters more here. This command is useful with no config file in existence, because its output
 * IS the list of questions to put to the customer: which department raises each type, which
 * workflow approves it, whether USD documents continue. Nothing is inferred and nothing is
 * defaulted — a type mapped to no department is reported, never mapped to a guess.
 *
 * Exits non-zero when anything is reported, so a pipeline can gate on it. A company legitimately
 * mid-rollout will have findings, which is why `boot:check` only counts them; this command is run
 * by somebody who asked the question deliberately.
 *
 *   pnpm --filter back golive:check
 *   pnpm --filter back golive:check --company HAL
 *   pnpm --filter back golive:check --template golive.HAL.jsonc --company HAL
 */

/** What to do about each kind of finding, in the words of whoever has to do it. */
const REMEDY: Record<FindingKind, string> = {
  UNMAPPED_TYPE:
    'Decide which department raises this type and under which workflow, then record it in the ' +
    'config file (golive:check --template) and apply it.',
  UNPUBLISHED_TEMPLATE: 'Publish the form template — Settings → Forms, or name it in the config file.',
  PERSON_TARGETED_WORKFLOW:
    'Decide whether this chain should target a role instead. A role may need creating first; ' +
    'this command never rewrites a chain.',
  UNRESOLVABLE_CURRENCY:
    'Decide whether documents in this currency continue. If they do, record a rate; if they do ' +
    'not, deactivate the currency.',
  MISSING_AUTHORING_ROUTE:
    'Set authoring_route to the screen that owns this content. boot:check already fails a deploy ' +
    'on this one.',
  UNMAPPED_ACCOUNT_ROLE:
    'Decide which account plays this role and map it on Accounting → Account roles. The account ' +
    'must exist first; this command never guesses one, because a role pointed at the wrong account ' +
    'produces a ledger that balances and is wrong, while an unmapped one fails loudly.',
};

/** Grouped so a reader sees five decisions rather than fifty lines. */
function render(report: CompanyReport): string {
  const byKind = new Map<FindingKind, Finding[]>();
  for (const f of report.findings) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  const lines = [`\n${report.company}: ${report.findings.length} finding(s)`];
  for (const [kind, findings] of byKind) {
    lines.push(`\n  ${kind} (${findings.length})`);
    for (const f of findings) lines.push(`    - ${f.detail}`);
    lines.push(`    → ${REMEDY[kind]}`);
  }
  return lines.join('\n');
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const companyCode = argValue('--company');
  const templatePath = argValue('--template');

  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  let reports: CompanyReport[];
  try {
    reports = await inspect(app.get(EntityManager).fork(), app.get(ExchangeRateService), companyCode);
  } finally {
    await app.close();
  }

  if (!reports.length) {
    // eslint-disable-next-line no-console
    console.error(
      `golive:check FAILED: no active company${companyCode ? ` with code ${companyCode}` : ''}.`,
    );
    process.exitCode = 1;
    return;
  }

  if (templatePath) {
    writeFileSync(templatePath, templateFor(reports), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`golive:check: wrote ${templatePath} — fill in the blanks and apply with golive:apply`);
  }

  const total = reports.reduce((n, r) => n + r.findings.length, 0);
  if (!total) {
    // eslint-disable-next-line no-console
    console.log(
      `golive:check: ${reports.length} company/companies configured — every active type is ` +
        'raisable, every mapped form is published, and every currency in use resolves a rate',
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    `golive:check: ${total} decision(s) outstanding across ${reports.length} company/companies. ` +
      'None of these is a defect — each is a decision nobody has recorded yet.' +
      reports.filter((r) => r.findings.length).map(render).join('\n'),
  );
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('golive:check FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
