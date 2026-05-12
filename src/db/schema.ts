import db from './index';

export function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('customer', 'employee', 'admin')) NOT NULL,
      address TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      duration INTEGER NOT NULL DEFAULT 60,
      vehicle_type TEXT CHECK(vehicle_type IN ('sedan', 'suv', 'truck', 'motorcycle')) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      service_id TEXT NOT NULL,
      assigned_employee_id TEXT,
      vehicle_plate TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'confirmed', 'on_the_way', 'in_progress', 'done', 'cancelled')) NOT NULL DEFAULT 'pending',
      location_address TEXT NOT NULL,
      location_lat REAL,
      location_lng REAL,
      scheduled_at DATETIME NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (assigned_employee_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      changed_by_user_id TEXT NOT NULL,
      note TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
    );
  `);
  console.log("Database schema created successfully.");

  const serviceColumns = db.pragma('table_info(services)') as { name: string }[];
  if (!serviceColumns.some(col => col.name === 'duration')) {
    db.exec(`ALTER TABLE services ADD COLUMN duration INTEGER NOT NULL DEFAULT 60`);
    console.log("Migrated: added duration column to services.");
  }
  if (!serviceColumns.some(col => col.name === 'is_active')) {
    db.exec(`ALTER TABLE services ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }
  if (!serviceColumns.some(col => col.name === 'image_url')) {
    db.exec(`ALTER TABLE services ADD COLUMN image_url TEXT`);
    console.log("Migrated: added image_url column to services.");
  }

  const orderColumns = db.pragma('table_info(orders)') as { name: string }[];
  if (!orderColumns.some(col => col.name === 'completed_at')) {
    db.exec(`ALTER TABLE orders ADD COLUMN completed_at DATETIME`);
    console.log("Migrated: added completed_at column to orders.");
  }
  if (!orderColumns.some(col => col.name === 'before_photo_url')) {
    db.exec(`ALTER TABLE orders ADD COLUMN before_photo_url TEXT`);
  }
  if (!orderColumns.some(col => col.name === 'after_photo_url')) {
    db.exec(`ALTER TABLE orders ADD COLUMN after_photo_url TEXT`);
  }
  if (!orderColumns.some(col => col.name === 'cancellation_reason')) {
    db.exec(`ALTER TABLE orders ADD COLUMN cancellation_reason TEXT`);
  }
  if (!orderColumns.some(col => col.name === 'cancelled_by')) {
    db.exec(`ALTER TABLE orders ADD COLUMN cancelled_by TEXT`);
  }
  if (!orderColumns.some(col => col.name === 'accepted_at')) {
    db.exec(`ALTER TABLE orders ADD COLUMN accepted_at DATETIME`);
  }
  if (!orderColumns.some(col => col.name === 'started_at')) {
    db.exec(`ALTER TABLE orders ADD COLUMN started_at DATETIME`);
  }
  if (!orderColumns.some(col => col.name === 'deleted_at')) {
    db.exec(`ALTER TABLE orders ADD COLUMN deleted_at DATETIME`);
  }

  // The original orders table was created with a restrictive CHECK constraint
  // that doesn't allow new statuses (assigned, no_show, failed). SQLite can't
  // ALTER a CHECK, so detect and rebuild the table without the constraint.
  //
  // `legacy_alter_table = ON` is critical: it stops ALTER TABLE RENAME from
  // updating foreign-key references in other tables. Without it, the FK on
  // order_status_history follows the rename to `orders_legacy` and then dangles
  // once we drop that table.
  const orderSqlRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'`
  ).get() as { sql: string } | undefined;
  if (orderSqlRow && /CHECK\(status IN/.test(orderSqlRow.sql)
      && !/'assigned'/.test(orderSqlRow.sql)) {
    console.log("Migrating: rebuilding orders table to drop legacy CHECK constraint...");
    db.exec(`
      PRAGMA legacy_alter_table = ON;
      PRAGMA foreign_keys = OFF;
      BEGIN;
      ALTER TABLE orders RENAME TO orders_legacy;
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        assigned_employee_id TEXT,
        vehicle_plate TEXT NOT NULL,
        vehicle_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        location_address TEXT NOT NULL,
        location_lat REAL,
        location_lng REAL,
        scheduled_at DATETIME NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        washer_payout REAL DEFAULT 0.0,
        platform_revenue REAL DEFAULT 0.0,
        total_amount REAL DEFAULT 0.0,
        payment_status TEXT,
        xendit_invoice_id TEXT,
        xendit_invoice_url TEXT,
        before_photo_url TEXT,
        after_photo_url TEXT,
        cancellation_reason TEXT,
        cancelled_by TEXT,
        accepted_at DATETIME,
        started_at DATETIME,
        deleted_at DATETIME
      );
      INSERT INTO orders
        SELECT id, customer_id, service_id, assigned_employee_id, vehicle_plate, vehicle_type,
               status, location_address, location_lat, location_lng, scheduled_at, notes,
               created_at, completed_at,
               COALESCE(washer_payout, 0.0),
               COALESCE(platform_revenue, 0.0),
               COALESCE(total_amount, 0.0),
               payment_status, xendit_invoice_id, xendit_invoice_url,
               before_photo_url, after_photo_url, cancellation_reason, cancelled_by,
               accepted_at, started_at, deleted_at
        FROM orders_legacy;
      DROP TABLE orders_legacy;
      COMMIT;
      PRAGMA foreign_keys = ON;
      PRAGMA legacy_alter_table = OFF;
    `);
    console.log("Migrated: orders table rebuilt without CHECK constraint.");
  }

  // Fix the previous failed migration: if order_status_history.order_id FK
  // still points at the (now dropped) orders_legacy table, rebuild it so its
  // FK references the real orders table again.
  const oshSqlRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='order_status_history'`
  ).get() as { sql: string } | undefined;
  if (oshSqlRow && /orders_legacy/.test(oshSqlRow.sql)) {
    console.log("Migrating: repairing order_status_history FK reference...");
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE order_status_history_new (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        status TEXT NOT NULL,
        changed_by_user_id TEXT NOT NULL,
        note TEXT,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
      );
      INSERT INTO order_status_history_new
        SELECT id, order_id, status, changed_by_user_id, note, changed_at
        FROM order_status_history;
      DROP TABLE order_status_history;
      ALTER TABLE order_status_history_new RENAME TO order_status_history;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
    console.log("Migrated: order_status_history FK repaired.");
  }
  if (!orderColumns.some(col => col.name === 'washer_payout')) {
    db.exec(`ALTER TABLE orders ADD COLUMN washer_payout REAL DEFAULT 0.0`);
    console.log("Migrated: added washer_payout column to orders.");
  }
  if (!orderColumns.some(col => col.name === 'platform_revenue')) {
    db.exec(`ALTER TABLE orders ADD COLUMN platform_revenue REAL DEFAULT 0.0`);
    console.log("Migrated: added platform_revenue column to orders.");
  }
  if (!orderColumns.some(col => col.name === 'total_amount')) {
    db.exec(`ALTER TABLE orders ADD COLUMN total_amount REAL DEFAULT 0.0`);
    console.log("Migrated: added total_amount column to orders.");
  }
  if (!orderColumns.some(col => col.name === 'payment_status')) {
    db.exec(`ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT NULL`);
    console.log("Migrated: added payment_status column to orders.");
  }
  if (!orderColumns.some(col => col.name === 'xendit_invoice_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN xendit_invoice_id TEXT DEFAULT NULL`);
    console.log("Migrated: added xendit_invoice_id column to orders.");
  }
  if (!orderColumns.some(col => col.name === 'xendit_invoice_url')) {
    db.exec(`ALTER TABLE orders ADD COLUMN xendit_invoice_url TEXT DEFAULT NULL`);
    console.log("Migrated: added xendit_invoice_url column to orders.");
  }

  const userColumns = db.pragma('table_info(users)') as { name: string }[];
  if (!userColumns.some(col => col.name === 'avatar_url')) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
    console.log("Migrated: added avatar_url column to users.");
  }

  // Ensure inventory_items table exists (from older one-off migration)
  const inventoryColumns = db.pragma('table_info(inventory_items)') as { name: string }[];
  if (!inventoryColumns || inventoryColumns.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        current_stock INTEGER NOT NULL DEFAULT 0,
        minimum_stock INTEGER NOT NULL DEFAULT 0,
        maximum_stock INTEGER NOT NULL DEFAULT 10,
        unit_price REAL DEFAULT 0.0,
        unit TEXT DEFAULT 'pcs',
        last_restocked DATETIME,
        FOREIGN KEY (employee_id) REFERENCES users(id)
      );
    `);
    console.log("Migrated: created inventory_items table.");
  }

  // Ensure supply_requests exists and has batch_id column
  const supplyColumns = db.pragma('table_info(supply_requests)') as { name: string }[];
  if (!supplyColumns || supplyColumns.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS supply_requests (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        quantity_requested INTEGER NOT NULL DEFAULT 1,
        status TEXT CHECK(status IN ('pending','approved','rejected')) NOT NULL DEFAULT 'pending',
        batch_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES users(id)
      );
    `);
    console.log("Migrated: created supply_requests table.");
  } else if (!supplyColumns.some(col => col.name === 'batch_id')) {
    db.exec(`ALTER TABLE supply_requests ADD COLUMN batch_id TEXT`);
    console.log("Migrated: added batch_id column to supply_requests.");
  }
  
  // Ensure business_settings table exists
  const settingsTable = db.pragma('table_info(business_settings)') as { name: string }[];
  if (!settingsTable || settingsTable.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS business_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    console.log("Migrated: created business_settings table.");
  }

  // ─── Notifications ────────────────────────────────────────
  const notifColumns = db.pragma('table_info(notifications)') as { name: string }[];
  if (!notifColumns || notifColumns.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        order_id TEXT,
        read_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    console.log("Migrated: created notifications table.");
  }

  // ─── Payouts ──────────────────────────────────────────────
  const payoutColumns = db.pragma('table_info(payouts)') as { name: string }[];
  if (!payoutColumns || payoutColumns.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS payouts (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        amount REAL NOT NULL,
        period_start DATETIME NOT NULL,
        period_end DATETIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        paid_at DATETIME,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES users(id)
      );
    `);
    console.log("Migrated: created payouts table.");
  }
}

if (require.main === module) {
  createSchema();
}
