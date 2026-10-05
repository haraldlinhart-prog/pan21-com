// E-Mail-Versand über Resend (statt SMTP mit Postfach-Passwort im Code).
// Gleiche Schnittstelle wie nodemailer: sendMail({ from, to, subject, text, html, replyTo }).
// Dateien mit "_" am Anfang werden von Vercel nicht als eigene API-Route ausgeliefert.

async function sendMail({ from, to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY fehlt');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

module.exports = { sendMail };
