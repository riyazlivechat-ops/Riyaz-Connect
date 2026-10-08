const { pool, migrate } = require('./index');

migrate()
  .then(() => console.log('Database schema is up to date.'))
  .catch((err) => { console.error('Migration failed:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
