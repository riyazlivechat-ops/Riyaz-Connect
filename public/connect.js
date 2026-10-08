(() => {
  const $ = (sel) => document.querySelector(sel);
  const QUEUE_KEY = 'rc_pending_connects';
  const CHANNEL_TEXT = {
    whatsapp: 'on WhatsApp', email: 'by email', linkedin: 'on LinkedIn', call: 'with a quick call',
  };
  const state = { interests: new Set(), timeline: null, preferred_channel: null };
  let profile = null;

  const isTodo = (v) => !v || /^TODO/i.test(v);

  function storage(fn, fallback) {
    try { return fn(window.localStorage); } catch { return fallback; }
  }

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function showLink(id, href) {
    if (!href) return;
    const el = $(id);
    el.href = href;
    el.classList.remove('hidden');
  }

  function renderProfile(p) {
    profile = p;
    document.title = `Connect with ${p.name}`;
    $('#event-pill').textContent = p.event?.greeting || 'Great to meet you';
    $('#name').textContent = p.name;
    if (!isTodo(p.headline)) $('#headline').textContent = p.headline;

    const avatar = $('#avatar');
    if (p.photo) {
      const img = document.createElement('img');
      img.src = p.photo;
      img.alt = p.name;
      img.className = 'avatar';
      avatar.replaceWith(img);
    } else {
      avatar.textContent = p.name.trim().charAt(0).toUpperCase();
    }

    if (!isTodo(p.bio)) $('#bio').textContent = p.bio;
    const proof = (p.proof || []).filter((x) => !isTodo(x));
    $('#proof').replaceChildren(...proof.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    if (isTodo(p.bio) && !proof.length) $('#about').classList.add('hidden');

    showLink('#linkedin-link', p.linkedin);
    showLink('#website-link', p.website);
    if (p.whatsapp) showLink('#whatsapp-link', `https://wa.me/${p.whatsapp.replace(/\D/g, '')}`);
    if (p.email) showLink('#email-link', `mailto:${p.email}`);
    // An odd number of secondary buttons leaves a gap; let the last one fill the row.
    const shown = [...document.querySelectorAll('.actions .btn:not(.primary):not(.hidden)')];
    if (shown.length % 2) shown.at(-1).style.gridColumn = '1 / -1';

    const chips = (p.services || []).map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = s;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        const on = !state.interests.has(s);
        if (on) state.interests.add(s); else state.interests.delete(s);
        b.setAttribute('aria-pressed', String(on));
      });
      return b;
    });
    $('#interests').replaceChildren(...chips);

    $('#consent-text').textContent = `I'm happy for ${p.name} to keep these details and follow up with me personally. You can ask to be removed at any time.`;
    $('#footer').textContent = [p.company, p.location].filter((x) => !isTodo(x)).join(' · ');
  }

  // Single-choice chip groups (timeline, preferred channel).
  document.querySelectorAll('[data-single]').forEach((group) => {
    const key = group.dataset.single;
    group.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const selected = state[key] === chip.dataset.value ? null : chip.dataset.value;
      state[key] = selected;
      group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === selected)));
    });
  });

  function collect() {
    const f = $('#connect-form');
    const v = (name) => f.elements[name].value.trim();
    return {
      full_name: v('full_name'),
      company: v('company'),
      role: v('role'),
      email: v('email'),
      phone: v('phone'),
      linkedin: v('linkedin'),
      challenge: v('challenge'),
      referral: v('referral'),
      website_url: v('website_url'),
      interests: [...state.interests],
      timeline: state.timeline,
      preferred_channel: state.preferred_channel,
      consent: f.elements.consent.checked,
    };
  }

  function validate(d) {
    const errs = [];
    if (!d.full_name) errs.push('Please add your name.');
    if (!d.email && !d.phone && !d.linkedin) errs.push('Please share at least one way to reach you: email, phone or LinkedIn.');
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.push('That email address does not look right.');
    if (!d.consent) errs.push('Please tick the box so I can follow up with you.');
    return errs;
  }

  function showErrors(errs) {
    const ul = $('#errors');
    ul.replaceChildren(...errs.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    ul.classList.toggle('hidden', !errs.length);
  }

  async function send(data) {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 400) {
      const err = new Error('invalid');
      err.errors = body.errors || ['Please check your details.'];
      throw err;
    }
    if (!res.ok) throw new Error('server');
    return body;
  }

  // Event Wi-Fi is often poor: keep failed submissions on the device and retry later.
  const readQueue = () => storage((s) => JSON.parse(s.getItem(QUEUE_KEY) || '[]'), []);
  const writeQueue = (q) => storage((s) => s.setItem(QUEUE_KEY, JSON.stringify(q)));

  async function flushQueue() {
    const queue = readQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try { await send(item); } catch (e) { if (!e.errors) remaining.push(item); }
    }
    writeQueue(remaining);
  }

  function showSuccess(data, offline) {
    const first = data.full_name.split(/\s+/)[0];
    $('#form-card').classList.add('hidden');
    $('#about').classList.add('hidden');
    $('#success').classList.remove('hidden');
    $('#success-title').textContent = `Thank you, ${first}!`;
    const how = CHANNEL_TEXT[data.preferred_channel] || 'personally';
    $('#success-text').textContent = offline
      ? `The signal here is weak, so your details are saved on this phone and will send automatically when you're back online. I'll follow up ${how}.`
      : `It was great to meet you. I'll follow up ${how} within 24 hours.`;
    if (profile?.gift?.url && !isTodo(profile.gift.title)) {
      $('#gift-title').textContent = profile.gift.title;
      $('#gift-link').href = profile.gift.url;
      $('#gift').classList.remove('hidden');
    }
    showLink('#booking-link', profile?.bookingUrl);
    $('#success').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = collect();
    const errs = validate(data);
    showErrors(errs);
    if (errs.length) return;

    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      await send(data);
      showSuccess(data, false);
    } catch (err) {
      if (err.errors) {
        showErrors(err.errors);
      } else {
        writeQueue([...readQueue(), data]);
        showSuccess(data, true);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });

  $('#save-contact').addEventListener('click', () => toast('Opening contact card…'));
  window.addEventListener('online', flushQueue);

  fetch('/api/profile')
    .then((r) => r.json())
    .then(renderProfile)
    .catch(() => {});
  flushQueue();
})();
