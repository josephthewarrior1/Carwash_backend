import db from '../index';

export function up() {
  db.exec(`
    ALTER TABLE orders ADD COLUMN washer_payout REAL DEFAULT 0.0;
    ALTER TABLE orders ADD COLUMN platform_revenue REAL DEFAULT 0.0;

    CREATE TABLE IF NOT EXISTS business_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO business_settings (key, value) VALUES ('commission_rate', '0.70');
  `);
  console.log("Migration: revenue split added.");
}

if (require.main === module) {
  up();
}
