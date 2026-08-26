import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSearch } from './pagination';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../../modules/multi-company/multi-company.entities';
import { Account } from '../../modules/accounting/accounting.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * `withSearch` narrows an already-scoped `where`; it never replaces one.
 *
 * That property is what makes one helper safe across eleven list endpoints. If a term could
 * replace the predicate rather than add to it, every screen wired to it would become a way to read
 * another company's rows — so it is asserted here, once, against a real database rather than by
 * inspecting the object it returns.
 */
describe('withSearch (shape)', () => {
  const where = { isActive: true };

  it('returns the caller’s where untouched for an absent, blank or whitespace term', () => {
    expect(withSearch(where, undefined, ['code'])).toBe(where);
    expect(withSearch(where, '', ['code'])).toBe(where);
    expect(withSearch(where, '   ', ['code'])).toBe(where);
  });

  it('returns it untouched when no field is searchable', () => {
    expect(withSearch(where, 'anything', [])).toBe(where);
  });

  it('keeps the caller’s clauses alongside the match', () => {
    // The scoped predicate must survive: `$and`, never a replacement.
    const result = withSearch(where, 'cash', ['code', 'name']) as Record<string, unknown>;
    expect(result.$and).toEqual([
      where,
      { $or: [{ code: { $ilike: '%cash%' } }, { name: { $ilike: '%cash%' } }] },
    ]);
  });

  it('nests a dotted path through the relation rather than naming an unjoined alias', () => {
    // A flat `{'node.code': cond}` key reaches Postgres as `"node"."code"` — an alias MikroORM
    // never joined — and the query fails outright. Four of the eleven endpoints search a relation.
    const result = withSearch(where, 'opex', ['node.code', 'budgetName']) as Record<string, unknown>;
    expect(result.$and).toEqual([
      where,
      { $or: [{ node: { code: { $ilike: '%opex%' } } }, { budgetName: { $ilike: '%opex%' } }] },
    ]);
  });

  it('trims the term rather than searching for the spaces around it', () => {
    const result = withSearch(where, '  cash  ', ['code']) as Record<string, unknown>;
    expect(result.$and).toEqual([where, { $or: [{ code: { $ilike: '%cash%' } }] }]);
  });
});

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('withSearch (against the database)', () => {
  let orm: MikroORM;
  const ids = { companyA: '', companyB: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    // The SAME searchable text in two companies — the row that must stay invisible.
    em.create(Account, { company: a, code: '5210', name: 'Utilities', accountType: 'EXPENSE', isPostable: true, isActive: true });
    em.create(Account, { company: b, code: '5210', name: 'Utilities', accountType: 'EXPENSE', isPostable: true, isActive: true });
    em.create(Account, { company: a, code: '1010', name: 'Cash on hand', accountType: 'ASSET', isPostable: true, isActive: true });
    await em.flush();
    Object.assign(ids, { companyA: a.id, companyB: b.id });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const search = (term: string | undefined) =>
    orm.em.fork().findAndCount(
      Account,
      withSearch({ company: ids.companyA }, term, ['code', 'name']),
      FILTER_OFF,
    );

  it('narrows the scoped set', async () => {
    const [rows, total] = await search('cash');
    expect(rows.map((r) => r.code)).toEqual(['1010']);
    expect(total).toBe(1);
  });

  it('matches case-insensitively and on a fragment', async () => {
    const [rows] = await search('UTIL');
    expect(rows.map((r) => r.code)).toEqual(['5210']);
  });

  it('returns nothing for a term no row matches', async () => {
    const [rows, total] = await search('zzzz-no-such-account');
    expect(rows).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('cannot reach a matching row in another company', async () => {
    // Both companies hold a '5210 Utilities'. Company A's search must see exactly one.
    const [rows, total] = await search('utilities');
    expect(total).toBe(1);
    expect(rows.every((r) => r.company.id === ids.companyA)).toBe(true);
  });

  it('an absent term leaves the scoped set whole', async () => {
    const [, total] = await search(undefined);
    expect(total).toBe(2);
  });
});
