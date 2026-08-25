import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import { DocCategory } from '../src/common/enums';
import { DocumentType, FormTemplate } from '../src/modules/document/document.entities';
import { Company } from '../src/modules/multi-company/multi-company.entities';
import { SPEND_HISTORY_DOC_TYPE } from '../src/modules/budget/spend-import/spend-import.service';

/**
 * The document type a spend history is raised under.
 *
 *   pnpm --filter back prepare:spend-history --company HAL
 *
 * `import:spend-history` refuses to invent it, for the reason the plan import refuses to invent
 * its own: a document type carries the flags that decide how a document behaves and the route it
 * takes, and that is a configuration decision rather than an import's to make. Its own type is
 * also what lets 1,187 imported documents be told apart from the ones people actually raised.
 *
 * Idempotent: an existing type is left exactly as it is.
 */
const FILTER_OFF = { filters: { company: false } } as const;

function arg(name: string, fallback?: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  const found = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const value = found ?? fallback;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const companyCode = arg('company');
  const orm = await MikroORM.init(config);
  try {
    const em = orm.em.fork();
    const company = await em.findOne(Company, { code: companyCode }, FILTER_OFF);
    if (!company) throw new Error(`Company '${companyCode}' does not exist`);

    const done: string[] = [];
    const kept: string[] = [];

    let docType = await em.findOne(
      DocumentType,
      { company: company.id, code: SPEND_HISTORY_DOC_TYPE },
      FILTER_OFF,
    );
    if (docType) kept.push(`document type ${docType.code}`);
    else {
      docType = em.create(DocumentType, {
        company,
        code: SPEND_HISTORY_DOC_TYPE,
        name: 'ປະຫວັດການໃຊ້ຈ່າຍ (ນຳເຂົ້າ)',
        category: DocCategory.FINANCE,
        // No post action, and `requiresBudget` off: this type raises no reservation of its own.
        // The import writes the ledger pair directly, at the date the spending happened, which is
        // what submitting through the ordinary path could not do.
        requiresBudget: false,
        requiresQuota: false,
        isActive: true,
      } as never);
      em.persist(docType);
      done.push(`document type ${SPEND_HISTORY_DOC_TYPE} (imported spend history)`);
    }

    const template = await em.findOne(
      FormTemplate,
      { documentType: docType.id, status: 'PUBLISHED' },
      FILTER_OFF,
    );
    if (template) kept.push(`published form template v${template.version}`);
    else {
      em.persist(
        em.create(FormTemplate, { documentType: docType, version: 1, status: 'PUBLISHED' }),
      );
      done.push(`published form template v1 for ${SPEND_HISTORY_DOC_TYPE}`);
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
  console.error(
    `prepare:spend-history failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exitCode = 1;
});
