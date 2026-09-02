import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { ALL_ENTITIES, dbAvailable } from './test/test-orm';

/**
 * The ORM config discovers entities by globbing and `require()`ing `**\/*.entities.ts` at runtime.
 * Node cannot parse TypeScript, so under vitest that throws before Nest builds anything — which is
 * why `test-orm.ts` has always passed an explicit entity list instead.
 *
 * Replacing the config with the same explicit list is what lets the graph be built at all. It also
 * keeps this test honest about its subject: the question here is whether every provider resolves,
 * not whether a glob finds files, and those are two different failures.
 */
vi.mock('./mikro-orm.config', async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const entities = ALL_ENTITIES;
  // The REAL config apart from discovery — driver, naming strategy, extensions and everything else
  // stay exactly as production has them, so this still builds the application Nest would build.
  return { default: { ...actual.default, entities, entitiesTs: entities } };
});

import { AppModule } from './app.module';

/**
 * Asks Nest to build the whole application, and nothing else.
 *
 * This exists because of a specific failure. `AttendanceModule` declared `LeaveRequestService`,
 * which takes `DocumentSubmitService`, without importing the module that exports it. Nest could not
 * resolve the dependency and refused to build the graph — the application did not start. It stayed
 * that way for THREE slices while 1066 tests passed.
 *
 * What hid it is the pattern every service spec in this repository uses:
 *
 *   new LeaveRequestService(orm.em, scope, resolution, null as never, guard)
 *
 * Constructing a service by hand is the right way to test its behaviour, and it never asks Nest to
 * build anything. So the dependency graph — the one thing that decides whether the application can
 * run at all — was covered by no test at any level. A green suite meant nothing about whether the
 * thing would boot.
 *
 * One `compile()` closes that. It is not a behaviour test and should never grow assertions about
 * behaviour: its whole job is to fail when a provider's module was never imported, a mistake that
 * costs nothing to make and, as this module proved, can go unnoticed indefinitely.
 */
const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('AppModule', () => {
  it('resolves every provider in the application', async () => {
    // `compile()` builds the injector and instantiates providers. A provider whose module was never
    // imported throws UnknownDependenciesException here, exactly as it does at startup.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeTruthy();
    expect(ALL_ENTITIES.length).toBeGreaterThan(0);
    await moduleRef.close();
  }, 60_000);
});
