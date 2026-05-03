import db from '../index';

export function run() {
  db.exec(`
    UPDATE orders
    SET washer_payout = total_amount * 0.70,
        platform_revenue = total_amount * 0.30
    WHERE status = 'done' AND (washer_payout = 0 OR washer_payout IS NULL);
  `);
  console.log('Backfill applied.');
}

if (require.main === module) run();
