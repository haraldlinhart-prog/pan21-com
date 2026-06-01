// api/contact.js – PAN21 Kontaktformular
// Vercel Serverless Function – kein npm, nur Node.js built-ins
// Spam-Schutz: Honeypot + Zeitprüfung + Rate-Limit (in-memory)

const https = require('https');

// ── Rate-Limit ──────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_MAX    = 3;
const RATE_WINDOW = 60 * 60 * 1000; // 1 Stunde

function isRateLimited(ip) {
  const now  = Date.now();
  const hits = (rateLimitMap.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  hits.push(now);
  rateLimitMap.set(ip, hits);
  return hits.length > RATE_MAX;
}

// ── SMTP via net/tls (STARTTLS auf Port 587) ────────────────────
function sendMail({ to, subject, html, text, replyTo }) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const tls = require('tls');

    const HOST = 'mail.pan21.com';
    const PORT = 587;
    const USER = 'mail@pan21.com';
    const PASS = process.env.SMTP_PASS || 'Pan21003jomtien';
    const FROM = 'mail@pan21.com';

    const b64 = (s) => Buffer.from(s).toString('base64');

    // MIME multipart/alternative (text + html)
    const boundary = 'pan21_' + Date.now();
    const replyHeader = replyTo ? `Reply-To: ${replyTo}\r\n` : '';
    const mime = [
      `From: "PAN21.com" <${FROM}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      replyTo ? `Reply-To: ${replyTo}` : '',
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      'Date: ' + new Date().toUTCString(),
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(html),
      '',
      `--${boundary}--`,
    ].filter(l => l !== null).join('\r\n');

    let socket = net.createConnection(PORT, HOST);
    let tlsSocket = null;
    let active = socket;
    let state = 'greeting';
    let buf = '';

    const write = (s) => { active.write(s + '\r\n'); };

    const onData = (data) => {
      buf += data.toString();
      const lines = buf.split('\r\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line) continue;
        const code = line.slice(0, 3);

        if (state === 'greeting'    && code === '220') { state = 'ehlo';     write('EHLO pan21.com'); }
        else if (state === 'ehlo'   && code === '250' && !line.startsWith('250-')) { state = 'starttls'; write('STARTTLS'); }
        else if (state === 'starttls' && code === '220') {
          state = 'tlshandshake';
          tlsSocket = tls.connect({ socket, host: HOST, rejectUnauthorized: false }, () => {
            active = tlsSocket;
            tlsSocket.on('data', onData);
            state = 'ehlo2';
            write('EHLO pan21.com');
          });
        }
        else if (state === 'ehlo2'  && code === '250' && !line.startsWith('250-')) { state = 'auth';     write('AUTH LOGIN'); }
        else if (state === 'auth'   && code === '334') { state = 'user';     write(b64(USER)); }
        else if (state === 'user'   && code === '334') { state = 'pass';     write(b64(PASS)); }
        else if (state === 'pass'   && code === '235') { state = 'mailfrom'; write(`MAIL FROM:<${FROM}>`); }
        else if (state === 'mailfrom' && code === '250') { state = 'rcptto';  write(`RCPT TO:<${to}>`); }
        else if (state === 'rcptto' && code === '250') { state = 'data';     write('DATA'); }
        else if (state === 'data'   && code === '354') { state = 'body';     write(mime + '\r\n.'); }
        else if (state === 'body'   && code === '250') { state = 'quit';     write('QUIT'); resolve(); }
        else if (state === 'quit') { active.destroy(); }
        else if (code[0] === '4' || code[0] === '5') {
          active.destroy();
          reject(new Error(`SMTP ${code}: ${line}`));
        }
      }
    };

    socket.on('data', onData);
    socket.on('error', reject);
    socket.setTimeout(15000, () => { active.destroy(); reject(new Error('SMTP timeout')); });
  });
}

// ── Handler ─────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  res.setHeader('Access-Control-Allow-Origin', 'https://pan21.com');

  try {
    const { email, name, land, nachricht, _hp, _ts } = req.body;

    // Honeypot
    if (_hp && _hp.trim() !== '') return res.status(200).json({ ok: true });

    // Zeitprüfung (mind. 3 Sekunden)
    if (!_ts || (Date.now() - parseInt(_ts, 10)) < 3000) return res.status(200).json({ ok: true });

    // Rate-Limit
    if (isRateLimited(ip)) return res.status(429).json({ ok: false, error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });

    // Pflichtfelder
    if (!email || !email.includes('@') || !nachricht || nachricht.trim().length < 5)
      return res.status(400).json({ ok: false, error: 'Bitte füllen Sie alle Pflichtfelder aus.' });

    const safeName     = (name     || '').slice(0, 200).replace(/[<>]/g, '');
    const safeLand     = (land     || '–').slice(0, 100).replace(/[<>]/g, '');
    const safeEmail    = email.slice(0, 200).replace(/[<>]/g, '');
    const safeNachricht= nachricht.slice(0, 5000).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const timestamp    = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

    // Mail an Besucher
    await sendMail({
      to:      safeEmail,
      subject: 'Kontaktanfrage PAN21 – Ihre Nachricht ist angekommen',
      text:
`Vielen Dank für Ihre Anfrage bei PAN21!

Wir haben Ihre Nachricht erhalten und melden uns innerhalb von 24 Stunden.

Ihre Angaben:
Land / Rechtsform: ${safeLand}
Nachricht:
${nachricht}

Bei Fragen: 030 – 568 44 500 oder support@pan21.com
Online-Termin: https://telefon-termin.com/beratung/

PAN21.COM Corporate Consultants Ltd
61 Bridge Street, Kington, Herefordshire, England`,
      html:
`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;background:#f4f6fa;margin:0;padding:0}
.w{max-width:560px;margin:32px auto;background:#fff;border:1px solid #e0e4ee;padding:36px 40px}
.logo{font-size:1.2rem;font-weight:900;letter-spacing:.08em;color:#080a0d;margin-bottom:24px}
.logo span{background:#c9a84c;color:#080a0d;padding:2px 8px;font-size:.72rem}
h2{font-size:1rem;color:#080a0d;margin-bottom:12px}
p{font-size:.88rem;color:#404a5a;line-height:1.7;margin:0 0 12px}
.box{background:#f8f9fc;border-left:3px solid #c9a84c;padding:14px 18px;margin:18px 0;font-size:.84rem;color:#404a5a;white-space:pre-wrap}
.ft{margin-top:28px;font-size:.73rem;color:#9aa0ac;border-top:1px solid #e8eaf0;padding-top:14px}
a{color:#c9a84c}
</style></head><body><div class="w">
<div class="logo"><span>PAN21</span> .COM</div>
<h2>Vielen Dank für Ihre Anfrage${safeName ? ', ' + safeName : ''}!</h2>
<p>Wir haben Ihre Nachricht erhalten und melden uns <strong>innerhalb von 24 Stunden</strong> bei Ihnen.</p>
<div class="box"><strong>Land / Rechtsform:</strong> ${safeLand}

<strong>Nachricht:</strong>
${safeNachricht}</div>
<p>Telefonisch erreichbar: <strong>030 – 568 44 500</strong><br>
Online-Termin: <a href="https://telefon-termin.com/beratung/">telefon-termin.com/beratung/</a></p>
<div class="ft">PAN21.COM Corporate Consultants Ltd · 61 Bridge Street, Kington, Herefordshire, England<br>
<a href="mailto:support@pan21.com">support@pan21.com</a> · <a href="https://pan21.com">pan21.com</a><br><br>
Diese E-Mail wurde automatisch generiert.</div>
</div></body></html>`
    });

    // Interne Kopie
    await sendMail({
      to:      'support@pan21.com',
      replyTo: safeEmail,
      subject: `Kontaktanfrage PAN21 – ${safeLand}${safeName ? ' – ' + safeName : ''}`,
      text:
`Neue Kontaktanfrage – pan21.com

Zeitpunkt:       ${timestamp}
Name:            ${safeName || '–'}
E-Mail:          ${safeEmail}
Land/Rechtsform: ${safeLand}
IP:              ${ip}

Nachricht:
${nachricht}`,
      html:
`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;background:#f4f6fa;margin:0;padding:0}
.w{max-width:560px;margin:32px auto;background:#fff;border:1px solid #e0e4ee;padding:36px 40px}
h2{font-size:1rem;color:#080a0d;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:.86rem}
td{padding:7px 10px;border-bottom:1px solid #f0f2f6;color:#404a5a}
td:first-child{color:#7a8898;width:140px}
.msg{background:#f8f9fc;border-left:3px solid #c9a84c;padding:14px 18px;margin-top:14px;font-size:.85rem;color:#404a5a;white-space:pre-wrap}
.ft{margin-top:20px;font-size:.72rem;color:#9aa0ac}
a{color:#c9a84c}
</style></head><body><div class="w">
<h2>🆕 Neue Kontaktanfrage – pan21.com</h2>
<table>
<tr><td>Zeitpunkt</td><td>${timestamp}</td></tr>
<tr><td>Name</td><td>${safeName || '–'}</td></tr>
<tr><td>E-Mail</td><td><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
<tr><td>Land / Rechtsform</td><td>${safeLand}</td></tr>
<tr><td>IP</td><td>${ip}</td></tr>
</table>
<div class="msg">${safeNachricht}</div>
<div class="ft">„Antworten" antwortet direkt an den Absender.</div>
</div></body></html>`
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Mail error:', err);
    return res.status(500).json({ ok: false, error: 'Technischer Fehler. Bitte schreiben Sie direkt an support@pan21.com.' });
  }
};
