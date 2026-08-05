import { passwordPolicy } from '@erp/shared';
import { Currency } from '../modules/currency/currency.entities';
import { provisionCompany } from '../modules/multi-company/provision-company';
import { PasswordService } from '../modules/rbac/password.service';
import { AppUser, Permission } from '../modules/rbac/rbac.entities';
import type { EntityManager } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Takes a migrated, essentials-seeded database to a state where a person can sign in.
 *
 * `seed:prod` deliberately writes no company and no account, and the demo seeder that would is
 * refused on production because its accounts share a password committed to this repository.
 * Between them sits a database nobody can enter: account creation needs a permission, which needs
 * a token, which needs an account, and there is no public route that creates one. This closes that
 * gap once, by hand, and then refuses to be useful again.
 *
 * The company graph comes from `provisionCompany` — the same function the company-admin endpoint
 * uses. Writing a second copy here would put "what an ADMIN role may do" in two places, and the
 * day they disagree nothing fails: the first administrator simply sees the wrong slice of data.
 */
export const BOOTSTRAP_ENV = {
  username: 'BOOTSTRAP_USERNAME',
  email: 'BOOTSTRAP_EMAIL',
  password: 'BOOTSTRAP_PASSWORD',
  companyCode: 'BOOTSTRAP_COMPANY_CODE',
  companyName: 'BOOTSTRAP_COMPANY_NAME',
  currencyCode: 'BOOTSTRAP_CURRENCY_CODE',
} as const;

// `-readonly` because BOOTSTRAP_ENV is `as const`: without it every field inherits the literal
// map's readonly-ness and the resolver cannot fill the object it is building.
export type BootstrapAdminInput = { -readonly [K in keyof typeof BOOTSTRAP_ENV]: string };

export interface BootstrapAdminReport {
  userId: string;
  username: string;
  companyId: string;
  companyCode: string;
  roleId: string;
  departmentId: string;
  /** Permission codes granted to the ADMIN role. */
  grants: number;
  baseCurrency: string;
}

/** Everything this command declines to do. Separate from a crash so the wrapper can report it plainly. */
export class BootstrapRefused extends Error {
  constructor(message: string) {
    super(`bootstrap refused: ${message}`);
    this.name = 'BootstrapRefused';
  }
}

/**
 * Reads the inputs from the environment, naming the variable that is missing.
 *
 * No value defaults. A default administrator password is a published administrator password, and
 * whether the operator later changes it has never been what decides if it gets changed.
 */
export function resolveBootstrapInput(env: NodeJS.ProcessEnv): BootstrapAdminInput {
  const resolved = {} as BootstrapAdminInput;

  for (const [field, variable] of Object.entries(BOOTSTRAP_ENV) as [keyof BootstrapAdminInput, string][]) {
    const value = env[variable]?.trim();
    if (!value) {
      throw new BootstrapRefused(`${variable} is not set`);
    }
    resolved[field] = value;
  }

  return resolved;
}

/** Replaces a secret wherever it appears, so an error carrying an input cannot print it. */
export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('«redacted»') : text;
}

export async function bootstrapAdmin(
  em: EntityManager,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminReport> {
  for (const [field, variable] of Object.entries(BOOTSTRAP_ENV) as [keyof BootstrapAdminInput, string][]) {
    if (!input[field]?.trim()) throw new BootstrapRefused(`${variable} is empty`);
  }

  // The same policy the product enforces when a user changes their own password, so the bootstrap
  // cannot mint a credential the product would refuse.
  const policy = passwordPolicy.safeParse(input.password);
  if (!policy.success) {
    throw new BootstrapRefused(`${BOOTSTRAP_ENV.password} — ${policy.error.issues[0]?.message}`);
  }

  // Prerequisites. Both failures are silent rather than loud if they are not checked: a role with
  // no grants, or a company with no base currency, is a bootstrap that reports success and leaves
  // an administrator who can see nothing.
  if ((await em.count(Permission, {}, FILTER_OFF)) === 0) {
    throw new BootstrapRefused(
      'the permission catalog is empty — run `pnpm --filter back seed:prod` first',
    );
  }
  const currency = await em.findOne(Currency, { code: input.currencyCode, isActive: true }, FILTER_OFF);
  if (!currency) {
    throw new BootstrapRefused(
      `'${input.currencyCode}' is not an active currency — run \`pnpm --filter back seed:prod\` first, ` +
        'or name one of the currencies it seeded',
    );
  }

  // Run-once. Not "no admin exists" and not "this username is free": a database holding accounts
  // has a way in even when the operator has lost it, and the answer to a lost administrator is a
  // grant against the account that exists — not a second all-permissions account beside it.
  const accounts = await em.count(AppUser, {}, FILTER_OFF);
  if (accounts > 0) {
    throw new BootstrapRefused(
      `this database already holds ${accounts} account(s) — it has been bootstrapped. ` +
        'To restore access to an existing account, grant it a role; do not create another.',
    );
  }

  const passwordHash = await new PasswordService().hash(input.password);

  // One transaction. Not for contention — for the guard above: a run that created the company but
  // not the account would leave a database that still answers "no accounts", and the next run
  // would bootstrap a second company beside the first.
  return em.transactional(async (tx) => {
    const user = tx.create(AppUser, {
      username: input.username,
      email: input.email,
      passwordHash,
      status: 'ACTIVE',
      // Login rejects an unverified account, verification arrives by email, and a freshly
      // provisioned server has no mail transport — the deploy logs say so itself. The operator
      // setting these variables holds the database credentials, so the mailbox proves less than
      // what they have already proven. This stays confined here: accounts created through the
      // product still verify.
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    });
    tx.persist(user);

    const provisioned = await provisionCompany(tx, {
      code: input.companyCode,
      nameTh: input.companyName,
      nameEn: input.companyName,
      // Re-read inside the transaction: the row found during the checks above belongs to another
      // fork, and a reference to it here is a currency this unit of work believes it must insert.
      baseCurrency: await tx.findOneOrFail(Currency, { code: currency.code }, FILTER_OFF),
      creator: user,
      // The first membership of the first account: login auto-selects a default company, and
      // otherwise auto-selects only when the account belongs to exactly one.
      isDefault: true,
    });

    return {
      userId: user.id,
      username: user.username,
      companyId: provisioned.company.id,
      companyCode: provisioned.company.code,
      roleId: provisioned.adminRole.id,
      departmentId: provisioned.department.id,
      grants: provisioned.grants,
      baseCurrency: input.currencyCode,
    };
  });
}
