import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/mikro-orm.config';
import {
  BOOTSTRAP_ENV,
  BootstrapRefused,
  bootstrapAdmin,
  redact,
  resolveBootstrapInput,
} from '../src/seed/bootstrap-admin';

/**
 * Creates the first company and the first administrator on a database that has none.
 *
 * Run BY HAND, ONCE, per environment, after `migration:up` and `seed:prod`. It is deliberately not
 * part of the deploy: it creates an account holding the entire permission catalog, and a pipeline
 * that runs on every push to the default branch is not a place where such an account should be
 * able to come into existence unobserved.
 *
 * It refuses a database that already holds any account, so it is a bootstrap rather than a
 * standing back door. Every input is required and nothing defaults — a default administrator
 * password is a published one.
 *
 *   BOOTSTRAP_USERNAME=... BOOTSTRAP_EMAIL=... BOOTSTRAP_PASSWORD=... \
 *   BOOTSTRAP_COMPANY_CODE=... BOOTSTRAP_COMPANY_NAME=... BOOTSTRAP_CURRENCY_CODE=... \
 *   pnpm --filter back bootstrap:admin
 *
 * Set the variables from an env file or a `read -s` prompt rather than inline, so the password
 * does not land in shell history. Sign in and change it through the product afterwards.
 */
async function main(): Promise<void> {
  // Resolved before the ORM connects: a missing variable should cost nothing.
  const input = resolveBootstrapInput(process.env);

  const orm = await MikroORM.init(config);

  try {
    const report = await bootstrapAdmin(orm.em.fork(), input);

    // eslint-disable-next-line no-console
    console.log(
      `bootstrap:admin: created company ${report.companyCode} (${report.companyId}) ` +
        `in ${report.baseCurrency}, department ${report.departmentId}, ADMIN role ${report.roleId} ` +
        `holding ${report.grants} permission codes, and account '${report.username}' ` +
        `(${report.userId}) as its default company.\n` +
        'Sign in and change the password through the product, then create real roles.',
    );
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  // The password reaches this process and can reach an error raised from anywhere below it —
  // a validator, the driver, a constraint. Scrubbed here rather than trusted not to appear.
  // eslint-disable-next-line no-console
  console.error(
    error instanceof BootstrapRefused
      ? redact(message, process.env[BOOTSTRAP_ENV.password] ?? '')
      : `bootstrap:admin FAILED: ${redact(message, process.env[BOOTSTRAP_ENV.password] ?? '')}`,
  );
  process.exit(1);
});
