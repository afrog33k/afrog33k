import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
const DB_PATH = process.env.DATABASE_PATH || '/app/data/ronald.db';
const MIGRATIONS_PATH = process.env.MIGRATIONS_PATH || '/app/migrations';
let db = null;
export function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        // Run migrations if database is empty
        const tableCount = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get();
        if (tableCount.count === 0) {
            const migrationFile = join(MIGRATIONS_PATH, '001_initial_schema.sql');
            if (existsSync(migrationFile)) {
                const migration = readFileSync(migrationFile, 'utf-8');
                db.exec(migration);
                console.log('Database initialized with schema');
            }
        }
    }
    return db;
}
export function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}
