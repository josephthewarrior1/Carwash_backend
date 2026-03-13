import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data.sqlite');

const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

export default db;
