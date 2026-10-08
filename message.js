// The personal "connect" message sent with the photo on WhatsApp.
//
// By default it is written from what the person told you (company, interests, challenge).
// To use your own wording, set "connectMessage" in config/profile.json. Placeholders:
//   {firstName} {company} {event} {interest} {challenge} {myName} {myCompany} {linkedin} {website}
// A line whose placeholders are all empty is dropped, so optional lines stay tidy.

const real = (v) => (v && !/^TODO/i.test(v) ? v : '');

function fields(contact, profile) {
  return {
    firstName: contact.full_name.split(/\s+/)[0],
    company: contact.company || '',
    event: contact.event || profile.event?.name || '',
    interest: (contact.interests || []).filter((i) => !/^something else$/i.test(i)).slice(0, 2).join(' and ').toLowerCase(),
    challenge: contact.challenge || '',
    myName: profile.name,
    myCompany: real(profile.company),
    linkedin: real(profile.linkedin),
    website: real(profile.website),
  };
}

function fillTemplate(template, f) {
  return template
    .split('\n')
    .filter((line) => {
      const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      return !keys.length || keys.some((k) => f[k]);
    })
    .map((line) => line.replace(/\{(\w+)\}/g, (_, k) => f[k] ?? ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function defaultMessage(f) {
  const where = f.company ? `${f.event}, and learning about ${f.company}` : f.event;
  let personal;
  if (f.challenge) {
    const quote = f.challenge.length > 120 ? `${f.challenge.slice(0, 120)}…` : f.challenge;
    personal = `You mentioned "${quote}". I've been thinking about it and have a few ideas that could help.`;
  } else if (f.interest) {
    personal = `Since you're interested in ${f.interest}, I'd be glad to share what's working well for others right now.`;
  } else {
    personal = 'I really enjoyed our conversation and would love to continue it.';
  }
  const links = [f.linkedin && `🔗 LinkedIn: ${f.linkedin}`, f.website && `🌐 ${f.website}`].filter(Boolean).join('\n');
  return [
    `Hi ${f.firstName}! 👋`,
    `It was a real pleasure meeting you at ${where}. Here's our photo together 📸`,
    personal,
    "Let's stay connected. Feel free to message me here anytime.",
    links,
    `Warm regards,\n${f.myName}${f.myCompany ? `\n${f.myCompany}` : ''}`,
  ].filter(Boolean).join('\n\n');
}

function buildConnectMessage(contact, profile) {
  const f = fields(contact, profile);
  return profile.connectMessage ? fillTemplate(profile.connectMessage, f) : defaultMessage(f);
}

module.exports = { buildConnectMessage };
