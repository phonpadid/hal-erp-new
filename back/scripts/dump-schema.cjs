// Offline DDL dump: builds the create-schema SQL purely from entity metadata
// (no DB connection) so the initial migration can be authored without a live
// PostgreSQL. Run after `pnpm build`.
const fs = require('node:fs');
const path = require('node:path');
const { MikroORM } = require('@mikro-orm/postgresql');
const config = require('../dist/mikro-orm.config').default;

// initSync needs an explicit entity array — collect every exported class from
// the compiled *.entities.js files.
function collectEntities(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...collectEntities(full));
    else if (name.endsWith('.entities.js')) {
      const mod = require(full);
      for (const v of Object.values(mod)) if (typeof v === 'function') out.push(v);
    }
  }
  return out;
}

(async () => {
  const entities = collectEntities(path.join(__dirname, '..', 'dist'));
  const orm = await MikroORM.initSync({ ...config, entities, entitiesTs: [] });
  const sql = await orm.schema.getCreateSchemaSQL({ wrap: false });
  process.stdout.write(sql);
  await orm.close(true);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
