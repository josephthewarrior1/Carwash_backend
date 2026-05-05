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
  if (!serviceColumns.some(col => col.name === 'image_url')) {
    db.exec(`ALTER TABLE services ADD COLUMN image_url TEXT`);
    console.log("Migrated: added image_url column to services.");
  }

  const orderColumns = db.pragma('table_info(orders)') as { name: string }[];
  if (!orderColumns.some(col => col.name === 'completed_at')) {
    db.exec(`ALTER TABLE orders ADD COLUMN completed_at DATETIME`);
    console.log("Migrated: added completed_at column to orders.");
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
}

if (require.main === module) {
  createSchema();
}
