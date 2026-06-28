// api/famulor-notify.js
// Famulor post_call webhook → SMS via Twilio an +4915758234914

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

  const phone     = body.customer_phone || 'unbekannt'
  const duration  = body.duration || 0
  const vars      = body.extracted_variables || {}
  const summary   = vars.summary || '–'
  const caller    = vars.caller_name || '–'
  const message   = vars.message_linhart || vars.message || '–'
  const recUrl    = body.recording_url || ''

  // SMS-Text zusammenstellen
  const sms = [
    `☎️ Neuer Anruf bei Frau Wagner`,
    `Von: ${phone}`,
    caller !== '–' ? `Name: ${caller}` : null,
    `Dauer: ${duration}s`,
    message !== '–' ? `Nachricht: ${message}` : null,
    summary !== '–' ? `Zusammenfassung: ${summary}` : null,
    recUrl ? `Aufnahme: ${recUrl}` : null,
  ].filter(Boolean).join('\n')

  // Twilio SMS
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_SMS_FROM || '+19545161442'
  const toNumber   = '+4915758234914'

  if (!accountSid || !authToken) {
    console.error('Twilio credentials missing')
    return res.status(500).json({ error: 'Twilio not configured' })
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: fromNumber, To: toNumber, Body: sms.slice(0, 1600) }),
      }
    )
    const data = await r.json()
    console.log('SMS sent:', data.sid || data.message)
    return res.status(200).json({ ok: true, sid: data.sid })
  } catch (err) {
    console.error('SMS error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
