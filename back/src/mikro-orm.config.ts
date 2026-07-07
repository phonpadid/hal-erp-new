import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, UnderscoreNamingStrategy } from '@mikro-orm/postgresql';
import { SeedManager } from '@mikro-orm/seeder';

/**
 * The MikroORM CLI (migration:up / seeder:run) loads this file directly and does NOT
 * boot Nest, so ConfigModule never runs and `.env` would otherwise be ignored — the CLI
 * would fall back to the default credentials below and hit the wrong role. Load `.env`
 * here (idempotent; harmless under the Nest runtime where ConfigModule already did it).
 * Tolerate a missing file so CI/prod can supply vars via the real environment instead.
 */
try {
  process.loadEnvFile();
} catch {
  // no .env present — rely on the ambient environment.
}

/**
 * Single MikroORM config consumed by both the Nest runtime (MikroOrmModule.forRoot)
 * and the CLI (migration:create / migration:up / schema:update).
 *
 * Money invariant: `decimal` columns are returned as strings, never JS numbers
 * — MikroORM does this by default for decimal properties typed `string`.
 */
export default defineConfig({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? 'erp',
  password: process.env.DB_PASSWORD ?? 'erp',
  dbName: process.env.DB_NAME ?? 'erp',

  // Discover compiled entities at runtime, TS sources under the CLI/ts-node.
  entities: ['dist/**/*.entities.js'],
  entitiesTs: ['src/**/*.entities.ts'],

  // camelCase entity props → snake_case columns / tables, matching the DBML.
  namingStrategy: UnderscoreNamingStrategy,
  // Undefined (not null) values are skipped on insert so DB defaults apply.
  forceUndefined: true,

  extensions: [Migrator, SeedManager],
  migrations: {
    path: 'dist/migrations',
    pathTs: 'src/migrations',
    snapshot: true,
  },
  seeder: {
    path: 'dist/seed',
    pathTs: 'src/seed',
    defaultSeeder: 'DatabaseSeeder',
    // Only load seeder classes — never the *.spec.ts files alongside them.
    glob: '*.seeder.{js,ts}',
  },

  debug: process.env.NODE_ENV === 'development',
});
