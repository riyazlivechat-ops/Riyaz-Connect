# Riyaz Connect

A networking app for in-person events. It was built for **Amanah Chambers Connect** and works for any later event.

- **For people you meet:** they scan your QR code and get a polished mobile page about you. They can save your contact to their phone in one tap and leave their details in about 20 seconds.
- **For you:** a private dashboard at `/admin`. It ranks every lead hot, warm or cold, drafts a personal follow-up for each person, and sends it through WhatsApp, email or LinkedIn in one tap.
- **Photo together:** visitors take a selfie with you on their phone. The app adds an event caption strip, stores the photo, and sends it to their WhatsApp.
- **Storage:** everything is saved in **PostgreSQL**, photos included.

## Why it is designed this way

| What happens at networking events | What the app does about it |
|---|---|
| Business cards get lost. Most event contacts never get a follow-up. | A QR code on your phone screen. Their details go straight into Postgres. |
| Every extra field means fewer people finish the form. | Only the name and one way to reach them are required. Everything else is optional and hidden behind "Tell me a bit more". |
| People share their details when they get something back. | Your contact goes to their phone (vCard), and you can offer a free resource and a booking link on the thank-you screen. |
| Following up within 24 hours makes a big difference to who replies. | The thank-you screen promises a follow-up within 24 hours. The dashboard drafts the message, gives you WhatsApp, email and LinkedIn buttons, and sets the next follow-up date for you. |
| You forget who said what after 30 conversations. | Quick capture with voice dictation for people who would rather not scan. Notes can be searched later. |
| Venue Wi-Fi is often unreliable. | If a submission fails, it is kept on their phone and sent again when they are back online. |
| You need to know who to call first. | Each lead gets a score from how soon they need help, what they are interested in, and the challenge they described. You can change the hot/warm/cold label with one tap. |
| A photo together makes you memorable, and people share it. | The visitor flow opens with "Let's take a photo together". The photo gets a branded strip (event, your name, Sirah Digital, date) and arrives on their WhatsApp with a link to your LinkedIn. |
| Privacy and trust ("Amanah"). | An explicit consent checkbox. The dashboard is password-protected. Nothing is sent to third-party trackers. |

## 1. Add your details (5 minutes)

Edit **`config/profile.json`**. Any value that still starts with `TODO` is hidden from visitors, so the page always looks finished.

- `headline`, `bio`, `proof`: copy these from your LinkedIn and website.
- `photo`: a link to your LinkedIn profile photo, or put an image in `public/` and use `"/me.jpg"`.
- `linkedin`, `website`, `whatsapp` (digits with country code), `phone`, `bookingUrl` (for example Calendly).
- `services`: the topic chips people tap.
- `gift`: an optional free resource shown after someone connects.
- `event.name` / `event.greeting`: change these for each event. Every contact is tagged with the event name.

## Sending the photo to WhatsApp

There are two ways, and the app picks one automatically.

**A. One tap from your own WhatsApp (no setup, works today).**
On each dashboard card with a photo, tap **Send photo on WhatsApp**. Your WhatsApp opens the chat with their number, with a message and a link to the photo already filled in, and WhatsApp shows the photo as a preview. You just press send. Because it comes from your personal number, it also starts a real conversation.

**B. Fully automatic (WhatsApp Cloud API).**
The photo arrives on their WhatsApp seconds after they submit the form, with no action from you.
1. In [Meta for Developers](https://developers.facebook.com/), create an app, add **WhatsApp**, and add a business phone number. It can't be the number you use in the WhatsApp app.
2. In WhatsApp Manager, create a message template named `event_photo`, category *Marketing*:
   - **Header:** Image
   - **Body:** `Hi {{1}}, it was lovely meeting you at {{2}}! Here's our photo together. Let's stay in touch.`
   - **Button (optional):** a URL button to your LinkedIn
3. Once Meta approves the template (usually minutes to hours), set `WHATSAPP_TOKEN` (a permanent system-user token), `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_TEMPLATE=event_photo`.

WhatsApp only lets a business message someone first with an approved template; that's why option B needs one. If an automatic send fails (for example, the number isn't on WhatsApp), the card shows the reason, along with **Retry** and the one-tap option A.

Set `DEFAULT_COUNTRY_CODE` (for example `91`) so that numbers typed without a country code still work.

## 2. Run it locally

```bash
docker compose up --build
# Connect page:  http://localhost:3000
# Dashboard:     http://localhost:3000/admin  (password: change-me)
```

Or run it without Docker, using your own Postgres:

```bash
npm install
cp .env.example .env   # set DATABASE_URL and ADMIN_PASSWORD, then export them
npm start              # creates the tables automatically on first start
```

## 3. Put it online before the event

The people you meet scan the QR code on their own phones, so the app needs a public HTTPS address. Any Node host works. The quickest options are:

1. **Postgres:** create a free database on [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy the connection string.
2. **App:** deploy this repo to [Render](https://render.com) or [Railway](https://railway.app). Use `npm start` as the start command, or the included `Dockerfile`.
3. Set these environment variables: `DATABASE_URL`, `PGSSL=true`, `ADMIN_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`), `PUBLIC_URL=https://your-app-address`, `NODE_ENV=production`.

## Event-day playbook

1. Open `/admin` on your phone and sign in. Then add it to your home screen.
2. When someone wants to connect, tap **Show QR**. The screen stays on while the code is showing.
3. When they open the page, they tap **Open camera** and take a selfie with you. Then they fill in their details and the photo goes to their WhatsApp.
4. If someone doesn't want to scan, use **Quick capture** (it has a 📸 button too) and tap the 🎙 button to dictate what you talked about.
5. Between conversations, add a line of notes while you still remember them.
6. **That evening:** open **🔥 Hot**, then tap WhatsApp or Email on each card. The message is already drafted, and the card moves to *Contacted* with a follow-up date 3 days later.
7. Each morning, check **Follow up today**.
8. To print the QR code for your badge or table, download `/qr.svg`.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/profile` | – | Profile for the connect page |
| POST | `/api/connect` | – (rate-limited, honeypot) | A visitor submits their details. Repeat submissions with the same email are merged. |
| GET | `/vcard` | – | Your contact card |
| GET | `/qr.svg` | – | QR code for `PUBLIC_URL` |
| GET | `/p/:token` and `/p/:token.jpg` | unguessable link | The photo keepsake page (with a WhatsApp preview) and the image itself |
| POST | `/api/contacts/:id/send-photo` | admin | Retry sending the photo automatically |
| POST | `/api/admin/login` | – | Sign in to the dashboard |
| GET | `/api/contacts?q=&status=&warmth=&due=1` | admin | List and search contacts |
| POST | `/api/contacts` | admin | Quick capture |
| PATCH | `/api/contacts/:id` | admin | Update notes, status, warmth or follow-up date |
| DELETE | `/api/contacts/:id` | admin | Remove a contact (for example on request) |
| GET | `/api/stats` | admin | Dashboard counters |
| GET | `/api/contacts.csv` | admin | Export to Excel or a CRM |

The schema is in `db/schema.sql`. It is applied automatically on every start and is safe to re-run.
