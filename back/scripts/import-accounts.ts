import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { ChartImportService } from '../src/modules/accounting/chart-import/chart-import.service';
import { formatImportReport, parseImportArgs } from '../src/modules/accounting/chart-import/report';

/**
 * Load a company's chart of accounts from its own spreadsheet exports.
 *
 *   pnpm --filter back import:accounts --company HAL --dry-run "data/account/ບັນຊີ (3).xls" ...
 *
 * A bootstrap step for a company being set up, not a route: an upload endpoint carries a
 * permission, a size limit and a result screen, none of which loading a chart once needs.
 *
 * `--dry-run` reports exactly what the real run would do and opens no write transaction. Prefer
 * running it first — the report names every row that could not be placed and every child whose
 * type differs from its parent's, and those are worth reading before 4,000 rows land.
 */
async function main(): Promise<void> {
  const args = parseImportArgs(process.argv.slice(2));
  const orm = await MikroORM.init(config);
  try {
    const result = await new ChartImportService(orm.em).import(args);
    // eslint-disable-next-line no-console
    console.log(formatImportReport(result));
  } finally {
    await orm.close(true);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`import:accounts failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
