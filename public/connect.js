(() => {
  const $ = (sel) => document.querySelector(sel);
  const QUEUE_KEY = 'rc_pending_connects';
  const CHANNEL_TEXT = {
    whatsapp: 'on WhatsApp', email: 'by email', linkedin: 'on LinkedIn', call: 'with a quick call',
  };
  const state = { interests: new Set(), timeline: null, preferred_channel: null, photo: null };
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

  // ---------- photo together ----------

  function setPhoto(dataUrl) {
    state.photo = dataUrl;
    $('#photo-img').src = dataUrl || '';
    $('#photo-preview').classList.toggle('hidden', !dataUrl);
    $('#photo-empty').classList.toggle('hidden', Boolean(dataUrl));
    $('#send-photo-row').classList.toggle('hidden', !dataUrl);
    $('#photo-lead').textContent = dataUrl
      ? 'Lovely! Now leave your details below and I\'ll send it to your WhatsApp.'
      : 'A little keepsake from today. I\'ll send it to your WhatsApp.';
  }

  $('#photo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    $('#photo-working').classList.remove('hidden');
    try {
      const event = profile?.event?.photoCaption || profile?.event?.name || '';
      const date = new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
      setPhoto(await window.RCPhoto.compose(file, {
        title: event,
        subtitle: [profile?.name, profile?.company, date].filter((x) => x && !isTodo(x)).join(' · '),
      }));
      $('#form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('#full_name').focus({ preventScroll: true }), 400);
    } catch (err) {
      toast(err.message);
    } finally {
      $('#photo-working').classList.add('hidden');
    }
  });
  $('#photo-remove').addEventListener('click', () => setPhoto(null));
  $('#photo-skip').addEventListener('click', () => {
    $('#photo-card').classList.add('hidden');
    $('#form-step').textContent = '20 seconds';
    $('#form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      photo: state.photo,
      send_photo: Boolean(state.photo) && f.elements.send_photo.checked,
    };
  }

  function validate(d) {
    const errs = [];
    if (!d.full_name) errs.push('Please add your name.');
    if (!d.email && !d.phone && !d.linkedin) errs.push('Please share at least one way to reach you: email, phone or LinkedIn.');
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.push('That email address does not look right.');
    if (d.send_photo && !d.phone) errs.push('Please add your WhatsApp number so I can send you our photo.');
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
  const writeQueue = (q) => storage((s) => { s.setItem(QUEUE_KEY, JSON.stringify(q)); return true; }, false);

  // Photos are large: if the phone's storage is full, keep the details and drop the photo.
  function enqueue(data) {
    if (writeQueue([...readQueue(), data])) return true;
    return writeQueue([...readQueue(), { ...data, photo: null, send_photo: false }]);
  }

  async function flushQueue() {
    const queue = readQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try { await send(item); } catch (e) { if (!e.errors) remaining.push(item); }
    }
    writeQueue(remaining);
  }

  function showPhotoResult(data, result) {
    if (!data.photo) return;
    $('#success-photo-img').src = data.photo;
    const save = $('#success-photo-save');
    save.href = data.photo;
    save.download = `${(profile?.event?.name || 'photo').replace(/[^a-z0-9]+/gi, '-')}.jpg`;
    $('#success-photo').classList.remove('hidden');

    // Native share sheet lets them post it straight to WhatsApp or save it to Photos.
    const share = $('#success-photo-share');
    if (navigator.canShare) {
      const bytes = Uint8Array.from(atob(data.photo.split(',')[1]), (ch) => ch.charCodeAt(0));
      const file = new File([bytes], save.download, { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        share.classList.remove('hidden');
        share.onclick = () => navigator.share({ files: [file] }).catch(() => {});
      }
    }

    const note = document.createElement('p');
    note.className = 'muted small';
    if (data.send_photo && result?.photoDelivery === 'auto') note.textContent = 'Our photo is on its way to your WhatsApp.';
    else if (data.send_photo) note.textContent = `${profile?.name || 'I'} will send our photo to your WhatsApp shortly.`;
    else note.textContent = 'Save it now so you have it.';
    $('#success-photo').appendChild(note);
  }

  function showSuccess(data, offline, result) {
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
    $('#photo-card').classList.add('hidden');
    showPhotoResult(data, result);
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
      showSuccess(data, false, await send(data));
    } catch (err) {
      if (err.errors) {
        showErrors(err.errors);
      } else {
        enqueue(data);
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
