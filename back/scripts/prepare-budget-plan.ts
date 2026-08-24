import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { DocCategory } from '../src/common/enums';
import { DocumentType, FormTemplate } from '../src/modules/document/document.entities';
import { Company, FiscalYear } from '../src/modules/multi-company/multi-company.entities';

/**
 * The two configuration rows a company needs before its budget plan can be imported.
 *
 *   pnpm --filter back prepare:budget-plan --company HAL --fiscal-year 2026
 *
 * `import:budget-plan` deliberately refuses to invent either of these — a fiscal year decides
 * which period money may be spent in, and a document type carries the approval route that decides
 * who may approve a budget. Creating them is a separate, explicit act, which is what this is.
 *
 * Both are idempotent: an existing fiscal year or document type is left exactly as it is.
 */
const FILTER_OFF = { filters: { company: false } } as const;

function arg(name: string, fallback?: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  const found =
    i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const value = found ?? fallback;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const companyCode = arg('company');
  const year = Number(arg('fiscal-year'));
  if (!year || Number.isNaN(year)) throw new Error('--fiscal-year must be a year');

  const orm = await MikroORM.init(config);
  try {
    const em = orm.em.fork();
    const company = await em.findOne(Company, { code: companyCode }, FILTER_OFF);
    if (!company) throw new Error(`Company '${companyCode}' does not exist`);

    const done: string[] = [];
    const kept: string[] = [];

    let fy = await em.findOne(FiscalYear, { company: company.id, year }, FILTER_OFF);
    if (fy) kept.push(`fiscal year ${year} (${fy.status})`);
    else {
      fy = em.create(FiscalYear, {
        company,
        year,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        status: 'OPEN',
      });
      em.persist(fy);
      done.push(`fiscal year ${year} 01-01 → 12-31, OPEN`);
    }

    let docType = await em.findOne(
      DocumentType,
      { company: company.id, postAction: 'ACTIVATE_BUDGET' },
      FILTER_OFF,
    );
    if (docType) kept.push(`document type ${docType.code} (ACTIVATE_BUDGET)`);
    else {
      docType = em.create(DocumentType, {
        company,
        code: 'BUDGET_PLAN',
        name: 'ແຜນງົບປະມານ',
        category: DocCategory.FINANCE,
        postAction: 'ACTIVATE_BUDGET',
        requiresBudget: false,
        requiresQuota: false,
        isActive: true,
        // Every other flag left at its entity default: a budget plan names no vendor, no item and
        // no payee, and recognises no expense — it authorises money, it does not spend it.
      } as never);
      em.persist(docType);
      done.push('document type BUDGET_PLAN (post action ACTIVATE_BUDGET)');
    }

    const template = await em.findOne(
      FormTemplate,
      { documentType: docType.id, status: 'PUBLISHED' },
      FILTER_OFF,
    );
    if (template) kept.push(`published form template v${template.version}`);
    else {
      em.persist(em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' }));
      done.push('published form template v1 for BUDGET_PLAN');
    }

    await em.flush();
    // eslint-disable-next-line no-console
    console.log(
      [
        `Company '${companyCode}':`,
        ...done.map((d) => `  created  ${d}`),
        ...kept.map((k) => `  kept     ${k}`),
        done.length ? '' : '  nothing to do',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } finally {
    await orm.close(true);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`prepare:budget-plan failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
