// Stamps a client's signature onto the coaching agreement, in the browser:
// their drawn signature, their name and the date in gold on page 2, the date
// on my side too, and a small line at the foot recording who signed, when,
// and the fingerprint (SHA-256) of the agreement they were shown.
//
// The places are those of the signature block in contract/coaching-agreement.tex
// (the SIGNATURES tikzpicture); move one, move the other.

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const MM = 72 / 25.4;   // PDF points per millimetre

/** Where things go on the last page, in mm from its bottom-left corner. */
export const SLOTS = {
  signature: { x: 113, y: 63, w: 76, h: 23 },   // above the client's signature line (62 mm)
  clientName: { x: 129, y: 57 },                 // baselines: beside "CLIENT" under that line …
  clientDate: { x: 113, y: 43.6 },               // … and on the date lines (42 mm)
  coachDate: { x: 21, y: 43.6 },
  audit: { x: 105, y: 20.5 },                    // centred, between the note and the page number
} as const;

const GOLD = rgb(0xd4 / 255, 0xaf / 255, 0x5a / 255);
const SOFT = rgb(0xa8 / 255, 0xa2 / 255, 0x96 / 255);

export interface Signing {
  signature: Uint8Array;   // PNG, transparent, gold strokes, trimmed to the ink
  name: string;
  email: string;
  when: Date;
  sha256: string;          // of the agreement as shown, hex
}

/** "17 November 2026" */
export const longDate = (d: Date) => d.toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Dublin' });

/** The agreement's fingerprint, hex. */
export async function sha256(bytes: ArrayBuffer | Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The signed agreement, as PDF bytes. `font` is the face for the name and dates (Inter Light). */
export async function signAgreement(agreement: ArrayBuffer, font: ArrayBuffer, s: Signing): Promise<Uint8Array> {
  const doc = await PDFDocument.load(agreement);
  doc.registerFontkit(fontkit);
  // embedded whole: pdf-lib's own subsetting can drop glyphs. The file is
  // cut down beforehand with fonttools instead (contract/build.sh).
  const face = await doc.embedFont(font);
  const page = doc.getPages().at(-1)!;

  // the signature, fitted into its box, sitting on the line, from the left
  const png = await doc.embedPng(s.signature);
  const box = SLOTS.signature;
  const k = Math.min((box.w * MM) / png.width, (box.h * MM) / png.height);
  page.drawImage(png, { x: box.x * MM + 1.5 * MM, y: box.y * MM, width: png.width * k, height: png.height * k });

  const date = longDate(s.when);
  page.drawText(s.name, { x: SLOTS.clientName.x * MM, y: SLOTS.clientName.y * MM, size: 10.5, font: face, color: GOLD });
  page.drawText(date, { x: SLOTS.clientDate.x * MM, y: SLOTS.clientDate.y * MM, size: 10.5, font: face, color: GOLD });
  page.drawText(date, { x: SLOTS.coachDate.x * MM, y: SLOTS.coachDate.y * MM, size: 10.5, font: face, color: GOLD });

  const audit = `Signed by ${s.name} <${s.email}> on ${s.when.toISOString().replace('T', ' ').slice(0, 16)} UTC · agreement v1.0, SHA-256 ${s.sha256.slice(0, 16)}…`;
  const size = 5.8, width = face.widthOfTextAtSize(audit, size);
  page.drawText(audit, { x: SLOTS.audit.x * MM - width / 2, y: SLOTS.audit.y * MM, size, font: face, color: SOFT });

  doc.setTitle('Our Coaching Agreement — signed');
  doc.setAuthor('Ilya Malyarenko');
  doc.setSubject(`Signed by ${s.name}`);
  doc.setModificationDate(s.when);
  return doc.save();
}

/** A canvas cropped to its ink, with a little room round it; PNG bytes. */
export async function trimmedPng(canvas: HTMLCanvasElement, pad = 6): Promise<Uint8Array> {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('empty signature');
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob>((ok) => out.toBlob((b) => ok(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
