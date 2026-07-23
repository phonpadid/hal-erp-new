import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

/**
 * Boots the real Nest dependency-injection container and exits.
 *
 * Every spec in this repo constructs services by hand (`new FooService(dep)`) — fast, and it keeps
 * unit tests honest about what a service actually needs. The cost is that the container itself is
 * never exercised, so a provider Nest cannot resolve passes the entire suite and fails only when
 * someone starts the app.
 *
 * That is exactly how an interface-typed constructor parameter shipped: `CostingStrategy` has no
 * runtime representation, so Nest saw `Object`, found no provider, and threw at startup while the
 * whole suite stayed green. This script is the guard for that class of mistake — unresolvable
 * providers, missing module imports, and circular module dependencies all surface here.
 *
 * Lives as a script rather than a spec because it needs MikroORM's real entity discovery and a
 * live database, neither of which survives the Vitest/SWC transform of the `*.entities.ts` glob.
 *
 * Run with `pnpm --filter back boot:check`. Requires a reachable database.
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  await app.close();
  // eslint-disable-next-line no-console
  console.log('boot-check: every provider resolved');
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('boot-check FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
