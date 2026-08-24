import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Company } from '../../multi-company/multi-company.entities';
import { Account } from '../accounting.entities';
import { planChart } from './merge';
import { readChartFile } from './workbook-reader';
import type { ChartPlan } from './merge';

const FILTER_OFF = { filters: { company: false } } as const;

export interface ImportOptions {
  /** The company's `code`, required. There is no default, however few companies exist. */
  companyCode: string;
  files: string[];
  /** Report what would happen and open no write transaction. */
  dryRun?: boolean;
}

export interface ImportResult {
  companyCode: string;
  companyId: string;
  dryRun: boolean;
  created: number;
  unchanged: number;
  plan: ChartPlan;
  /** Codes already in the company, left exactly as they were. */
  unchangedCodes: string[];
}

/**
 * Load a company's chart of accounts from its own spreadsheet exports.
 *
 * A bootstrap step, not a route: an upload endpoint carries a permission, a size limit and a
 * result screen, and none of that is what loading a chart once needs. What it does carry is the
 * company-isolation invariant — every row it writes is stamped with the company named on the
 * command line, and a run that names none is refused before a file is opened.
 */
@Injectable()
export class ChartImportService {
  constructor(private readonly em: EntityManager) {}

  async import(opts: ImportOptions): Promise<ImportResult> {
    if (!opts.companyCode) {
      throw new Error('A company code is required: this import never picks one for you');
    }
    if (!opts.files.length) throw new Error('At least one chart file is required');

    const em = this.em.fork();
    const company = await em.findOne(Company, { code: opts.companyCode }, FILTER_OFF);
    if (!company) {
      throw new Error(`Company '${opts.companyCode}' does not exist`);
    }

    // Read and plan BEFORE opening any transaction, so a bad file costs nothing and a dry run is
    // the same code path as the real one right up to the write.
    const plan = planChart(opts.files.flatMap((f) => readChartFile(f)));

    const existing = await em.find(Account, { company: company.id }, { ...FILTER_OFF, fields: ['code'] });
    const existingCodes = new Set(existing.map((a) => a.code));
    const toCreate = plan.accounts.filter((a) => !existingCodes.has(a.code));
    const unchangedCodes = plan.accounts.filter((a) => existingCodes.has(a.code)).map((a) => a.code);

    const result: ImportResult = {
      companyCode: opts.companyCode,
      companyId: company.id,
      dryRun: !!opts.dryRun,
      created: toCreate.length,
      unchanged: unchangedCodes.length,
      plan,
      unchangedCodes,
    };
    if (opts.dryRun) return result;

    await em.transactional(async (tem) => {
      // Two passes: every account parentless first, then the links. A self-referencing tree cannot
      // be inserted in dependency order without sorting it, and the sort is the part most likely
      // to be wrong. One transaction, so a failure part-way leaves the chart as it was.
      const byCode = new Map<string, Account>();
      for (const a of toCreate) {
        byCode.set(
          a.code,
          tem.create(Account, {
            company: tem.getReference(Company, company.id),
            code: a.code,
            name: a.name,
            accountType: a.accountType,
            isPostable: a.isPostable,
            isActive: true,
          }),
        );
      }
      await tem.flush();

      // A parent may already be in the company from an earlier run, so the lookup falls back to
      // what is stored rather than only to what this run created.
      for (const a of toCreate) {
        if (!a.parentCode) continue;
        const parent =
          byCode.get(a.parentCode) ??
          (await tem.findOne(Account, { company: company.id, code: a.parentCode }, FILTER_OFF));
        if (parent) byCode.get(a.code)!.parent = parent;
      }
      await tem.flush();
    });

    return result;
  }
}
