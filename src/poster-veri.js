/**
 * Poster sayfasinin mini grafik verisini sunucu tarafindan saglar.
 *
 * NEDEN: Grafikleri sayfa kendisi ceker ve kaynaklari GitHub'in ABD'deki
 * makinelerinden erisilemiyor; 29.10.2026 itibariyla Slack'e giden posterde
 * altidan yalnizca DXY grafigi vardi:
 *   - BTC, ETH, XAU (PAXG), EUR/USD -> api.binance.com 15 dk mumlari. Binance
 *     ABD IP'lerini engelliyor (HTTP 451).
 *   - BRENT, DXY -> Yahoo, tarayicida CORS yuzunden corsproxy.io ve
 *     allorigins vekilleri uzerinden. Vekiller zaman asimina dusuyor. Sitenin
 *     kendi Supabase "brent" fonksiyonu seri dondurmuyor (series=1 ve symbol
 *     parametrelerini yok sayiyor), o yol da bos.
 *   - DXY'nin son yedegi jsDelivr'daki doviz arsivi (2 haftalik); tek calisan buydu.
 *
 * NASIL: Playwright bu istekleri yolda yakalar, veriyi Node'dan (CORS yok)
 * erisilebilen kaynaklardan alir ve sayfaya sayfanin bekledigi bicimde verir.
 * Sitenin koduna dokunulmuyor. Kaynak bulunamazsa istek kendi yoluna devam
 * eder; sayfa eskisi gibi davranir, yalnizca o grafik eksik kalir.
 *
 * ZAMAN SINIRI: sayfa her istegi 8 sn sonra iptal ediyor. Yedekli denemelerin
 * toplami bunun altinda kalmali, yoksa yanit hazir oldugunda sayfa coktan
 * vazgecmis olur. Sureler bu yuzden kisa.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonAl(url, ms) {
  const yanit = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
  return yanit.json();
}

/** Binance sembolu -> Kraken cifti. Dordu de Kraken'de var ve ABD'den erisilebilir. */
const KRAKEN = { BTCUSDT: 'XBTUSD', ETHUSDT: 'ETHUSD', PAXGUSDT: 'PAXGUSD', EURUSDT: 'EURUSD' };

/**
 * Binance /klines yaniti uretir: [acilisMs, acilis, yuksek, dusuk, kapanis, hacim, kapanisMs, ...].
 * Sayfa yalnizca ilk mumun acilisini ve kapanislari kullaniyor.
 */
async function binanceMumlari(sembol, aralik, adet) {
  // 1) Binance'in yalnizca piyasa verisi sunan alan adi: ayni veri, ayni bicim.
  try {
    const veri = await jsonAl(
      `https://data-api.binance.vision/api/v3/klines?symbol=${sembol}&interval=${aralik}&limit=${adet}`,
      3000,
    );
    if (Array.isArray(veri) && veri.length >= 8) return { veri, kaynak: 'binance-vision' };
  } catch {
    /* sonraki kaynak */
  }

  // 2) Kraken OHLC: [zaman(sn), acilis, yuksek, dusuk, kapanis, vwap, hacim, adet].
  const cift = KRAKEN[sembol];
  const dakika = parseInt(aralik, 10);
  if (!cift || !aralik.endsWith('m')) throw new Error(`${sembol}/${aralik} icin yedek kaynak yok`);
  const d = await jsonAl(`https://api.kraken.com/0/public/OHLC?pair=${cift}&interval=${dakika}`, 4000);
  if (d.error?.length) throw new Error(d.error.join(', '));
  const anahtar = Object.keys(d.result || {}).find((k) => k !== 'last');
  const satirlar = (d.result?.[anahtar] || []).slice(-adet);
  if (satirlar.length < 8) throw new Error('kisa seri');
  const veri = satirlar.map(([t, acilis, yuksek, dusuk, kapanis, , hacim]) => [
    t * 1000,
    acilis,
    yuksek,
    dusuk,
    kapanis,
    hacim,
    t * 1000 + dakika * 60_000 - 1,
    '0',
    0,
    '0',
    '0',
    '0',
  ]);
  return { veri, kaynak: 'kraken' };
}

/**
 * Yahoo chart yaniti; vekil olmadan dogrudan. Yahoo art arda isteklerde 429
 * donduruyor; iki sunucu arasinda araliklarla deneniyor. Sayfa ilk vekil
 * reddedilince ikincisini (allorigins) istiyor, o da buradan karsilaniyor:
 * boylece bir sembol icin toplam dort deneme oluyor.
 */
async function yahooGrafik(icAdres) {
  const adres = new URL(icAdres);
  const hatalar = [];
  for (const [i, sunucu] of ['query1', 'query2'].entries()) {
    if (i) await bekle(1200);
    adres.hostname = `${sunucu}.finance.yahoo.com`;
    try {
      const veri = await jsonAl(adres.toString(), 3000);
      if (veri?.chart?.result?.[0]) return veri;
      throw new Error('bos sonuc');
    } catch (err) {
      hatalar.push(`${sunucu}: ${err.message}`);
    }
  }
  throw new Error(hatalar.join(' | '));
}

const CORS = { 'access-control-allow-origin': '*' };

/**
 * Sayfaya grafik verisi yonlendirmelerini kurar. page.goto'dan once cagrilmali.
 * @returns {{ ozet: () => string }} hangi grafigin hangi kaynaktan geldigi (log icin)
 */
export async function grafikVerisiniSagla(page) {
  const kayit = new Map();

  await page.route(/^https:\/\/api\.binance\.com\/api\/v3\/klines\?/, async (route) => {
    const p = new URL(route.request().url()).searchParams;
    const sembol = p.get('symbol');
    try {
      const { veri, kaynak } = await binanceMumlari(sembol, p.get('interval') || '15m', Number(p.get('limit') || 96));
      kayit.set(sembol, kaynak);
      await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(veri) });
    } catch (err) {
      kayit.set(sembol, `YOK (${err.message})`);
      await route.continue();
    }
  });

  await page.route(/^https:\/\/(corsproxy\.io\/\?url=|api\.allorigins\.win\/raw\?url=)/, async (route) => {
    const ic = new URL(route.request().url()).searchParams.get('url') || '';
    let icAdres;
    try {
      icAdres = new URL(ic);
    } catch {
      return route.continue();
    }
    if (!icAdres.hostname.endsWith('finance.yahoo.com')) return route.continue();
    const sembol = decodeURIComponent(icAdres.pathname.split('/').pop());
    try {
      const veri = await yahooGrafik(ic);
      kayit.set(sembol, 'yahoo');
      await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(veri) });
    } catch (err) {
      kayit.set(sembol, `YOK (${err.message})`);
      // Hemen reddet: sayfa sonraki vekile (o da buradan) ya da kendi son
      // yedegine (DXY icin jsDelivr) gecsin; gercek vekili beklemek 8 sn yer.
      await route.abort();
    }
  });

  return { ozet: () => [...kayit].map(([s, k]) => `${s}<-${k}`).join(', ') || 'yonlendirilen istek yok' };
}
