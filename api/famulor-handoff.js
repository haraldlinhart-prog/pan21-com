// api/famulor-handoff.js
// Wird von Famulor als Mid-Call-Tool (Chat) aufgerufen, wenn ein Kunde
// im Chat explizit mit einer echten Person sprechen möchte.
// Benachrichtigt Harry sofort per SMS (gleiche Twilio-Zugangsdaten wie
// famulor-notify.js). Löst KEINE automatische KI-Pause aus, da Famulor
// aktuell keine dokumentierte {{conversation_id}}-Systemvariable für
// Mid-Call-Tools im Chat-Kontext anbietet - Harry pausiert die KI bei
// Bedarf manuell im Dashboard (Chat-Verlauf).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

  const name    = body.customer_name || 'unbekannt'
  const contact = body.customer_contact || 'unbekannt'
  const reason  = body.reason || '–'
  const channel = body.channel || 'Chat'

  const sms = [
    `🆘 Live-Support angefragt (${channel})`,
    `Name: ${name}`,
    `Kontakt: ${contact}`,
    `Anliegen: ${reason}`,
    `→ Famulor-Dashboard → Chat-Verlauf öffnen, KI dort manuell pausieren und übernehmen.`,
  ].join('\n')

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
    console.log('Handoff-SMS sent:', data.sid || data.message)
    // Antwort, die der Assistent dem Kunden mitteilen kann
    return res.status(200).json({
      ok: true,
      message_for_customer: 'Ich habe unser Team informiert, jemand meldet sich in Kürze bei Ihnen.',
    })
  } catch (err) {
    console.error('Handoff SMS error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
