import 'reflect-metadata';
import { MikroORM, RequestContext } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { DeptDocTypeService } from '../src/modules/document/dept-doc-type.service';
import { NumberingService } from '../src/modules/document/numbering.service';
import { CompanyScopeService } from '../src/common/scope/company-scope.service';
import { AccountService } from '../src/modules/accounting/account.service';
import { BudgetBalanceService } from '../src/modules/budget/budget-balance.service';
import { BudgetService } from '../src/modules/budget/budget.service';
import { BudgetCoverageService } from '../src/modules/budget/budget-coverage.service';
import { BudgetPlanService } from '../src/modules/budget/budget-plan.service';
import { PlanImportService } from '../src/modules/budget/plan-import/plan-import.service';
import { formatPlanReport, parsePlanArgs } from '../src/modules/budget/plan-import/plan-report';

/**
 * Load a company's expenditure plan from its own monitoring workbook.
 *
 *   pnpm --filter back import:budget-plan --company HAL --fiscal-year 2026 --dry-run <workbook>
 *
 * Run the dry run first and read all of it: what the plan states, what was created, what was
 * created at zero because the workbook calls it unbudgeted, and what was left out because the
 * workbook states two different figures for it.
 */
async function main(): Promise<void> {
  const args = parsePlanArgs(process.argv.slice(2));
  const orm = await MikroORM.init(config);
  try {
    const plans = new BudgetPlanService(
      orm.em,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      new BudgetCoverageService(orm.em),
      // Only `propose` reaches for this, and the importer raises plans over budgets it has already
      // written — but the constructor asks for it, so it is built rather than faked.
      new BudgetService(
        orm.em,
        new AccountService(orm.em, new CompanyScopeService(orm.em)),
        new BudgetBalanceService(orm.em),
      ),
    );
    // The same per-request identity map the HTTP layer gives every service. Without it MikroORM
    // refuses the global EntityManager that `BudgetPlanService` reaches for, and the import stops
    // after writing its budgets — which is exactly how it failed the first time it was run.
    const result = await RequestContext.create(orm.em, () =>
      new PlanImportService(orm.em, plans).import(args),
    );
    // eslint-disable-next-line no-console
    console.log(formatPlanReport(result));
  } finally {
    await orm.close(true);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`import:budget-plan failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
