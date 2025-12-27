import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

let testDb: Database.Database | null = null;

export function getTestDb(): Database.Database {
  if (!testDb) {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');

    // Load schema
    const schemaPath = join(__dirname, '../../../../migrations/001_initial_schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    testDb.exec(schema);
  }
  return testDb;
}

export function resetTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
  getTestDb();
}

export function closeTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}
