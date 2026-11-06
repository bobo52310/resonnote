import { downloadBytes } from './download';

/** What became of a file given to `saveFileAs`. */
export type SaveOutcome =
  /** Written to disk and closed; `name` is the name the user gave it in the save dialog. */
  | { status: 'saved'; name: string }
  /** The user closed the save dialog: nothing was made or written. */
  | { status: 'cancelled' }
  /**
   * There was no save dialog to use, so the file went to the browser's downloads. Whether it
   * lands cannot be known without the `downloads` permission: the user may still cancel it.
   */
  | { status: 'downloading'; name: string };

export interface SaveFileOptions {
  /** Suggested in the save dialog, and the name of a download. */
  name: string;
  mime: string;
  /** With the dot, for example `.zip`. */
  extension: string;
  /** Names the file type in the save dialog. */
  description: string;
}

/** The parts of Chrome's File System Access API used here (not in TypeScript's DOM types). */
interface PickedFile {
  readonly name: string;
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort(reason?: unknown): Promise<void>;
  }>;
}
type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<PickedFile>;

function savePicker(): SaveFilePicker | null {
  const picker = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === 'function' ? (picker.bind(globalThis) as SaveFilePicker) : null;
}

function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * Saves a file through the browser's save dialog, so the caller learns whether it really was
 * written: a download started with `<a download>` cannot tell a file that was saved from one
 * whose "Save as" dialog the user cancelled.
 *
 * The dialog opens at once, while the click that asked for it still counts as a user gesture;
 * `make` builds the bytes only once a place has been chosen. Where there is no dialog (or it is
 * refused for any reason but a cancel), the file goes to the downloads instead and the outcome
 * says so. Throws when making or writing the file fails.
 */
export async function saveFileAs(
  options: SaveFileOptions,
  make: () => Promise<Uint8Array>,
): Promise<SaveOutcome> {
  const picker = savePicker();
  let picked: PickedFile | null = null;
  if (picker !== null) {
    try {
      picked = await picker({
        suggestedName: options.name,
        types: [{ description: options.description, accept: { [options.mime]: [options.extension] } }],
      });
    } catch (error) {
      if (isAbort(error)) return { status: 'cancelled' };
      console.warn('[resonnote] the save dialog is not available, downloading instead', error);
    }
  }

  const bytes = await make();
  if (picked === null) {
    downloadBytes(options.name, bytes, options.mime);
    return { status: 'downloading', name: options.name };
  }

  const writable = await picked.createWritable();
  try {
    await writable.write(new Blob([bytes.slice() as Uint8Array<ArrayBuffer>], { type: options.mime }));
  } catch (error) {
    // Leave the file as it was rather than half-written.
    await writable.abort(error).catch(() => {});
    throw error;
  }
  await writable.close();
  return { status: 'saved', name: picked.name };
}
