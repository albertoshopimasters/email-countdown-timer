// Servidor de temporizadores de cuenta atrás para email (GIF animado generado en cada apertura)
const express = require('express');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

GlobalFonts.registerFromPath(path.join(__dirname, 'fonts/Poppins-Bold.ttf'), 'TimerBold');
GlobalFonts.registerFromPath(path.join(__dirname, 'fonts/Poppins-Regular.ttf'), 'TimerRegular');

const app = express();
const FRAMES = 60; // 60 s de animación; al reabrir el email se regenera con la hora real

const LABELS = {
  es: ['DÍAS', 'HORAS', 'MIN', 'SEG'],
  en: ['DAYS', 'HOURS', 'MINS', 'SECS'],
  pt: ['DIAS', 'HORAS', 'MIN', 'SEG'],
  de: ['TAGE', 'STUNDEN', 'MIN', 'SEK'],
  fr: ['JOURS', 'HEURES', 'MIN', 'SEC'],
};

// Caché en memoria: misma config + mismo segundo restante => mismo GIF.
// Clave para envíos masivos: miles de aperturas a la vez generan 1 GIF por segundo.
const cache = new Map();
const CACHE_MAX = 500;

const hex = (v, d) => (/^[0-9a-f]{6}$/i.test(v || '') ? '#' + v : d);
const pad = (n) => String(n).padStart(2, '0');

function splitTime(s) {
  s = Math.max(0, s);
  return [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
}

function buildGif(opts, secondsLeft) {
  const { width, height, bg, fg, label, lang, expiredText } = opts;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();
  const labels = LABELS[lang] || LABELS.es;
  const frames = secondsLeft <= 0 ? 1 : Math.min(FRAMES, secondsLeft + 1);
  let palette = null;

  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (secondsLeft <= 0 && expiredText) {
      ctx.fillStyle = fg;
      ctx.font = `${Math.round(height * 0.3)}px TimerBold`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(expiredText, width / 2, height / 2);
    } else {
      const parts = splitTime(secondsLeft - i);
      const col = width / 4;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      parts.forEach((v, k) => {
        const cx = col * k + col / 2;
        ctx.fillStyle = fg;
        ctx.font = `${Math.round(height * 0.45)}px TimerBold`;
        ctx.fillText(pad(v), cx, height * 0.6);
        ctx.fillStyle = label;
        ctx.font = `${Math.round(height * 0.13)}px TimerRegular`;
        ctx.fillText(labels[k], cx, height * 0.85);
        if (k < 3) {
          ctx.fillStyle = fg;
          ctx.font = `${Math.round(height * 0.35)}px TimerBold`;
          ctx.fillText(':', col * (k + 1), height * 0.55);
        }
      });
    }

    const { data } = ctx.getImageData(0, 0, width, height);
    if (!palette) palette = quantize(data, 16); // pocos colores => GIF ligero
    const index = applyPalette(data, palette);
    // repeat: -1 => se reproduce una vez y se queda en el último frame
    gif.writeFrame(index, width, height, { palette, delay: 1000, repeat: -1 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

app.get('/timer.gif', (req, res) => {
  const t0 = Date.now();
  const end = Date.parse(req.query.end);
  if (isNaN(end)) {
    console.log(`GIF 400 end inválido: ${JSON.stringify(req.query.end)}`);
    return res.status(400).send('Parámetro "end" inválido (ISO 8601, ej. 2026-11-27T00:00:00+01:00)');
  }

  const opts = {
    width: Math.min(Math.max(parseInt(req.query.w) || 600, 200), 800),
    height: Math.min(Math.max(parseInt(req.query.h) || 120, 60), 300),
    bg: hex(req.query.bg, '#000000'),
    fg: hex(req.query.fg, '#ffffff'),
    label: hex(req.query.label, '#bbbbbb'),
    lang: req.query.lang || 'es',
    expiredText: (req.query.expired || '').slice(0, 40),
  };
  const secondsLeft = Math.floor((end - Date.now()) / 1000);
  const key = JSON.stringify(opts) + '|' + Math.max(secondsLeft, 0);

  let buf = cache.get(key);
  const hit = !!buf;
  if (!buf) {
    buf = buildGif(opts, secondsLeft);
    cache.set(key, buf);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.send(buf);

  const [d, h, m] = splitTime(secondsLeft);
  const restante = secondsLeft <= 0 ? 'EXPIRADO' : `${d}d${h}h${m}m`;
  console.log(`GIF lang=${opts.lang} end=${req.query.end} restante=${restante} cache=${hit ? 'HIT' : 'MISS'} ${Date.now() - t0}ms`);
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'builder.html')));

app.listen(process.env.PORT || 3000, () => console.log('Timer server listo'));
