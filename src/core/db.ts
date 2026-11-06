import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { Note } from './types';

// Kept from the old project name scenenote: renaming it would orphan every saved note.
export const DB_NAME = 'scenenote';

interface ResonNoteDB extends DBSchema {
  notes: { key: string; value: Note };
  images: { key: string; value: ArrayBuffer };
}

/**
 * One schema step, run inside the `versionchange` transaction. A step describes the schema as it
 * was at its own version, so it is typed against an untyped database, not `ResonNoteDB` (which is
 * always the latest schema).
 */
export type Migration = (
  db: IDBPDatabase,
  tx: IDBPTransaction<unknown, string[], 'versionchange'>,
) => void;

/**
 * Step `i` takes the database from version `i` to `i + 1`, so a database at version `n` still
 * needs `MIGRATIONS.slice(n)`. To change the schema, append a step: never edit or reorder one
 * that has shipped, because databases already past it will not run it again.
 */
export const MIGRATIONS: readonly Migration[] = [
  // Version 1.
  (db) => {
    db.createObjectStore('notes', { keyPath: 'id' });
    // Out-of-line keys: the note id is the key, the value is the raw JPEG bytes.
    db.createObjectStore('images');
  },
];

/** The schema version is the number of steps: appending a step is what bumps it. */
export const DB_VERSION = MIGRATIONS.length;

/**
 * Opens `name` at the version `migrations` leads to, running only the steps the stored database
 * has not seen: all of them for a new database, none for one that is current. `blocked`,
 * `blocking` and `terminated` are passed on to `idb` as they are.
 */
export function openResonNoteDb(
  name: string,
  migrations: readonly Migration[] = MIGRATIONS,
  lifecycle: {
    blocked?: () => void;
    blocking?: () => void;
    terminated?: () => void;
  } = {},
): Promise<IDBPDatabase<ResonNoteDB>> {
  // Opened untyped because the steps work on past schemas; callers get the latest one's types.
  return openDB<unknown>(name, migrations.length, {
    upgrade(db, oldVersion, _newVersion, tx) {
      for (const migrate of migrations.slice(oldVersion)) migrate(db, tx);
    },
    ...lifecycle,
  }) as Promise<IDBPDatabase<ResonNoteDB>>;
}

let dbPromise: Promise<IDBPDatabase<ResonNoteDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ResonNoteDB>> {
  if (!dbPromise) {
    const opening: Promise<IDBPDatabase<ResonNoteDB>> = openResonNoteDb(DB_NAME, MIGRATIONS, {
      blocked() {
        // Some other connection (an older build, say) still holds the old version and has no
        // `blocking` handler, so this upgrade waits for it and the calls behind it wait too.
        console.warn('[resonnote] the database upgrade waits for another ResonNote page to let go');
      },
      blocking() {
        // A newer version of this code asks to upgrade the database and waits until every
        // connection is closed. Close ours and forget it, or the upgrade stays blocked for as long
        // as this page or worker lives.
        //
        // After that this code, which only knows its own version N, opens N again on its next
        // call and is refused with a `VersionError` once the database has moved past N. Nothing
        // handles that here: it reaches the caller like any other database error (`handleSave`
        // and friends answer `{ ok: false, error }`, shown as 存檔失敗 in the overlay and as
        // 儲存失敗 or 讀取筆記失敗 in the notebook, each with the raw message). Nothing hangs and
        // no data is touched, but nothing asks for a reload either: MSG_RELOAD_TAB in
        // content-main.ts covers only a lost extension context.
        if (dbPromise === opening) dbPromise = null;
        void opening.then((db) => db.close());
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

/** The fields of a stored note that can be edited after the capture. */
export type NoteChanges = Partial<Pick<Note, 'subtitle' | 'body' | 'updatedAt'>>;

/**
 * Changes some fields of a stored note, reading and writing it in one transaction. A note deleted
 * meanwhile (from the overlay, or from another notebook tab) is not brought back, and the fields
 * left out are kept as stored rather than written back from an older copy. Resolves the note as
 * it was just before the change, or `undefined` when there is no note with that id (then nothing
 * is written).
 */
export async function updateNote(id: string, changes: NoteChanges): Promise<Note | undefined> {
  const defined = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as NoteChanges;
  const db = await getDb();
  const tx = db.transaction('notes', 'readwrite');
  const [previous] = await Promise.all([
    (async () => {
      const stored = await tx.store.get(id);
      if (stored !== undefined) await tx.store.put({ ...stored, ...defined });
      return stored;
    })(),
    tx.done,
  ]);
  return previous;
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
