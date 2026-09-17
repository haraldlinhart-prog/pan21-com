// api/presence.js
// Vercel Serverless Function — liest/schreibt den aktuellen Standort (DE/TH)
// in der Supabase-Tabelle "harry_presence" (Spalte "location", Check-Constraint 'DE'/'TH').
//
// Benötigte Environment Variables in Vercel (Project Settings → Environment Variables):
//   SUPABASE_URL              — z.B. https://xxxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — der Service-Role-Key (NICHT der anon/public key,
//                                da hier serverseitig geschrieben wird)
//
// Falls das Projekt stattdessen andere Variablennamen verwendet (z.B. SUPABASE_SERVICE_KEY),
// einfach unten in den Fallbacks ergänzen oder in Vercel umbenennen.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Es wird von genau einer Zeile in harry_presence ausgegangen (Single-Row-Status).
// Falls die Tabelle stattdessen über eine feste ID identifiziert wird, hier anpassen.
const ROW_ID = 1;

module.exports = async (req, res) => {
  if (!supabase) {
    res.status(500).json({
      error: 'Supabase ist nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen in den Vercel Environment Variables).'
    });
    return;
  }

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('harry_presence')
        .select('location')
        .eq('id', ROW_ID)
        .single();

      if (error) throw error;

      res.status(200).json({ location: data.location });
    } catch (err) {
      res.status(500).json({ error: 'Fehler beim Laden: ' + err.message });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const location = body && body.location;

      if (location !== 'DE' && location !== 'TH') {
        res.status(400).json({ error: "location muss 'DE' oder 'TH' sein" });
        return;
      }

      const { error } = await supabase
        .from('harry_presence')
        .update({ location })
        .eq('id', ROW_ID);

      if (error) throw error;

      res.status(200).json({ location });
    } catch (err) {
      res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
    }
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).json({ error: `Methode ${req.method} nicht erlaubt` });
};
