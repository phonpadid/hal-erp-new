import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { declaredPermissionCodes, missingPermissionCodes } from '../../seed/seed-data';
import { Permission } from './rbac.entities';

/**
 * What this environment's permission catalog is short of.
 *
 * A code is declared in TypeScript and named by a guard, but it is only grantable if a row exists
 * in `permission`: the admin list reads that table, and granting resolves codes to rows. A code
 * with no row therefore cannot be held by anyone — not by a role, not by an administrator holding
 * every other code — and the capability behind it is unreachable for the whole installation.
 *
 * `permissions:sync` reconciles and `permissions:check` reports, and a deploy runs both
 * (`.github/workflows/deploy.yml`). What neither covers is a database that arrives without a
 * deploy. A restore carries the rows it carried; it does not run a pipeline. That is how this
 * installation came to be twelve codes short — including all four `PERIOD_*` codes, so closing an
 * accounting period could not be done by anybody — with nothing in the product saying so.
 *
 * So the running application asks the same question at startup, and the admin read below asks it
 * again for the screen where someone can act on the answer.
 */
@Injectable()
export class PermissionCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogService.name);

  constructor(private readonly em: EntityManager) {}

  /**
   * Declared codes with no row, sorted.
   *
   * Derived from `declaredPermissionCodes` / `missingPermissionCodes` rather than from a second
   * comparison written here, so this and `permissions:check` cannot come to disagree about what an
   * environment is missing.
   */
  async missing(): Promise<string[]> {
    const rows = await this.em.fork().find(Permission, {}, { fields: ['code'] });
    return missingPermissionCodes(rows.map((p) => p.code));
  }

  /**
   * Report at startup. Read-only, and never fatal.
   *
   * It does not refuse to boot: an installation short of some codes still serves every capability
   * whose codes are present — every document, budget, approval and payment path in daily use — and
   * refusing to start would turn a gap that hides a few pages into a total outage, at the worst
   * moment, the first restart after a restore.
   *
   * It does not insert the rows either. Reconciling is a deliberate, separately invoked act; a
   * write on every process start would change the catalog without anyone asking, on whatever
   * database the process happened to point at.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const missing = await this.missing();
      if (!missing.length) return;

      const declared = declaredPermissionCodes().length;
      this.logger.warn(
        `${missing.length} of ${declared} declared permission code(s) have no row in \`permission\`, ` +
          `so they cannot be granted to anyone:\n` +
          missing.map((c) => `  - ${c}`).join('\n') +
          `\nRun \`pnpm --filter back permissions:sync\` against this database.`,
      );
    } catch (e) {
      // A diagnostic that prevents startup is worse than the thing it reports. If the catalog
      // cannot be read, say so and carry on — the application's own authorization is unaffected
      // by whether this report succeeded.
      this.logger.warn(
        `Could not read the permission catalog to check it: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
