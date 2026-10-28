const REVOKE_DELAY_MS = 10_000;

/** Saves `data` as a file called `name` through a temporary `<a download>` link. */
export function downloadBytes(name: string, data: Uint8Array | string, mime: string): void {
  const part: BlobPart = typeof data === 'string' ? data : (data.slice() as Uint8Array<ArrayBuffer>);
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
