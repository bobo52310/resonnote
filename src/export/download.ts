const REVOKE_DELAY_MS = 10_000;

/** Saves `data` as a file called `name` through a temporary `<a download>` link. */
export function downloadBytes(name: string, data: Uint8Array | string | Blob, mime: string): void {
  // A Blob is immutable and shared by reference, so it needs no copy; the bytes are copied so a
  // caller reusing its buffer cannot change a download that has not started yet.
  const part: BlobPart =
    typeof data === 'string' || data instanceof Blob
      ? data
      : (data.slice() as Uint8Array<ArrayBuffer>);
  const url = URL.createObjectURL(new Blob([part], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the blob goes away.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
