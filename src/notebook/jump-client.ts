import type { JumpResult, ToBackground } from '../core/messages';
import type { Note } from '../core/types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The notebook's `jump`: asks the background to take the user back to the note's moment. Only
 * failures are shown (through `notify`, as 「跳回失敗：…」); a jump that worked is visible by
 * itself. The returned function never throws.
 */
export function createJump(
  send: (message: ToBackground) => Promise<unknown>,
  notify: (message: string) => void,
): (note: Note) => void {
  const fail = (detail: string, cause: unknown) => {
    console.warn('[resonnote] could not jump back', cause);
    notify(`跳回失敗：${detail}`);
  };

  const run = async (note: Note): Promise<void> => {
    const reply = (await send({
      type: 'resonnote/jump',
      platform: note.platform,
      videoId: note.videoId,
      timeMs: note.timeMs,
    })) as JumpResult | undefined;
    if (reply && !reply.ok) fail(reply.error, reply.error);
  };

  return (note) => {
    try {
      run(note).catch((error: unknown) => fail(errorMessage(error), error));
    } catch (error) {
      fail(errorMessage(error), error);
    }
  };
}
