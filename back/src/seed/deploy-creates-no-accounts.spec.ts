import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = join(__dirname, '../../../.github/workflows/deploy.yml');

/**
 * The deploy must never mint an administrator.
 *
 * Two commands in this repository create loginable accounts: the demo seeder, whose accounts share
 * a password committed here, and `bootstrap:admin`, whose single account holds the entire
 * permission catalog. Neither belongs in a pipeline that runs on every push to the default branch —
 * an account that comes into existence there comes into existence unobserved.
 *
 * The prohibition was previously only a comment. A comment is not checked, and the step that would
 * violate it is one word different from the step that is correct (`seed` vs `seed:prod`).
 */
describe('the deploy creates no accounts', () => {
  const source = readFileSync(WORKFLOW, 'utf8');
  // Comments in this file name the forbidden commands in order to forbid them — in YAML and in the
  // bash heredoc alike. What is asserted below is what the runner would execute, not what it reads.
  const workflow = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  it('runs the catalog-only seed, never the demo seeder', () => {
    expect(workflow).toContain('seed:prod');
    // `seeder:run` and a bare `pnpm --filter back seed` both reach DatabaseSeeder.
    expect(workflow).not.toMatch(/seeder:run/);
    expect(workflow).not.toMatch(/--filter back seed\s*$/m);
    expect(workflow).not.toMatch(/SEED_DEMO/);
  });

  it('never runs the production bootstrap', () => {
    expect(workflow).not.toMatch(/bootstrap:admin/);
    // Nor by reaching around the package script to the file it points at.
    expect(workflow).not.toMatch(/bootstrap-admin/);
  });

  it('passes no bootstrap credential to the host', () => {
    expect(workflow).not.toMatch(/BOOTSTRAP_/);
  });
});
