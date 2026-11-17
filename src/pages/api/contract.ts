// Keeps a signed coaching agreement in private storage: Netlify Blobs, store
// "signed-contracts". Nothing here is ever served at a public address; only
// the site owner can read it (Netlify dashboard, or `netlify blobs:get`).
//
// The contract page (pages/contract.astro) posts the signed PDF here first,
// then sends the client's details and the returned key through Netlify Forms
// (form "contract", field contract_file). Form uploads would have put the PDF
// at a public CDN address instead, which is why the file comes here.
import type { APIRoute } from 'astro';
import { getStore } from '@netlify/blobs';

export const prerender = false;

const STORE = 'signed-contracts';
const MAX_BYTES = 2 * 1024 * 1024;   // a signed agreement is ~0.2 MB

const reply = (status: number, body: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try { form = await request.formData(); } catch { return reply(400, { error: 'expected a form' }); }

  // the same trap as the form's: a person never fills it in
  if (String(form.get('bot-field') ?? '')) return reply(400, { error: 'rejected' });

  const file = form.get('signed_contract');
  if (!(file instanceof File) || file.size === 0) return reply(400, { error: 'no file' });
  if (file.size > MAX_BYTES) return reply(413, { error: 'file too large' });
  const head = new TextDecoder().decode(new Uint8Array(await file.slice(0, 5).arrayBuffer()));
  if (head !== '%PDF-') return reply(415, { error: 'not a PDF' });

  const name = String(form.get('full_name') ?? '').trim().slice(0, 120);
  const email = String(form.get('email') ?? '').trim().slice(0, 200);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'name and email needed' });
  const signedAt = String(form.get('signed_at') ?? '').slice(0, 40);
  const sha256 = String(form.get('contract_sha256') ?? '').slice(0, 64);

  // 2026-11-17/jane-murphy-1a2b3c4d.pdf: by day, readable, never guessable
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
  const key = `${new Date().toISOString().slice(0, 10)}/${slug}-${crypto.randomUUID().slice(0, 8)}.pdf`;

  try {
    await getStore({ name: STORE, consistency: 'strong' }).set(key, await file.arrayBuffer(), {
      metadata: { name, email, signedAt, sha256, bytes: String(file.size), contentType: 'application/pdf' },
    });
  } catch (err) {
    console.error('signed-contracts: could not store', err);
    return reply(500, { error: 'could not store' });
  }
  return reply(201, { key });
};
