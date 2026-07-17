// api/presence.js
// "Bin ich am Schreibtisch?"-Schalter. GET ist oeffentlich und wird von
// Famulor (Zentrale-Assistent) vor jedem warm_call_transfer abgefragt, um zu
// entscheiden, ob ein Durchstellversuch zu Harry ueberhaupt sinnvoll ist.
// POST setzt den Status, geschuetzt durch ein Secret (PRESENCE_SECRET),
// gedacht fuer die kleine Toggle-Seite presence.html.

const SUPABASE_URL = 'https://frbvsdumltlzisddrlbi.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyYnZzZHVtbHRsemlzZGRybGJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNTk4NDQsImV4cCI6MjA5NzgzNTg0NH0.8Vrrs8tIyjdGrD3xGoQ3lkpv4G3LBvy4bpeXpaQ8OGY'

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/harry_presence?id=eq.1&select=at_desk,updated_at`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
    const rows = await r.json()
    const row = rows[0] || { at_desk: false, updated_at: null }
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ at_desk: !!row.at_desk, updated_at: row.updated_at })
  }

  if (req.method === 'POST') {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }

    const secret = process.env.PRESENCE_SECRET
    if (!secret || body.secret !== secret) {
      return res.status(401).json({ error: 'Nicht autorisiert' })
    }
    if (typeof body.at_desk !== 'boolean') {
      return res.status(400).json({ error: 'at_desk (boolean) ist erforderlich' })
    }

    const r = await fetch(`${SUPABASE_URL}/rest/v1/harry_presence?id=eq.1`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ at_desk: body.at_desk, updated_at: new Date().toISOString() }),
    })
    if (!r.ok) {
      return res.status(502).json({ error: 'Presence-Update fehlgeschlagen' })
    }
    return res.status(200).json({ ok: true, at_desk: body.at_desk })
  }

  return res.status(405).end()
}
