import db from './index';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export function seed() {
  console.log("Seeding database...");

  // Seed an Admin user
  const checkAdmin = db.prepare("SELECT id FROM users WHERE email = ?").get('admin@carwash.com');

  if (!checkAdmin) {
    const adminId = crypto.randomUUID();
    const adminPassword = bcrypt.hashSync('admin123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (id, name, email, password, role, address, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(adminId, 'Super Admin', 'admin@carwash.com', adminPassword, 'admin', 'Admin HQ', '081234567890');
    console.log("Admin user seeded.");
  }

  // Seed default services
  const existingServices = db.prepare("SELECT count(*) as count FROM services").get() as { count: number };

  if (existingServices.count === 0) {
    const insertService = db.prepare(`
      INSERT INTO services (id, name, description, price, vehicle_type)
      VALUES (?, ?, ?, ?, ?)
    `);

    const initialServices = [
      { name: 'Cuci Eksterior Sedan', description: 'Cuci kilat bodi luar sedan', price: 50000, vehicle_type: 'sedan' },
      { name: 'Cuci Lengkap Sedan', description: 'Cuci luar dalam + vakum', price: 80000, vehicle_type: 'sedan' },
      { name: 'Cuci Eksterior SUV', description: 'Cuci kilat bodi luar SUV', price: 60000, vehicle_type: 'suv' },
      { name: 'Cuci Lengkap SUV', description: 'Cuci luar dalam + vakum SUV', price: 100000, vehicle_type: 'suv' },
      { name: 'Cuci Motor Matic/Bebek', description: 'Cuci motor standar', price: 20000, vehicle_type: 'motorcycle' },
      { name: 'Cuci Motor Sport', description: 'Cuci motor sport / moge', price: 30000, vehicle_type: 'motorcycle' }
    ];

    for (const s of initialServices) {
      insertService.run(crypto.randomUUID(), s.name, s.description, s.price, s.vehicle_type);
    }
    console.log("Default services seeded.");
  } else {
    console.log("Services already exist. Skip seeding.");
  }
}

if (require.main === module) {
  seed();
}
