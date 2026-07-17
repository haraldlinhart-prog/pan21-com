// api/famulor-order-checkout.js
// Wird vom Famulor "PAN21 Bestell-Agent" als Mid-Call-Tool aufgerufen,
// wenn ein Anrufer/Chat-Kunde eines der Fixpreis-Produkte aus dem
// PAN21 Shop bestellen möchte. Ruft den bestehenden, produktiven
// Checkout-Endpoint auf shop.pan21.com auf (erzeugt einen echten
// Stripe-Checkout-Link, keine Kartendaten laufen jemals durch die KI)
// und schickt diesen Link per SMS an die vom Kunden genannte
// Mobilnummer. Nutzt dieselben Twilio-Zugangsdaten wie
// famulor-notify.js / famulor-handoff.js.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  let body = req.body
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

  const slug  = body.product_slug
  const email = body.customer_email
  const phone = body.customer_phone

  if (!slug || !email || !phone) {
    return res.status(400).json({ error: 'product_slug, customer_email und customer_phone sind erforderlich' })
  }

  // Telefonnummer grob normalisieren (E.164-Versuch: nur führendes + und Ziffern behalten)
  const normalizedPhone = '+' + phone.replace(/[^\d]/g, '').replace(/^0+/, '')

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

    // 2) Checkout-Link per SMS an den Kunden schicken
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
