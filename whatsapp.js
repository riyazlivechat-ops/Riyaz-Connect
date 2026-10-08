// Sends the event photo to a contact over the official WhatsApp Cloud API.
//
// WhatsApp only allows a business to message someone first with a pre-approved template,
// so this expects a template with an IMAGE header and two body variables:
//   {{1}} = the contact's first name, {{2}} = the event name.
// Without these settings the app falls back to a one-tap "send from my own WhatsApp" link.

const API_BASE = (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/+$/, '');
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TEMPLATE = process.env.WHATSAPP_TEMPLATE || '';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || '').replace(/\D/g, '');

const isConfigured = () => Boolean(TOKEN && PHONE_NUMBER_ID && TEMPLATE);

// Turn whatever someone typed into the international digits WhatsApp expects, or null.
function toWhatsAppNumber(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 ? digits : null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (DEFAULT_COUNTRY_CODE && digits.startsWith('0')) digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  else if (DEFAULT_COUNTRY_CODE && digits.length <= 10) digits = DEFAULT_COUNTRY_CODE + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

async function graph(path, init) {
  const res = await fetch(`${API_BASE}/${API_VERSION}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `WhatsApp API error ${res.status}`);
  return body;
}

async function sendPhoto({ to, firstName, eventName, photo, mime }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([photo], { type: mime }), `photo.${mime === 'image/png' ? 'png' : 'jpg'}`);
  const media = await graph(`${PHONE_NUMBER_ID}/media`, { method: 'POST', body: form });

  await graph(`${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: TEMPLATE,
        language: { code: TEMPLATE_LANG },
        components: [
          { type: 'header', parameters: [{ type: 'image', image: { id: media.id } }] },
          { type: 'body', parameters: [{ type: 'text', text: firstName }, { type: 'text', text: eventName }] },
        ],
      },
    }),
  });
}

module.exports = { isConfigured, toWhatsAppNumber, sendPhoto };
