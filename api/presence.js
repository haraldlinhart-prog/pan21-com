// api/presence.js
// Vercel Serverless Function — liest/schreibt den Status (Standort DE/TH und
// Anwesenheit at_desk) in der Supabase-Tabelle "harry_presence" (Projekt "PAN21 Counter").
//
// Nutzt NUR eingebaute Node-Module (https) — kein npm-Paket, kein globales `fetch`
// nötig, läuft daher auf jeder Node-Runtime-Version, die Vercel anbietet.
//
// Benötigte Environment Variables in Vercel (Project Settings → Environment Variables):
//   SUPABASE_URL              — https://frbvsdumltlzisddrlbi.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — der Service-Role-Key (serverseitig, nicht der anon-Key)

const https = require('https');
const { URL } = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const ROW_ID = 1;

function supabaseRequest(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    };
    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      options.headers['Prefer'] = 'return=representation';
    }

    const req = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (chunk) => (data += chunk));
      resp.on('end', () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch (e) {
            resolve(null);
          }
        } else {
          reject(new Error(`Supabase antwortete mit ${resp.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    res.status(500).json({
      error: 'Supabase ist nicht konfiguriert (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen in den Vercel Environment Variables).'
    });
    return;
  }

  const path = `/rest/v1/harry_presence?id=eq.${ROW_ID}`;

  if (req.method === 'GET') {
    try {
      const rows = await supabaseRequest('GET', path + '&select=location,at_desk');
      if (!rows || !rows.length) throw new Error(`Keine Zeile mit id=${ROW_ID} in harry_presence gefunden`);
      res.status(200).json({ location: rows[0].location, at_desk: rows[0].at_desk });
    } catch (err) {
      res.status(500).json({ error: 'Fehler beim Laden: ' + err.message });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const update = {};

      if (body && body.location !== undefined) {
        if (body.location !== 'DE' && body.location !== 'TH') {
          res.status(400).json({ error: "location muss 'DE' oder 'TH' sein" });
          return;
        }
        update.location = body.location;
      }

      if (body && body.at_desk !== undefined) {
        if (typeof body.at_desk !== 'boolean') {
          res.status(400).json({ error: 'at_desk muss true oder false sein' });
          return;
        }
        update.at_desk = body.at_desk;
      }

      if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "Body muss 'location' und/oder 'at_desk' enthalten" });
        return;
      }

      const rows = await supabaseRequest('PATCH', path, update);
      const row = rows && rows[0] ? rows[0] : update;
      res.status(200).json({ location: row.location, at_desk: row.at_desk });
    } catch (err) {
      res.status(500).json({ error: 'Fehler beim Speichern: ' + err.message });
    }
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).json({ error: `Methode ${req.method} nicht erlaubt` });
};
