import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Note } from './types';

const DB_NAME = 'scenenote';
const DB_VERSION = 1;

interface SceneNoteDB extends DBSchema {
  notes: { key: string; value: Note };
  images: { key: string; value: ArrayBuffer };
}

let dbPromise: Promise<IDBPDatabase<SceneNoteDB>> | null = null;

function getDb(): Promise<IDBPDatabase<SceneNoteDB>> {
  if (!dbPromise) {
    const opening = openDB<SceneNoteDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('notes', { keyPath: 'id' });
        // Out-of-line keys: the note id is the key, the value is the raw JPEG bytes.
        db.createObjectStore('images');
      },
      terminated() {
        // The browser dropped the connection; reopen on the next call.
        dbPromise = null;
      },
    });
    dbPromise = opening;
    // Do not cache a failed open, so a later call can retry.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
  }
  return dbPromise;
}

export async function putNote(n: Note): Promise<void> {
  const db = await getDb();
  await db.put('notes', n);
}

export async function getNote(id: string): Promise<Note | undefined> {
  const db = await getDb();
  return db.get('notes', id);
}

export async function listNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.getAll('notes');
}

/** Deletes the note and its image in a single transaction. */
export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['notes', 'images'], 'readwrite');
  await Promise.all([tx.objectStore('notes').delete(id), tx.objectStore('images').delete(id), tx.done]);
}

export async function putImage(id: string, bytes: ArrayBuffer): Promise<void> {
  const db = await getDb();
  await db.put('images', bytes, id);
}

export async function getImage(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDb();
  return db.get('images', id);
}

/** Closes the cached connection. Used by tests so a fresh IDBFactory is picked up. */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // The open itself failed; there is nothing to close.
  }
}
