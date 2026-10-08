(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const TIMELINE_TEXT = { now: 'Needs help now', quarter: 'Next 3 months', exploring: 'Exploring' };
  const CHANNEL_TEXT = { whatsapp: 'WhatsApp', email: 'Email', linkedin: 'LinkedIn', call: 'Call' };
  let profile = { name: 'Riyaz', event: { name: 'the event' } };
  let filter = 'all';
  let searchTimer = null;
  let wakeLock = null;

  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { showLogin(); throw new Error('auth'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error('api'), { data });
    return data;
  }

  // ---------- auth ----------

  function showLogin() {
    $('#app-view').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
    $('#password').focus();
  }

  async function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    profile = await fetch('/api/profile').then((r) => r.json());
    $('#event-name').textContent = profile.event.name;
    $('#qr-event').textContent = profile.event.name;
    $('#qr-title').textContent = `Connect with ${profile.name}`;
    $('#qr-url').textContent = profile.connectUrl;
    refresh();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('#password').value } });
      err.classList.add('hidden');
      showApp();
    } catch (ex) {
      if (ex.message === 'auth') {
        err.replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Wrong password.' }));
        err.classList.remove('hidden');
      }
    }
  });

  $('#logout').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    showLogin();
  });

  // ---------- data ----------

  async function refresh() {
    const params = new URLSearchParams();
    const q = $('#search').value.trim();
    if (q) params.set('q', q);
    if (filter === 'hot') params.set('warmth', 'hot');
    if (filter === 'due') params.set('due', '1');
    if (filter === 'client' || filter === 'archived') params.set('status', filter);

    const [stats, contacts] = await Promise.all([api('/api/stats'), api(`/api/contacts?${params}`)]);
    renderStats(stats);
    renderList(contacts);
  }

  function renderStats(s) {
    const items = [['Connections', s.total], ['🔥 Hot', s.hot], ['Met today', s.today], ['Follow up', s.due]];
    $('#stats').replaceChildren(...items.map(([label, n]) => {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = '<b></b><span></span>';
      d.querySelector('b').textContent = n;
      d.querySelector('span').textContent = label;
      return d;
    }));
  }

  function firstName(c) { return c.full_name.split(/\s+/)[0]; }

  function draftMessage(c) {
    const topic = c.challenge
      ? `You mentioned "${c.challenge.length > 90 ? `${c.challenge.slice(0, 90)}…` : c.challenge}" and I've been thinking about it.`
      : c.interests?.length
        ? `You mentioned an interest in ${c.interests.slice(0, 2).join(' and ').toLowerCase()}, so I wanted to share a few ideas.`
        : 'I enjoyed our conversation and would love to continue it.';
    const ask = profile.bookingUrl
      ? `Would a 20-minute chat this week help? You can pick a time here: ${profile.bookingUrl}`
      : 'Would a 20-minute chat this week help? Let me know a time that suits you.';
    const at = c.company ? ` and learning about ${c.company}` : '';
    return `Hi ${firstName(c)}, it was great meeting you at ${c.event}${at}. ${topic}\n\n${ask}\n\nBest,\n${profile.name}`;
  }

  function photoMessage(c) {
    return `Hi ${firstName(c)}, lovely meeting you at ${c.event}! Here's our photo together 📸\n${profileUrl()}/p/${c.photo_token}\n\n${profile.name}`;
  }

  function profileUrl() {
    return (profile.connectUrl || location.origin).replace(/\/+$/, '');
  }

  function renderList(contacts) {
    const list = $('#list');
    if (!contacts.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = filter === 'all' && !$('#search').value
        ? 'No connections yet. Tap "Show QR" and let people scan your phone.'
        : 'Nothing matches this filter.';
      list.replaceChildren(empty);
      return;
    }
    const today = localDate();
    list.replaceChildren(...contacts.map((c) => renderContact(c, today)));
  }

  function renderContact(c, today) {
    const node = $('#contact-tpl').content.firstElementChild.cloneNode(true);
    const followUp = c.follow_up_on ? c.follow_up_on.slice(0, 10) : '';
    if (followUp && followUp <= today && ['new', 'contacted', 'meeting'].includes(c.status)) node.classList.add('due');

    $('.initials', node).textContent = c.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    $('.c-name', node).textContent = c.full_name;
    $('.c-sub', node).textContent = [c.role, c.company].filter(Boolean).join(' · ')
      || new Date(c.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    const badge = $('.badge', node);
    badge.textContent = `${c.warmth} · ${c.score}`;
    badge.className = `badge ${c.warmth}`;
    badge.title = 'Tap to change warmth';
    badge.addEventListener('click', async () => {
      const next = { cold: 'warm', warm: 'hot', hot: 'cold' }[c.warmth];
      Object.assign(c, await api(`/api/contacts/${c.id}`, { method: 'PATCH', body: { warmth: next } }));
      badge.textContent = `${c.warmth} · ${c.score}`;
      badge.className = `badge ${c.warmth}`;
    });

    const tags = [...(c.interests || [])];
    if (c.timeline) tags.push(`⏱ ${TIMELINE_TEXT[c.timeline]}`);
    if (c.preferred_channel) tags.push(`Prefers ${CHANNEL_TEXT[c.preferred_channel]}`);
    if (c.source === 'manual') tags.push('Added by you');
    $('.c-tags', node).replaceChildren(...tags.map((t) => Object.assign(document.createElement('span'), { className: 'chip', textContent: t })));

    $('.c-challenge', node).textContent = c.challenge ? `“${c.challenge}”` : '';
    const reach = [c.email, c.phone, c.referral && `Suggested intro: ${c.referral}`].filter(Boolean);
    $('.c-reach', node).textContent = reach.join(' · ');

    if (c.photo_token) renderPhoto(node, c);

    const notes = $('.c-notes', node);
    notes.value = c.notes || '';
    notes.addEventListener('change', () => save(c, { notes: notes.value }));

    const status = $('.c-status', node);
    status.value = c.status;
    status.addEventListener('change', async () => {
      await save(c, { status: status.value });
      if (status.value === 'client') toast(`Congratulations on winning ${firstName(c)}! 🎉`);
      refresh();
    });

    const follow = $('.c-follow', node);
    follow.value = followUp;
    follow.addEventListener('change', () => save(c, { follow_up_on: follow.value || null }));

    const msg = $('.c-message', node);
    msg.value = draftMessage(c);
    const wa = $('.c-wa', node);
    const mail = $('.c-mail', node);
    const li = $('.c-li', node);
    const syncLinks = () => {
      const text = encodeURIComponent(msg.value);
      if (c.wa_number) { wa.href = `https://wa.me/${c.wa_number}?text=${text}`; wa.classList.remove('hidden'); }
      if (c.email) {
        mail.href = `mailto:${c.email}?subject=${encodeURIComponent(`Great meeting you at ${c.event}`)}&body=${text}`;
        mail.classList.remove('hidden');
      }
      if (c.linkedin) { li.href = c.linkedin; li.classList.remove('hidden'); }
    };
    syncLinks();
    msg.addEventListener('input', syncLinks);

    const markContacted = () => {
      if (c.status !== 'new') return;
      const next = localDate(new Date(Date.now() + 3 * 864e5));
      save(c, { status: 'contacted', follow_up_on: next }).then(() => { status.value = 'contacted'; follow.value = next; });
    };
    wa.addEventListener('click', markContacted);
    mail.addEventListener('click', markContacted);
    li.addEventListener('click', () => { navigator.clipboard?.writeText(msg.value); toast('Message copied, paste it on LinkedIn'); markContacted(); });
    $('.c-copy', node).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(msg.value); toast('Copied'); } catch { msg.select(); }
    });

    $('.c-delete', node).addEventListener('click', async () => {
      if (!confirm(`Delete ${c.full_name} permanently?`)) return;
      await api(`/api/contacts/${c.id}`, { method: 'DELETE' });
      toast('Deleted');
      refresh();
    });
    return node;
  }

  function renderPhoto(node, c) {
    const box = $('.c-photo', node);
    box.classList.remove('hidden');
    $('.c-photo-link', node).href = `/p/${c.photo_token}`;
    $('img', box).src = `/p/${c.photo_token}.jpg`;

    const status = $('.c-photo-status', node);
    const waBtn = $('.c-photo-wa', node);
    const retry = $('.c-photo-retry', node);
    const paint = () => {
      const st = c.photo_whatsapp_status;
      status.className = `small c-photo-status${st === 'sent' ? ' ok' : st === 'failed' ? ' bad' : ''}`;
      status.textContent = {
        sent: '✓ Photo sent on WhatsApp',
        pending: 'Sending photo…',
        failed: `Auto-send failed${c.photo_whatsapp_error ? `: ${c.photo_whatsapp_error}` : ''}`,
        manual: c.wa_number ? 'Photo ready to send' : 'No valid WhatsApp number (needs country code)',
      }[st] || 'Photo not sent (they chose not to receive it)';
      waBtn.classList.toggle('hidden', !c.wa_number || st === 'sent');
      retry.classList.toggle('hidden', !(profile.whatsappAuto && c.wa_number && st === 'failed'));
    };
    if (c.wa_number) waBtn.href = `https://wa.me/${c.wa_number}?text=${encodeURIComponent(photoMessage(c))}`;
    // Sending from your own WhatsApp opens the chat with the message ready; you just tap send.
    waBtn.addEventListener('click', () => {
      setTimeout(() => save(c, { photo_whatsapp_status: 'sent' }).then(paint), 800);
    });
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try { Object.assign(c, await api(`/api/contacts/${c.id}/send-photo`, { method: 'POST' })); } catch { /* shown below */ }
      retry.disabled = false;
      paint();
    });
    paint();
  }

  async function save(c, patch) {
    try {
      Object.assign(c, await api(`/api/contacts/${c.id}`, { method: 'PATCH', body: patch }));
      toast('Saved');
    } catch (e) {
      if (e.message !== 'auth') toast('Could not save, please try again');
    }
  }

  // ---------- quick capture ----------

  let quickPhoto = null;
  function setQuickPhoto(dataUrl) {
    quickPhoto = dataUrl;
    $('#quick-photo-img').src = dataUrl || '';
    ['#quick-photo-img', '#quick-send-row', '#quick-photo-remove'].forEach((id) => $(id).classList.toggle('hidden', !dataUrl));
  }
  $('#quick-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const date = new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
      setQuickPhoto(await window.RCPhoto.compose(file, {
        title: profile.event.photoCaption || profile.event.name,
        subtitle: [profile.name, profile.company, date].filter((x) => x && !/^TODO/i.test(x)).join(' · '),
      }));
    } catch (err) { toast(err.message); }
  });
  $('#quick-photo-remove').addEventListener('click', () => setQuickPhoto(null));

  $('#quick-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = Object.fromEntries(new FormData(f));
    if (quickPhoto) { body.photo = quickPhoto; body.send_photo = $('#quick-send').checked; }
    try {
      await api('/api/contacts', { method: 'POST', body });
      f.reset();
      setQuickPhoto(null);
      toast(`${body.full_name} saved`);
      refresh();
    } catch (ex) {
      if (ex.data?.errors) toast(ex.data.errors[0]);
    }
  });

  // Voice notes: dictate what you discussed straight after the conversation.
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    const mic = $('#mic');
    const notes = $('#quick-form textarea[name="notes"]');
    let rec = null;
    mic.classList.remove('hidden');
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new Recognition();
      rec.lang = navigator.language || 'en-GB';
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const text = [...ev.results].map((r) => r[0].transcript).join(' ');
        notes.value = [notes.value.trim(), text].filter(Boolean).join(' ');
      };
      rec.onend = () => { rec = null; mic.classList.remove('listening'); };
      rec.onerror = () => toast('Could not hear you, try again');
      mic.classList.add('listening');
      rec.start();
    });
  }

  // ---------- filters & search ----------

  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    filter = chip.dataset.filter;
    document.querySelectorAll('#filters .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    refresh();
  });
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 250); });

  // ---------- QR mode ----------

  $('#show-qr').addEventListener('click', async () => {
    $('#qr-overlay').classList.remove('hidden');
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* screen may still dim */ }
  });
  $('#close-qr').addEventListener('click', () => {
    $('#qr-overlay').classList.add('hidden');
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    refresh();
  });

  // Keep the dashboard current while you're mingling.
  // Skip while a card is open or being edited so nothing you're typing gets replaced.
  setInterval(() => {
    const busy = document.querySelector('#list .c-more[open]') || $('#list').contains(document.activeElement);
    if (!busy && !document.hidden && !$('#app-view').classList.contains('hidden')) refresh().catch(() => {});
  }, 30000);

  fetch('/api/admin/me').then((r) => r.json()).then((d) => (d.authed ? showApp() : showLogin()));
})();
