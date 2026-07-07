import { Seeder } from '@mikro-orm/seeder';
import { seedDatabase } from './seed-data';
import type { EntityManager } from '@mikro-orm/core';

/** Entry point for `mikro-orm seeder:run`; delegates to the reusable seed function. */
export class DatabaseSeeder extends Seeder {
  async run(em: EntityManager): Promise<void> {
    await seedDatabase(em as unknown as import('@mikro-orm/postgresql').EntityManager);
  }
}
