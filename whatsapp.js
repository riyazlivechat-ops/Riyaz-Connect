// Sends the event photo with a personal message through Evolution Go
// (https://github.com/evolution-foundation/evolution-go), which links to your own WhatsApp by QR code,
// so the message arrives from your personal number like any chat you send yourself.
//
// API used: POST {EVOLUTION_API_URL}/send/media, header `apikey: <instance token>`,
// multipart fields: number, type=image, caption, filename, file.

const API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const INSTANCE_TOKEN = process.env.EVOLUTION_INSTANCE_TOKEN || '';
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || '').replace(/\D/g, '');

const isConfigured = () => Boolean(API_URL && INSTANCE_TOKEN);

// Turn whatever someone typed into the international digits WhatsApp expects, or null.
function toWhatsAppNumber(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? digits : null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (DEFAULT_COUNTRY_CODE && digits.startsWith('0')) digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  else if (DEFAULT_COUNTRY_CODE && digits.length <= 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function explain(status, body) {
  const msg = body.error || body.message;
  if (status === 401) return 'Evolution Go rejected the instance token (check EVOLUTION_INSTANCE_TOKEN).';
  if (status === 503) return 'Evolution Go is not activated yet: finish the licence step in its Manager.';
  if (/not registered on WhatsApp/i.test(msg || '')) return 'This number is not on WhatsApp.';
  if (/not connected|no session|logged out/i.test(msg || '')) return 'Your WhatsApp is not connected in Evolution Go: scan the QR code again.';
  return msg || `Evolution Go error ${status}`;
}

async function sendPhoto({ to, caption, photo, mime, filename }) {
  const form = new FormData();
  form.append('number', to);
  form.append('type', 'image');
  form.append('caption', caption);
  form.append('filename', filename);
  form.append('file', new Blob([photo], { type: mime }), filename);

  let res;
  try {
    res = await fetch(`${API_URL}/send/media`, {
      method: 'POST',
      headers: { apikey: INSTANCE_TOKEN },
      body: form,
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    throw new Error(`Could not reach Evolution Go at ${API_URL} (${err.cause?.code || err.name}).`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(explain(res.status, body));
  return body;
}

module.exports = { isConfigured, toWhatsAppNumber, sendPhoto };
