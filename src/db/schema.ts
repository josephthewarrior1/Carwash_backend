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
}

if (require.main === module) {
  createSchema();
}
