import 'reflect-metadata';
import { MikroORM, RequestContext } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { NumberingService } from '../src/modules/document/numbering.service';
import { BudgetBalanceService } from '../src/modules/budget/budget-balance.service';
import { BudgetCoverageService } from '../src/modules/budget/budget-coverage.service';
import { BudgetLedgerService } from '../src/modules/budget/budget-ledger.service';
import { SpendImportService } from '../src/modules/budget/spend-import/spend-import.service';
import {
  formatSpendReport,
  parseSpendArgs,
} from '../src/modules/budget/spend-import/spend-report';

/**
 * Load a company's recorded expenditure from its own monitoring workbook.
 *
 *   pnpm --filter back import:spend-history --company HAL --fiscal-year 2026 --dry-run <workbook>
 *
 * Run the dry run first and compare its per-quarter totals against the customer's own sheet. This
 * is the one importer that writes the append-only budget ledger: a wrong figure here cannot be
 * deleted afterwards, only answered with a compensating entry.
 */
async function main(): Promise<void> {
  const args = parseSpendArgs(process.argv.slice(2));
  const orm = await MikroORM.init(config);
  try {
    const balance = new BudgetBalanceService(orm.em);
    const coverage = new BudgetCoverageService(orm.em);
    const ledger = new BudgetLedgerService(orm.em, balance, coverage);
    const service = new SpendImportService(
      orm.em,
      ledger,
      new NumberingService(orm.em),
      coverage,
    );
    // The per-request identity map the HTTP layer gives every service. Without it MikroORM refuses
    // the global EntityManager these services reach for — which is how the plan import failed
    // silently the first time it was run for real.
    const result = await RequestContext.create(orm.em, () => service.import(args));
    // eslint-disable-next-line no-console
    console.log(formatSpendReport(result));
  } finally {
    await orm.close(true);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `import:spend-history failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
