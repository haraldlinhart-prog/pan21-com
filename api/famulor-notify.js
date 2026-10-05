// api/famulor-notify.js
// Famulor post_call webhook → E-Mail an sms@pan21.com (über Resend, api/_mail.js).
// Eine Benachrichtigung pro Anruf, für alle Assistenten. E-Mail statt SMS, damit sie
// auf Reisen mit wechselnden SIM-Karten über jedes WLAN/Mobilnetz ankommt.
// Keine Mail, wenn die Weiterleitung zu Harald geklappt hat (er hatte den Anrufer selbst)
// und bei Kurz-/Spamanrufen ohne Namen, Anliegen oder Zusammenfassung.

const { sendMail } = require('./_mail')

const TO = 'sms@pan21.com'

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function val(v) {
  if (v === undefined || v === null) return ''
  const s = String(v).trim()
  return s === '–' || s === '-' || /^sample /i.test(s) ? '' : s
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

  const vars      = body.extracted_variables || {}
  const input     = body.input_variables && !Array.isArray(body.input_variables) ? body.input_variables : {}
  const isChat    = Boolean(body.conversation_id)   // conversation_ended-Webhook (Web-Chat/WhatsApp)
  const assistant = val(body.assistant_name) || 'Famulor-Assistent'
  const phone     = val(body.customer_phone) || val(input.kunden_fon) || (isChat ? '' : 'unbekannt')
  const duration  = Number(body.duration) || 0
  const caller    = val(vars.caller_name) || val(vars.customer_name) || val(body.customer_name) || val(input.kunden_name)
  const callback  = val(vars.caller_phone)
  const email     = val(vars.caller_email) || val(input.kunden_mail)
  const message   = val(vars.message_linhart) || val(vars.message) || val(vars.call_reason) || val(vars.anliegen) || val(input.kunden_text)

  // Werbe-/Verkaufsanrufe (vom Assistenten als solche erkannt) → keine Mail
  if (vars.is_sales_call === true || vars.is_sales_call === 'true') return res.status(200).json({ ok: true, skipped: 'sales_call' })
  const summary   = val(vars.summary)
  const recUrl    = val(body.recording_url)
  const transfers = Array.isArray(body.transfers) ? body.transfers : []
  const connected = transfers.some(t => t && t.status === 'completed' && Number(t.duration) > 0)

  // Weiterleitung hat geklappt → Harald hat selbst gesprochen, keine Mail nötig
  if (connected) return res.status(200).json({ ok: true, skipped: 'transferred' })
  // Kurz-/Spamanruf bzw. leerer Chat ohne verwertbaren Inhalt
  if ((isChat || duration < 10) && !caller && !message && !summary) return res.status(200).json({ ok: true, skipped: 'empty' })

  const subject = `${isChat ? '💬' : '☎️'} ${assistant}: ${caller || phone || 'unbekannt'}`
  const rows = [
    ['Assistent', assistant + (isChat ? ' (Chat)' : '')],
    [isChat ? 'Name' : 'Anrufer', caller],
    ['Nummer', phone],
    ['Rückrufnummer', callback && callback !== phone ? callback : ''],
    ['E-Mail', email],
    ['Dauer', isChat ? '' : `${duration} s`],
    ['Nachricht', message],
    ['Zusammenfassung', summary],
  ].filter(([, v]) => v)

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (recUrl ? `\nAufnahme: ${recUrl}` : '')
  const html =
    `<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('') +
    (recUrl ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Aufnahme</td><td style="padding:4px 0"><a href="${esc(recUrl)}">anhören</a></td></tr>` : '') +
    `</table>`

  try {
    const r = await sendMail({ from: '"PAN21 Anrufe" <mail@pan21.com>', to: TO, subject, text, html })
    console.log('Notify mail sent:', r.id)
    return res.status(200).json({ ok: true, id: r.id })
  } catch (err) {
    console.error('Notify mail error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
