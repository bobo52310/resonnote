import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { browser } from 'wxt/browser';
import { getImage, listNotes, putImage, putNote } from './db';
import type { ImageSource, Note } from './types';

const BACKUP_VERSION = 1;
const NOTES_FILE = 'notes.json';
const IMAGE_PREFIX = 'images/';
const IMAGE_SUFFIX = '.jpg';
const LAST_BACKUP_KEY = 'lastBackupAt';
const REMINDER_AFTER_DAYS = 14;
const DAY_MS = 86_400_000;

/** Thrown when a file is not a ResonNote backup (not a zip, no notes.json, wrong shape). */
export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

function imagePath(id: string): string {
  return `${IMAGE_PREFIX}${id}${IMAGE_SUFFIX}`;
}

/** Builds the backup zip: `notes.json` plus one `images/<id>.jpg` per entry in `images`. */
export function createBackupZip(notes: Note[], images: Map<string, Uint8Array>): Uint8Array {
  const files: Zippable = {
    [NOTES_FILE]: strToU8(JSON.stringify({ version: BACKUP_VERSION, notes })),
  };
  for (const [id, bytes] of images) {
    // JPEG data is already compressed, so store it as-is.
    files[imagePath(id)] = [bytes, { level: 0 }];
  }
  return zipSync(files);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

const IMAGE_SOURCES: readonly ImageSource[] = ['tab', 'trickplay', 'none'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Absent, or a value that passes `check`. Anything else (including null) is invalid. */
function isOptional<T>(value: unknown, check: (v: unknown) => v is T): value is T | undefined {
  return value === undefined || check(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Validates one entry of `notes.json` against the Note type and rebuilds it from
 * known fields only, so unknown keys never reach IndexedDB. Returns null if invalid.
 */
function toNote(value: unknown): Note | null {
  if (!isRecord(value)) return null;
  const image = value.image;
  if (
    !isString(value.id) ||
    value.id === '' ||
    value.platform !== 'netflix' ||
    !isString(value.videoId) ||
    !isString(value.title) ||
    !isOptional(value.season, isFiniteNumber) ||
    !isOptional(value.episode, isFiniteNumber) ||
    !isOptional(value.episodeTitle, isString) ||
    !isFiniteNumber(value.timeMs) ||
    !isString(value.subtitle) ||
    !isString(value.body) ||
    !isRecord(image) ||
    !IMAGE_SOURCES.includes(image.source as ImageSource) ||
    !isFiniteNumber(image.width) ||
    !isFiniteNumber(image.height) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    return null;
  }

  const note: Note = {
    id: value.id,
    platform: value.platform,
    videoId: value.videoId,
    title: value.title,
    timeMs: value.timeMs,
    subtitle: value.subtitle,
    body: value.body,
    image: { source: image.source as ImageSource, width: image.width, height: image.height },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  if (value.season !== undefined) note.season = value.season;
  if (value.episode !== undefined) note.episode = value.episode;
  if (value.episodeTitle !== undefined) note.episodeTitle = value.episodeTitle;
  return note;
}

/** Reads a backup zip. Throws {@link BackupFormatError} if it is not a valid ResonNote backup. */
export function parseBackupZip(data: Uint8Array): {
  notes: Note[];
  images: Map<string, Uint8Array>;
} {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new BackupFormatError('Not a valid zip file');
  }

  const notesFile = files[NOTES_FILE];
  if (!notesFile) throw new BackupFormatError(`${NOTES_FILE} is missing from the backup`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(notesFile));
  } catch {
    throw new BackupFormatError(`${NOTES_FILE} is not valid JSON`);
  }
  if (!isRecord(parsed) || parsed.version !== BACKUP_VERSION) {
    throw new BackupFormatError(`Unsupported backup version (expected ${BACKUP_VERSION})`);
  }
  if (!Array.isArray(parsed.notes)) {
    throw new BackupFormatError(`${NOTES_FILE} has a malformed notes list`);
  }
  const notes: Note[] = [];
  for (const [index, raw] of parsed.notes.entries()) {
    const note = toNote(raw);
    if (!note) throw new BackupFormatError(`${NOTES_FILE} has an invalid note at index ${index}`);
    notes.push(note);
  }

  const images = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith(IMAGE_PREFIX) || !path.endsWith(IMAGE_SUFFIX)) continue;
    const id = path.slice(IMAGE_PREFIX.length, path.length - IMAGE_SUFFIX.length);
    // Copy: stored zip entries can be views over the whole input buffer.
    if (id) images.set(id, bytes.slice());
  }
  return { notes, images };
}

function isNewer(candidate: Note, base: Note): boolean {
  const a = Date.parse(candidate.updatedAt);
  const b = Date.parse(base.updatedAt);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return a > b;
  return candidate.updatedAt > base.updatedAt;
}

/**
 * Returns the notes that should be written: ids not stored yet, or ids whose
 * incoming copy has a strictly newer `updatedAt` (newest wins, ties keep the local copy).
 */
export function mergeNotes(existing: Note[], incoming: Note[]): Note[] {
  const existingById = new Map(existing.map((n) => [n.id, n]));
  const picked = new Map<string, Note>();
  for (const note of incoming) {
    const base = picked.get(note.id) ?? existingById.get(note.id);
    if (!base || isNewer(note, base)) picked.set(note.id, note);
  }
  return [...picked.values()];
}

/** Restores a backup into IndexedDB, merging by id with newest-wins. Safe to run repeatedly. */
export async function restoreBackup(
  data: Uint8Array,
): Promise<{ written: number; skipped: number }> {
  const { notes, images } = parseBackupZip(data);
  const toWrite = mergeNotes(await listNotes(), notes);
  for (const note of toWrite) {
    // Image first, so a failure in between never leaves a note that points at a missing image.
    const bytes = images.get(note.id);
    if (bytes) await putImage(note.id, bytes.slice().buffer);
    await putNote(note);
  }
  const uniqueIncoming = new Set(notes.map((n) => n.id)).size;
  return { written: toWrite.length, skipped: uniqueIncoming - toWrite.length };
}

/** Builds a backup zip from everything currently stored. */
export async function exportAllBackup(): Promise<Uint8Array> {
  const notes = await listNotes();
  const images = new Map<string, Uint8Array>();
  for (const note of notes) {
    const buffer = await getImage(note.id);
    if (buffer) images.set(note.id, new Uint8Array(buffer).slice());
  }
  return createBackupZip(notes, images);
}

export async function getLastBackupAt(): Promise<string | null> {
  const stored = await browser.storage.local.get(LAST_BACKUP_KEY);
  const value = stored[LAST_BACKUP_KEY];
  return typeof value === 'string' ? value : null;
}

export async function setLastBackupAt(iso: string): Promise<void> {
  await browser.storage.local.set({ [LAST_BACKUP_KEY]: iso });
}

/** True when there has never been a backup, or the last one is more than 14 days old. */
export function needsBackupReminder(lastIso: string | null, now: Date): boolean {
  if (lastIso === null) return true;
  const last = Date.parse(lastIso);
  if (Number.isNaN(last)) return true;
  return (now.getTime() - last) / DAY_MS > REMINDER_AFTER_DAYS;
}
