// Turns a camera photo or picked image into a small JPEG data URL that fits
// comfortably in IndexedDB and in JSON backups.

export const MAX_PHOTO_CHARS = 300_000;
const PHOTO_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export function isValidPhoto(value: string): boolean {
  return value.length <= MAX_PHOTO_CHARS && PHOTO_PATTERN.test(value);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/** Square-crops and shrinks an image to `size`px, returned as a JPEG data URL. */
export async function fileToProductPhoto(file: File, size = 320): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a picture file.");
  if (file.size > 25_000_000) throw new Error("That picture is too large.");
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error("That picture is empty.");
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device cannot resize pictures.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  for (const quality of [0.82, 0.7, 0.55]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (isValidPhoto(dataUrl)) return dataUrl;
  }
  throw new Error("That picture is too detailed to store. Try another one.");
}
