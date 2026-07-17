// api/famulor-order-checkout.js
// Wird vom Famulor "PAN21 Bestell-Agent" als Mid-Call-Tool aufgerufen,
// wenn ein Anrufer/Chat-Kunde eines der Fixpreis-Produkte aus dem
// PAN21 Shop bestellen möchte. Ruft den bestehenden, produktiven
// Checkout-Endpoint auf shop.pan21.com auf (erzeugt einen echten
// Stripe-Checkout-Link, keine Kartendaten laufen jemals durch die KI)
// und schickt diesen Link per SMS ODER E-Mail an den Kunden, je nach
// gewünschtem delivery_method. SMS nutzt dieselben Twilio-Zugangsdaten
// wie famulor-notify.js / famulor-handoff.js. E-Mail nutzt dasselbe
// SMTP-Konto (mail.pan21.com) wie contact.js.

const nodemailer = require('nodemailer')

const mailTransporter = nodemailer.createTransport({
  host:   'mail.pan21.com',
  port:   465,
  secure: true,
  auth: {
    user: 'mail@pan21.com',
    pass: process.env.SMTP_PASS || 'Pan21003jomtien',
  },
  tls: { rejectUnauthorized: false },
})

async function sendCheckoutEmail(email, checkoutUrl) {
  await mailTransporter.sendMail({
    from:    '"PAN21.com" <mail@pan21.com>',
    to:      email,
    subject: 'Ihr Zahlungslink für Ihre PAN21-Bestellung',
    text:
`Vielen Dank für Ihre Bestellung bei PAN21!

Über den folgenden sicheren Link (Stripe) können Sie die Zahlung abschließen:
${checkoutUrl}

Nach erfolgreicher Zahlung erhalten Sie automatisch eine Bestätigung und den Fragebogen für die nächsten Schritte.

Bei Fragen: support@pan21.com oder 030 – 568 44 500

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
.btn{display:inline-block;background:#c9a84c;color:#080a0d;font-weight:700;text-decoration:none;padding:12px 24px;margin:14px 0;font-size:.9rem}
.ft{margin-top:28px;font-size:.73rem;color:#9aa0ac;border-top:1px solid #e8eaf0;padding-top:14px}
a{color:#c9a84c}
</style></head><body><div class="w">
<div class="logo"><span>PAN21</span> .COM</div>
<h2>Ihr Zahlungslink ist bereit</h2>
<p>Vielen Dank für Ihre Bestellung! Über den folgenden sicheren Stripe-Link können Sie die Zahlung abschließen:</p>
<a class="btn" href="${checkoutUrl}">Jetzt bezahlen</a>
<p>Nach erfolgreicher Zahlung erhalten Sie automatisch eine Bestätigung und den Fragebogen für die nächsten Schritte.</p>
<div class="ft">PAN21.COM Corporate Consultants Ltd · 61 Bridge Street, Kington, Herefordshire, England<br>
<a href="mailto:support@pan21.com">support@pan21.com</a> · <a href="https://pan21.com">pan21.com</a></div>
</div></body></html>`,
  })
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

  const slug           = body.product_slug
  const email          = body.customer_email
  const phone          = body.customer_phone
  const deliveryMethod = (body.delivery_method || '').toLowerCase() === 'sms' ? 'sms' : 'email'

  if (!slug || !email) {
    return res.status(400).json({ error: 'product_slug und customer_email sind erforderlich' })
  }
  if (deliveryMethod === 'sms' && !phone) {
    return res.status(400).json({ error: 'customer_phone ist erforderlich, wenn delivery_method sms ist' })
  }

  // Telefonnummer grob normalisieren (E.164-Versuch: nur führendes + und Ziffern behalten)
  const normalizedPhone = phone ? '+' + phone.replace(/[^\d]/g, '').replace(/^0+/, '') : null

  try {
    // 1) Echten Stripe-Checkout-Link vom bestehenden Shop-Endpoint holen
    const checkoutRes = await fetch('https://shop.pan21.com/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, email, affiliate_ref: 'famulor_bestell_agent' }),
    })
    const checkoutData = await checkoutRes.json()

    if (!checkoutRes.ok || !checkoutData.url) {
      return res.status(200).json({
        ok: false,
        message_for_customer: 'Für dieses Produkt ist leider kein direkter Online-Checkout möglich. Bitte lassen Sie sich vom Team ein individuelles Angebot erstellen.',
      })
    }

    // 2) Checkout-Link per E-Mail oder SMS an den Kunden schicken
    if (deliveryMethod === 'email') {
      try {
        await sendCheckoutEmail(email, checkoutData.url)
        console.log('Order checkout email sent to', email, 'for product', slug)
        return res.status(200).json({
          ok: true,
          message_for_customer: 'Ich habe Ihnen den sicheren Zahlungslink per E-Mail geschickt. Nach erfolgreicher Zahlung erhalten Sie automatisch eine Bestaetigung und den Fragebogen fuer die naechsten Schritte.',
        })
      } catch (mailErr) {
        console.error('Order checkout email failed:', mailErr.message)
        return res.status(200).json({
          ok: true,
          checkout_url: checkoutData.url,
          message_for_customer: 'Der Zahlungslink wurde erstellt, konnte aber nicht per E-Mail zugestellt werden. Bitte pruefen Sie die E-Mail-Adresse oder fragen Sie nach einer alternativen Zustellung (z.B. SMS).',
        })
      }
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID

    const authToken  = process.env.TWILIO_AUTH_TOKEN
    const fromNumber = process.env.TWILIO_SMS_FROM || '+19545161442'

    if (!accountSid || !authToken) {
      console.error('Twilio credentials missing')
      return res.status(200).json({
        ok: true,
        checkout_url: checkoutData.url,
        message_for_customer: 'Der Zahlungslink konnte nicht per SMS versendet werden, bitte notieren Sie sich den Link, den ich Ihnen jetzt vorlese, oder fragen Sie nach einer alternativen Zustellung.',
      })
    }

    const smsBody = `PAN21: Ihr Zahlungslink für die Bestellung ist bereit: ${checkoutData.url}\nDer Link ist über Stripe gesichert. Bei Fragen: shop@pan21.com`
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    const smsRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: fromNumber, To: normalizedPhone, Body: smsBody }),
      }
    )
    const smsData = await smsRes.json()

    if (!smsRes.ok) {
      console.error('SMS send failed:', smsData)
      return res.status(200).json({
        ok: true,
        checkout_url: checkoutData.url,
        message_for_customer: 'Der Zahlungslink wurde erstellt, konnte aber nicht per SMS zugestellt werden. Bitte pruefen Sie die Mobilnummer oder fragen Sie nach einer alternativen Zustellung (z.B. E-Mail).',
      })
    }

    console.log('Order checkout SMS sent:', smsData.sid, 'for product', slug)
    return res.status(200).json({
      ok: true,
      message_for_customer: 'Ich habe Ihnen den sicheren Zahlungslink per SMS geschickt. Nach erfolgreicher Zahlung erhalten Sie automatisch eine Bestaetigung und den Fragebogen fuer die naechsten Schritte.',
    })
  } catch (err) {
    console.error('Order checkout error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
