// api/famulor-handoff.js
// Wird von Famulor als Mid-Call-Tool aufgerufen, wenn ein Kunde (vor allem im Chat)
// explizit mit einer echten Person sprechen möchte.
// Benachrichtigt Harald sofort per E-Mail an sms@pan21.com (über Resend, api/_mail.js) –
// gleicher Weg wie famulor-notify.js, damit es auch auf Reisen ankommt.
// Löst KEINE automatische KI-Pause aus: Harald übernimmt bei Bedarf manuell im
// Famulor-Dashboard (Chat-Verlauf).

const { sendMail } = require('./_mail')

const TO = 'sms@pan21.com'

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

  const name    = String(body.customer_name || '').trim()
  const contact = String(body.customer_contact || '').trim()
  const reason  = String(body.reason || '').trim()
  const channel = String(body.channel || 'Chat').trim()

  // Ohne jede Angabe nichts verschicken (z. B. leerer Testaufruf)
  if (!name && !contact && !reason) {
    return res.status(200).json({
      ok: false,
      message_for_customer: 'Bitte nennen Sie mir kurz Ihren Namen, wie wir Sie erreichen und worum es geht.',
    })
  }

  const rows = [
    ['Kanal', channel],
    ['Name', name || 'unbekannt'],
    ['Kontakt', contact || 'unbekannt'],
    ['Anliegen', reason || '–'],
  ]
  const hint = 'Im Famulor-Dashboard den Verlauf öffnen, die KI dort pausieren und übernehmen.'
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${hint}`
  const html =
    `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('') +
    `</table><p style="font-family:Arial,sans-serif;font-size:14px">${esc(hint)}</p>`

  try {
    const r = await sendMail({
      from: '"PAN21 Live-Support" <mail@pan21.com>',
      to: TO,
      subject: `🆘 Live-Support angefragt (${channel}): ${name || contact || 'unbekannt'}`,
      text,
      html,
    })
    console.log('Handoff mail sent:', r.id)
    return res.status(200).json({
      ok: true,
      message_for_customer: 'Ich habe unser Team informiert, jemand meldet sich in Kürze bei Ihnen.',
    })
  } catch (err) {
    console.error('Handoff mail error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
