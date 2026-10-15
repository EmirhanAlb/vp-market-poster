import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePoster } from './capture.js';
import { uploadPosterToSlack } from './slack.js';
import { posterGonder } from './telegram-out/index.js';
import { bugunSaat, saatCoz } from './poll/time.js';
import { slotluHedefler } from './slack-out/targets.js';

// Lokal calistirmada .env dosyasini oku (GitHub Actions'ta secrets zaten env olarak gelir).
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const dryRun = process.argv.includes('--dry-run');
const TZ = process.env.TZ_NAME || 'Europe/Istanbul';

function stamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    file: `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}`,
    human: `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`,
  };
}

async function birTur() {
  const { file, human } = stamp();
  const outDir = path.join(rootDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `vestaprime-market-${file}.png`);

  console.log(`Poster yakalaniyor -> ${outPath}`);
  const result = await capturePoster(outPath);
  const bytes = fs.statSync(outPath).size;
  console.log(`Yakalandi (${(bytes / 1024).toFixed(0)} KB) | durum: ${result.status || 'bilinmiyor'}`);

  if (dryRun) {
    console.log('--dry-run: Slack gonderimi atlandi.');
    return;
  }

  // Token workspace'e bagli: kanallar token'a gore gruplanip her grup kendi
  // token'iyla yukleniyor.
  //   SLACK_CHANNEL_ID    - SLACK_BOT_TOKEN'in workspace'indeki kanallar ("C123,C456")
  //   POSTER_EK_KANALLAR  - baska workspace'lerdeki kanallar ("montenegro:C0BNPGR567R")
  const gruplar = new Map();
  const ekle = (token, channel) => {
    if (!gruplar.has(token)) gruplar.set(token, new Set());
    gruplar.get(token).add(channel);
  };
  const varsayilan = (process.env.SLACK_CHANNEL_ID || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (process.env.SLACK_BOT_TOKEN) for (const c of varsayilan) ekle(process.env.SLACK_BOT_TOKEN, c);
  const ek = slotluHedefler(process.env.POSTER_EK_KANALLAR);
  for (const h of ek.hedefler) ekle(h.token, h.channel);

  if (gruplar.size === 0) {
    throw new Error(
      'Poster kanali tanimli degil: SLACK_BOT_TOKEN + SLACK_CHANNEL_ID ya da POSTER_EK_KANALLAR gerekli.',
    );
  }

  const warn = result.live ? '' : '\n_(Not: fiyatlar canli akisa gecmeden yakalandi.)_';
  const toplam = [...gruplar.values()].reduce((n, k) => n + k.size, 0);
  console.log(`Slack'e gonderiliyor (${toplam} kanal, ${gruplar.size} workspace)...`);
  const results = [];
  for (const [token, channels] of gruplar) {
    results.push(
      ...(await uploadPosterToSlack({
        token,
        channels: [...channels],
        filePath: outPath,
        title: `Vestaprime — Canli Piyasalar ${human}`,
        comment: `:chart_with_upwards_trend: *Canli Piyasalar* — ${human}\n<https://vestaprimes.com/en/market-poster|vestaprimes.com>${warn}`,
      })),
    );
  }
  for (const hata of ek.hatalar) results.push({ channel: 'POSTER_EK_KANALLAR', ok: false, error: hata });

  const failed = results.filter((r) => !r.ok);
  console.log(`Ozet: ${results.length - failed.length}/${results.length} kanal basarili`);

  // Telegram cikisi opsiyonel; TELEGRAM_OUT_POSTER bos ise atlanir.
  await posterGonder({ dosyaYolu: outPath, saat: human, canli: result.live });

  // Bir kanal basarisiz olsa bile digerlerine gonderim yapildi; yine de
  // calistirmayi hatali isaretliyoruz ki Actions'ta gozden kacmasin.
  if (failed.length) {
    throw new Error(`Su kanallara gonderilemedi: ${failed.map((f) => `${f.channel} (${f.error})`).join(', ')}`);
  }

  // Actions calistirmalarinda diski sisirmemek icin dosyayi birak, calisma zaten efemer.
  if (process.env.KEEP_LOCAL_FILE !== '1' && process.env.CI) fs.unlinkSync(outPath);
}

/**
 * Gonderim saatleri (Turkiye saati). Poster yalnizca bu saatlerde gider,
 * aradaki saatlerde hicbir sey gonderilmez. Workflow'da POSTER_SAATLERI
 * repo degiskeniyle degistirilebilir: "11:00,14:00,16:00".
 */
const SAATLER = (process.env.POSTER_SAATLERI || '11:00,14:00,16:00,16:50,17:00,18:00')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [saat, dakika] = saatCoz(s, []);
    if (saat === undefined || saat > 23 || dakika > 59) throw new Error(`POSTER_SAATLERI icinde gecersiz saat: "${s}"`);
    return [saat, dakika];
  })
  .sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));

/** Simdiden sonraki ilk gonderim ani (bugun ya da yarin). */
function sonrakiGonderim(simdi = new Date()) {
  for (const gun of [0, 1]) {
    const referans = new Date(simdi.getTime() + gun * 86_400_000);
    for (const [saat, dakika] of SAATLER) {
      const an = bugunSaat(saat, dakika, TZ, referans);
      if (an.getTime() > simdi.getTime()) return an;
    }
  }
  throw new Error('Gonderim saati listesi bos.');
}

/**
 * Dongu modu: zincirin tek halkasi.
 *
 * Saatlik cron ayarliydi ama GitHub'in zamanlayicisi bu repoda onu
 * calistirmiyor: 27-31 Agustos 2026 arasinda gunde 24 yerine 1-6 calistirma
 * gerceklesti, aralarda 10 saati asan bosluklar oldu. Son Dakika ve
 * FinancialJuice akislarindaki cozumun ayni: tek uzun is icinde kendimiz
 * bekliyoruz, is bitince workflow kendini yeniden tetikliyor.
 *
 * Halka sinirinda gonderim kacmasin diye: halka, sonraki gonderim kendi
 * suresinin TASMA_DK fazlasina kadar ise onu da kendisi yapar; yalnizca
 * sonraki gonderim bundan da uzaktaysa cikar. Yeni halkanin kurulumu (~4 dk)
 * boylece hicbir gonderim saatine denk gelmiyor.
 *
 * Kacan saat sonradan telafi edilmiyor: zincir koptuysa ve gec uyandiysa o
 * saat atlanir. Gec bir poster, ust uste iki poster gondermekten iyidir.
 *
 * Tarayici her turda capture.js icindeki finally blogunda kapaniyor, bu
 * yuzden uzun dongude surec sismiyor.
 */
const HALKA_DK = Number(process.env.LOOP_MINUTES || 300);
const TASMA_DK = 15;

const uyu = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const saatYaz = (an) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(an);

async function dongu() {
  const bitis = Date.now() + HALKA_DK * 60_000;
  console.log(
    `Gonderim saatleri (TR): ${SAATLER.map(([s, d]) => `${String(s).padStart(2, '0')}:${String(d).padStart(2, '0')}`).join(', ')}`,
  );
  console.log(`Halka sonu: ${saatYaz(new Date(bitis))}\n`);

  let tur = 0;
  for (;;) {
    const hedef = sonrakiGonderim();
    if (hedef.getTime() > bitis + TASMA_DK * 60_000) {
      console.log(`Siradaki gonderim ${saatYaz(hedef)}; sonraki halkaya birakiliyor.`);
      await uyu(bitis - Date.now());
      break;
    }
    console.log(`Siradaki gonderim ${saatYaz(hedef)} (${Math.round((hedef - Date.now()) / 60000)} dk sonra)`);
    await uyu(hedef - Date.now());
    tur += 1;
    console.log(`--- ${saatYaz(new Date())} gonderimi ---`);
    try {
      await birTur();
    } catch (err) {
      // Tek turun hatasi donguyu bitirmemeli: sayfa gecici olarak
      // yuklenmeyebilir ya da Slack anlik hata dondurebilir.
      console.error('  tur hatasi:', err?.message || err);
    }
  }
  console.log(`\nHalka tamamlandi: ${tur} gonderim.`);
}

const calistir = process.argv.includes('--loop') ? dongu : birTur;

calistir()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('HATA:', err?.message || err);
    process.exit(1);
  });
