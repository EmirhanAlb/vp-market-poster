/**
 * Piyasa verisi: posterdeki alti enstruman ve altin oylamasi icin en guncel,
 * DOGRU enstrumana ait fiyatlar.
 *
 * NEDEN: 11.11.2026'da kanaldan "fiyatlari nereden aliyorsunuz, ons altin bu
 * seviyeyi en son gece gordu" sorusu geldi. Ayni anda yapilan olcum:
 *   - Sitenin "XAU/USD - Gold (Spot)" karti spot altin degil PAXG token'iydi
 *     (CoinGecko pax-gold): spot 4.044 iken 4.032, yani 12 $ asagida. Yuzde de
 *     token'in son 24 saatteki degisimiydi (-%0,75); spot o gun onceki
 *     kapanisa gore +%0,35'teydi.
 *   - Posterde EUR/USD ve DXY open.er-api.com'dan geliyordu (sayfanin birincil
 *     EUR/USD kaynagi Binance, runner'in bulundugu ABD'den erisilemiyor);
 *     ucretsiz katmani GUNDE BIR KEZ (00:00 UTC) guncelleniyor: 1,1187
 *     gosterilirken gercek 1,1135'ti (52 pip), DXY 102,07 gosterilirken gercek
 *     102,53'tu.
 *   - Oylama (src/poll/price.js) Binance PAXG -> CoinGecko PAXG -> Yahoo GC=F
 *     zincirini her cagrida bastan deniyordu. Ucu de spot degil: PAXG token,
 *     GC=F vadeli kontrat (primi vadeye gore degisir; o gun spotun ~12 $
 *     ustundeydi). Hangisinin okundugu da kaydedilmiyordu.
 *
 * KAYNAKLAR (hepsi anahtarsiz; 11.11.2026'da GitHub runner'indan tek tek
 * yoklandi):
 *   Swissquote public quotes   spot XAU/USD ve FX, ms zaman damgali, canli
 *   CNBC quote servisi         XAU=, EUR=, .DXY canli; @LCO.1 (ICE Brent) 10 dk
 *                              gecikmeli; hepsinde onceki kapanis
 *   CNBC chart servisi         ayni sembollerin ~2 gunluk 1 dk'lik barlari;
 *                              Brent barlarinda kotasyondaki 10 dk'lik borsa
 *                              gecikmesi yok (barlar 1-3 dk geriden gelir)
 *   goldprice.org, gold-api    spot altin yedekleri
 *   Coinbase, Kraken, Bitstamp, Binance veri aynasi, CoinGecko   BTC ve ETH
 * Calismayanlar: api.binance.com (ABD'den 451), Yahoo (runner'dan cogunlukla
 * 429), open.er-api ve jsDelivr doviz arsivi (gunluk).
 *
 * Hicbiri SLA vermiyor. Bu yuzden altin, EUR/USD ve DXY icin birden fazla
 * kaynak okunuyor, en taze gecerli olan seciliyor ve kaynaklar birbiriyle
 * karsilastiriliyor (Brent ve kriptoda yedek var, kiyas yok). Bayatlik,
 * eksiklik ve uyusmazlik sessiz kalmiyor: "sorunlar" listesiyle cagirana
 * donuyor, okuyucuyu ilgilendirenler mesaja not olarak dusuyor.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Piyasa acikken bir kotasyon bundan eskiyse "taze" sayilmaz. */
export const TAZE_MS = 120_000;
/** CNBC'nin 1 dk'lik barlari 1-3 dk geriden geliyor. */
const BAR_TAZE_MS = 240_000;

export const ENSTRUMANLAR = {
  DXY: { ad: 'DXY', ondalik: 2 },
  BTCUSD: { ad: 'BTC/USD', ondalik: 0 },
  ETHUSD: { ad: 'ETH/USD', ondalik: 2 },
  BRENT: { ad: 'BRENT', ondalik: 2 },
  EURUSD: { ad: 'EUR/USD', ondalik: 4 },
  XAUUSD: { ad: 'XAU/USD', ondalik: 2 },
};

/**
 * JSON okur. Yalnizca hizli basarisizliklar (baglanti hatasi, 5xx) bir kez
 * yeniden denenir. Zaman asimi ve 4xx yeniden denenmez: aski bir kaynak ikinci
 * kez de asilir ve o sirada diger enstrumanlarin fiyati eskir.
 */
async function jsonAl(url, { ms = 6000, headers = {}, deneme = 2 } = {}) {
  let sonHata;
  for (let i = 0; i < deneme; i++) {
    if (i) await bekle(350);
    try {
      const yanit = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(ms) });
      if (!yanit.ok) throw Object.assign(new Error(`HTTP ${yanit.status}`), { kalici: yanit.status < 500 });
      return { veri: await yanit.json(), an: Date.now() };
    } catch (err) {
      sonHata = err;
      if (err?.kalici || err?.name === 'TimeoutError' || err?.name === 'AbortError') break;
    }
  }
  throw sonHata;
}

/** "4,046.10", "+0.36%", "-0.2598%" -> sayi; cozulemezse null. */
function sayi(deger) {
  if (deger == null || deger === '') return null;
  const n = Number(String(deger).replace(/[,%+\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const yuzde = (son, onceki) => (son > 0 && onceki > 0 ? ((son - onceki) / onceki) * 100 : null);

// --- KAYNAKLAR ---------------------------------------------------------------

/**
 * Swissquote'un herkese acik kotasyon akisi. Yanit, platform basina bir kayit
 * ve her platformda birkac spread profili iceriyor. En yeni zaman damgali
 * platformun en dar profili aliniyor ve alis-satis ortasi (mid) donuyor:
 * bankalararasi ortaya en yakin deger o.
 */
async function swissquote(taban, karsi) {
  const { veri } = await jsonAl(
    `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${taban}/${karsi}`,
  );
  let enIyi = null;
  for (const platform of Array.isArray(veri) ? veri : []) {
    for (const p of platform.spreadProfilePrices || []) {
      if (!(p.bid > 0) || !(p.ask >= p.bid)) continue;
      const aday = { bid: p.bid, ask: p.ask, zaman: Number(platform.ts) || null, fark: p.ask - p.bid };
      const dahaYeni = enIyi && aday.zaman > enIyi.zaman + 2000;
      const ayniAnDahaDar = enIyi && Math.abs(aday.zaman - enIyi.zaman) <= 2000 && aday.fark < enIyi.fark;
      if (!enIyi || dahaYeni || ayniAnDahaDar) enIyi = aday;
    }
  }
  if (!enIyi) throw new Error('gecerli kotasyon yok');
  return { fiyat: (enIyi.bid + enIyi.ask) / 2, zaman: enIyi.zaman };
}

/** CNBC kotasyonlari: { sembol: { fiyat, zaman, oncekiKapanis, gercekZaman } }. */
async function cnbcKotasyonlar(semboller) {
  const { veri } = await jsonAl(
    'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol' +
      `?symbols=${encodeURIComponent(semboller.join('|'))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`,
  );
  const sonuc = {};
  for (const q of [].concat(veri?.FormattedQuoteResult?.FormattedQuote || [])) {
    const fiyat = sayi(q?.last);
    if (!(fiyat > 0)) continue;
    sonuc[q.symbol] = {
      fiyat,
      zaman: Date.parse(q.last_time) || null,
      oncekiKapanis: sayi(q.previous_day_closing),
      // "false" = borsa verisi 10 dk gecikmeli (ICE Brent boyle).
      gercekZaman: q.realTime === 'true',
    };
  }
  return sonuc;
}

/** CNBC'nin ~2 gunluk 1 dk'lik barlari, eskiden yeniye: [{ t, c }]. */
async function cnbcBarlar(sembol) {
  const { veri } = await jsonAl(
    `https://ts-api.cnbc.com/harmony/app/charts/1D.json?symbol=${encodeURIComponent(sembol)}`,
    { ms: 8000 },
  );
  const barlar = (veri?.barData?.priceBars || [])
    .map((b) => ({ t: Number(b.tradeTimeinMills), c: Number(b.close) }))
    .filter((b) => b.t > 0 && b.c > 0)
    .sort((a, b) => a.t - b.t);
  if (barlar.length < 8) throw new Error('kisa seri');
  return barlar;
}

async function goldprice() {
  const { veri } = await jsonAl('https://data-asg.goldprice.org/dbXRates/USD', {
    headers: { Referer: 'https://goldprice.org/' },
  });
  const satir = veri?.items?.[0];
  if (!(satir?.xauPrice > 0)) throw new Error('fiyat yok');
  // `tsj` kotasyonun ani; `ts` yanitin uretildigi an ve fiyat degismese de ilerleyebiliyor.
  return { fiyat: Number(satir.xauPrice), zaman: Number(veri.tsj) || Number(veri.ts) || null };
}

async function goldApi() {
  const { veri } = await jsonAl('https://api.gold-api.com/price/XAU');
  if (!(veri?.price > 0)) throw new Error('fiyat yok');
  return { fiyat: Number(veri.price), zaman: Date.parse(veri.updatedAt) || null };
}

// Kripto borsalari. Hepsi { fiyat, zaman, degisim (24 saat), seri (15 dk x 96) } doner.

const COINBASE = { BTCUSD: 'BTC-USD', ETHUSD: 'ETH-USD' };
/**
 * Coinbase: fiyat ve islem zamani ticker'dan. 24 saatlik degisimin referansi,
 * 24 saat onceki ani iceren 1 dk'lik mumun kapanisi. /stats icindeki `open`
 * KULLANILMAZ: o, 23 saat onceki saatlik mumun acilisi ve saat baslarinda
 * basamak atliyor (11.11.2026 13:24 UTC'de BTC icin +%0,30 veriyordu, gercek
 * 24 saatlik degisim -%0,49'du); posterlerin cogu tam saat basinda cikiyor.
 */
async function coinbase(anahtar) {
  const kok = `https://api.exchange.coinbase.com/products/${COINBASE[anahtar]}`;
  const simdi = Date.now();
  const dun = simdi - 86_400_000;
  const iso = (ms) => encodeURIComponent(new Date(ms).toISOString());
  const [t, r, m] = await Promise.all([
    jsonAl(`${kok}/ticker`),
    jsonAl(`${kok}/candles?granularity=60&start=${iso(dun - 180_000)}&end=${iso(dun + 60_000)}`).catch(() => null),
    // Pencere acikca verilir: penceresiz istek 5 dk onbellekten gelebiliyor.
    jsonAl(`${kok}/candles?granularity=900&start=${iso(dun)}&end=${iso(simdi)}`).catch(() => null),
  ]);
  const fiyat = Number(t.veri.price);
  // Mum satiri: [zaman (sn), dusuk, yuksek, acilis, kapanis, hacim]; sira garanti degil.
  const satirlar = (yanit) =>
    (Array.isArray(yanit?.veri) ? yanit.veri : [])
      .filter((s) => Array.isArray(s) && Number(s[0]) > 0 && Number(s[4]) > 0)
      .sort((a, b) => a[0] - b[0]);
  const dunku = satirlar(r)
    .filter((s) => Number(s[0]) * 1000 <= dun)
    .at(-1);
  const mumlar = satirlar(m);
  // 1 dk'lik mum alinamadiysa en yakin referans: 24 saatlik pencerenin ilk 15 dk'lik mumunun acilisi.
  const referans = dunku ? Number(dunku[4]) : mumlar.length >= 90 ? Number(mumlar[0][3]) : null;
  return {
    fiyat,
    zaman: Date.parse(t.veri.time) || t.an,
    degisim: yuzde(fiyat, referans),
    seri: mumlar.length >= 8 ? mumlar.slice(-96).map((s) => Number(s[4])) : null,
  };
}

const KRAKEN = { BTCUSD: 'XBTUSD', ETHUSD: 'ETHUSD', EURUSD: 'EURUSD', PAXG: 'PAXGUSD' };
/** Kraken 15 dk mumlari, eskiden yeniye; son satir henuz kapanmamis mum. */
async function krakenMumlar(cift, ms = 6000) {
  const { veri } = await jsonAl(`https://api.kraken.com/0/public/OHLC?pair=${cift}&interval=15`, { ms });
  if (veri.error?.length) throw new Error(veri.error.join(', '));
  const anahtar = Object.keys(veri.result || {}).find((k) => k !== 'last');
  const kapanislar = (veri.result?.[anahtar] || []).map((r) => Number(r[4])).filter((c) => c > 0);
  if (kapanislar.length < 8) throw new Error('kisa seri');
  return kapanislar;
}
async function kraken(anahtar) {
  const cift = KRAKEN[anahtar];
  const [t, mumlar] = await Promise.all([
    jsonAl(`https://api.kraken.com/0/public/Ticker?pair=${cift}`),
    krakenMumlar(cift).catch(() => null),
  ]);
  if (t.veri.error?.length) throw new Error(t.veri.error.join(', '));
  const k = Object.values(t.veri.result || {})[0];
  const alis = Number(k?.b?.[0]);
  const satis = Number(k?.a?.[0]);
  // EUR/USD'de son islem dakikalarca eski olabiliyor; alis-satis ortasi guncel.
  const fiyat = anahtar === 'EURUSD' && alis > 0 && satis >= alis ? (alis + satis) / 2 : Number(k?.c?.[0]);
  // Ticker zaman damgasi vermiyor; istek ani kullaniliyor.
  return {
    fiyat,
    zaman: t.an,
    degisim: mumlar && mumlar.length > 96 ? yuzde(fiyat, mumlar.at(-97)) : null,
    seri: mumlar ? mumlar.slice(-96) : null,
  };
}

const BITSTAMP = { BTCUSD: 'btcusd', ETHUSD: 'ethusd' };
async function bitstamp(anahtar) {
  const cift = BITSTAMP[anahtar];
  const [t, m] = await Promise.all([
    jsonAl(`https://www.bitstamp.net/api/v2/ticker/${cift}/`),
    jsonAl(`https://www.bitstamp.net/api/v2/ohlc/${cift}/?step=900&limit=96`).catch(() => null),
  ]);
  const seri = m?.veri?.data?.ohlc?.map((r) => Number(r.close)).filter((c) => c > 0);
  return {
    fiyat: Number(t.veri.last),
    zaman: Number(t.veri.timestamp) * 1000 || t.an,
    degisim: sayi(t.veri.percent_change_24),
    seri: seri?.length >= 8 ? seri : null,
  };
}

const BINANCE = { BTCUSD: 'BTCUSDT', ETHUSD: 'ETHUSDT', EURUSD: 'EURUSDT', PAXG: 'PAXGUSDT' };
const BINANCE_AYNA = 'https://data-api.binance.vision/api/v3';
async function binanceMumlar(sembol, ms = 6000) {
  const { veri } = await jsonAl(`${BINANCE_AYNA}/klines?symbol=${sembol}&interval=15m&limit=96`, { ms });
  const kapanislar = (Array.isArray(veri) ? veri : []).map((r) => Number(r[4])).filter((c) => c > 0);
  if (kapanislar.length < 8) throw new Error('kisa seri');
  return kapanislar;
}
/** Binance'in yalnizca piyasa verisi sunan alan adi; api.binance.com'un aksine ABD'den aciliyor. */
async function binanceAyna(anahtar) {
  const sembol = BINANCE[anahtar];
  const [t, seri] = await Promise.all([
    jsonAl(`${BINANCE_AYNA}/ticker/24hr?symbol=${sembol}`),
    binanceMumlar(sembol).catch(() => null),
  ]);
  return {
    fiyat: Number(t.veri.lastPrice),
    zaman: Number(t.veri.closeTime) || t.an,
    degisim: sayi(t.veri.priceChangePercent),
    seri,
  };
}

const COINGECKO = { BTCUSD: 'bitcoin', ETHUSD: 'ethereum' };
async function coingecko(anahtar) {
  const id = COINGECKO[anahtar];
  const { veri } = await jsonAl(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
  );
  const v = veri?.[id];
  return {
    fiyat: Number(v?.usd),
    zaman: Number(v?.last_updated_at) * 1000 || null,
    degisim: sayi(v?.usd_24h_change),
    seri: null,
  };
}

// --- SECIM -------------------------------------------------------------------

/**
 * Oncelik sirasiyla verilen adaylardan yayinlanacak olani secer.
 *  - Taze (yasi `tazeMs`'den kucuk) adaylar varsa oncelik sirasindaki ilki.
 *  - Taze adaylarin medyanindan `sapma` oranindan fazla ayrisan aday elenir.
 *    Bozuk kaynagi ayirt etmek icin en az uc taze aday gerekir. Iki aday
 *    birbirini tutmuyorsa `hakem` degere (verildiyse) yakin olan secilir;
 *    o da cozmuyorsa hangisinin yanlis oldugu bilinemez: oncelikli olan
 *    secilir ve sonuc `uyusmuyor` diye isaretlenir. Tek taze adayda kiyas yok.
 *  - Kiyas adaylarin yasina bakmaz: cok hizli bir harekette (1 dk icinde
 *    %0,25) en canli kaynak "sapan" diye elenip ~1 dk eski fiyat secilebilir.
 *    Bilinen ve kabul edilen bir sinir; elenen kaynak loga yazilir.
 *  - Hic taze aday yoksa zaman damgasi en yeni olan (piyasa kapali ya da tum
 *    kaynaklar bayat); cagiran bunu `taze: false` ile gorur.
 *
 * Donen kayitta `tutarlilar`: taze olup medyanla uyusan kaynaklarin adlari
 * (hicbiri uyusmuyorsa yalnizca secilen; taze aday yoksa bos).
 * @param {Array<{kaynak: string, fiyat: number, zaman: number|null}|null>} adaylar
 */
export function adaySec(adaylar, an, { tazeMs = TAZE_MS, sapma = 0.0025, hakem = null } = {}) {
  const gecerli = adaylar.filter((a) => a && a.fiyat > 0);
  if (gecerli.length === 0) return null;
  const notlar = [];
  const tazeler = gecerli.filter((a) => a.zaman && an - a.zaman <= tazeMs);
  let secilen;
  let tutarli = [];
  if (tazeler.length) {
    if (tazeler.length === 2) {
      // Iki adayin medyani ortalaridir; ona gore kiyas, payi ikiye katlardi.
      const [a, b] = tazeler;
      tutarli = Math.abs(a.fiyat - b.fiyat) / Math.min(a.fiyat, b.fiyat) <= sapma ? tazeler : [];
    } else {
      const sirali = tazeler.map((a) => a.fiyat).sort((x, y) => x - y);
      const orta = Math.floor(sirali.length / 2);
      const medyan = sirali.length % 2 ? sirali[orta] : (sirali[orta - 1] + sirali[orta]) / 2;
      tutarli = tazeler.filter((a) => Math.abs(a.fiyat - medyan) / medyan <= sapma);
    }
    if (tutarli.length === 0 && hakem > 0) {
      // Adaylar birbirini tutmuyor: ucuncu bir referansa (`hakem`, ornegin son
      // 1 dk'lik bar) en yakin olan, ona yeterince yakinsa secilir.
      const yakin = [...tazeler].sort((x, y) => Math.abs(x.fiyat - hakem) - Math.abs(y.fiyat - hakem))[0];
      if (Math.abs(yakin.fiyat - hakem) / hakem <= 3 * sapma) {
        tutarli = [yakin];
        notlar.push(`kaynaklar uyusmadi; referansa (${Number(hakem.toPrecision(7))}) yakin olan secildi: ${yakin.kaynak}`);
      }
    }
    for (const a of tazeler) {
      if (!tutarli.includes(a)) notlar.push(`${a.kaynak} (${Number(a.fiyat.toPrecision(7))}) diger kaynaklardan sapiyor`);
    }
    secilen = (tutarli.length ? tutarli : tazeler)[0];
  } else {
    secilen = [...gecerli].sort((x, y) => (y.zaman || 0) - (x.zaman || 0))[0];
  }
  return {
    ...secilen,
    taze: tazeler.length > 0,
    yasSn: secilen.zaman ? Math.max(0, Math.round((an - secilen.zaman) / 1000)) : null,
    notlar,
    tutarlilar: (tutarli.length ? tutarli : tazeler.length ? [secilen] : []).map((a) => a.kaynak),
    uyusmuyor: tazeler.length > 1 && tutarli.length === 0,
  };
}

/** ICE formulu: alti kurdan Dolar Endeksi. */
export function dxyHesapla({ EURUSD, USDJPY, GBPUSD, USDCAD, USDSEK, USDCHF }) {
  return (
    50.14348112 *
    EURUSD ** -0.576 *
    USDJPY ** 0.136 *
    GBPUSD ** -0.119 *
    USDCAD ** 0.091 *
    USDSEK ** 0.042 *
    USDCHF ** 0.036
  );
}

const KOVA_MS = 900_000;

/** 1 dk'lik barlari 15 dk'lik kovalara indirir: kova numarasi -> o kovadaki son kapanis. */
function kovala(barlar) {
  const kovalar = new Map();
  for (const b of barlar || []) kovalar.set(Math.floor(b.t / KOVA_MS), b.c);
  return kovalar;
}

/**
 * Barlardan (ya da hazir kovalardan) grafik serisi: `baslangic` anindan sonraki
 * 15 dk'lik kapanislar. O pencerede 8 noktadan az varsa (kapanistan hemen
 * sonra, hafta sonu) son `adet` dolu kova kullanilir. Sayfa noktalari esit
 * aralikla cizdigi icin bos kovalar (piyasa arasi) grafikte yer tutmaz.
 */
export function seriyeIndir(barlar, { baslangic = null, adet = 96 } = {}) {
  const sirali = [...(barlar instanceof Map ? barlar : kovala(barlar)).entries()].sort((a, b) => a[0] - b[0]);
  if (baslangic != null) {
    const pencere = sirali.filter(([kova]) => (kova + 1) * KOVA_MS > baslangic);
    if (pencere.length >= 8) return pencere.slice(-adet).map(([, c]) => c);
  }
  return sirali.slice(-adet).map(([, c]) => c);
}

/** `seriyeIndir` ile gunluk seri; `gunluk`: kapanistan bu yana penceresi kullanilabildi mi (grafik etiketi icin). */
function gunlukSeri(barlar, sinir) {
  const kovalar = barlar instanceof Map ? barlar : kovala(barlar);
  const penceredeki = [...kovalar.keys()].filter((kova) => (kova + 1) * KOVA_MS > sinir).length;
  return { seri: seriyeIndir(kovalar, { baslangic: sinir }), gunluk: penceredeki >= 8 };
}

/**
 * En son New York 17:00'sinin UTC ani (ms): doviz ve altinda islem gununun
 * bittigi, "onceki kapanis"in alindigi an. Gunluk degisim ve "1D" grafikleri
 * bu andan baslar; islem platformlarinin gunluk mumu da ayni yerde kapanir.
 */
export function sonNyKapanisi(an = Date.now()) {
  return sonDuvarSaati(an, 'America/New_York', 17);
}

/** `tz` saat diliminde en son `saat:dakika` duvar saatinin UTC ani (ms). */
function sonDuvarSaati(an, tz, saat, dakika = 0) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(an))
      .map((x) => [x.type, x.value]),
  );
  // Yerel duvar saati UTC'ymis gibi okunur; gercek anla farki o anki UTC sapmasidir.
  const duvar = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  const sapma = duvar - Math.floor(an / 1000) * 1000;
  let hedef = Date.UTC(+p.year, +p.month - 1, +p.day, saat, dakika, 0);
  if (hedef > duvar) hedef -= 86_400_000;
  return hedef - sapma;
}

/**
 * Barlardan onceki kapanis: `sinir`dan hemen onceki barin kapanisi. O bar
 * sinirdan 30 dk'dan eskiyse (sinir aninda piyasa kapaliydi: hafta sonu,
 * tatil) kapanis sayilmaz.
 */
function kapanisBarlardan(barlar, sinir) {
  let son = null;
  for (const b of barlar || []) {
    if (b.t >= sinir) break;
    son = b;
  }
  return son && sinir - son.t <= 30 * 60_000 ? son.c : null;
}

/**
 * Spot altin kovalari. CNBC'nin XAU= barlarinda bosluklar oluyor (her gun 06:00
 * UTC civari 15-35 dk; 2 ve 9 Kasim 2026 pazartesi sabahlari Asya seansinda ~7
 * saat). Eksik kovalar COMEX vadeli (@GC.1) barlarindan, iki serinin ortak
 * kovalardaki medyan farki kadar kaydirilarak doldurulur; vadeli-spot farki
 * gun icinde neredeyse sabit oldugu icin sekil bozulmaz. Spot barlari hic
 * yoksa vadeli seri canli spot duzeyine kaydirilir.
 * @returns {{ kovalar: Map<number, number>, dolgu: number }} `dolgu`: vadeliden gelen kova sayisi
 */
function altinKovalari(spotBarlar, vadeliBarlar, spotFiyat) {
  const spot = kovala(spotBarlar);
  const vadeli = kovala(vadeliBarlar);
  if (vadeli.size === 0) return { kovalar: spot, dolgu: 0 };
  const farklar = [...spot.entries()]
    .filter(([kova]) => vadeli.has(kova))
    .map(([kova, c]) => c - vadeli.get(kova))
    .sort((a, b) => a - b);
  const sonVadeli = [...vadeli.entries()].sort((a, b) => a[0] - b[0]).at(-1)[1];
  const fark = farklar.length >= 4 ? farklar[Math.floor(farklar.length / 2)] : spotFiyat - sonVadeli;
  const kovalar = new Map(spot);
  for (const [kova, c] of vadeli) if (!kovalar.has(kova)) kovalar.set(kova, c + fark);
  return { kovalar, dolgu: kovalar.size - spot.size };
}

/** Baska bir enstrumanin serisini (ornegin PAXG) hedef fiyat duzeyine tasir; yalnizca sekil kalir. */
function seviyeyeTasi(seri, hedef) {
  const son = seri?.at(-1);
  if (!(son > 0) || !(hedef > 0)) return null;
  const carpan = hedef / son;
  return seri.map((v) => v * carpan);
}

/**
 * Doviz, altin ve petrol piyasalari kapali olabilir mi (New York saatiyle):
 * cuma 17:00'den pazar 18:00'e kadar hafta sonu, her gun 17:00-20:00 arasi
 * gunluk ara (altin 1 saat, DXY ve Brent daha uzun). Bu araliklarda eski
 * kotasyon ariza degil; tatil gunleri bilincli olarak hesaba katilmiyor.
 */
export function piyasaKapaliOlabilir(an = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hour12: false })
      .formatToParts(an)
      .map((x) => [x.type, x.value]),
  );
  const saat = Number(p.hour) % 24;
  if (p.weekday === 'Sat') return true;
  if (p.weekday === 'Sun') return saat < 18;
  if (p.weekday === 'Fri' && saat >= 17) return true;
  return saat >= 17 && saat < 20;
}

/** Bir sozu "basari ya da hata" kaydina cevirir; Promise.all hic reddetmesin. */
const dene = (soz) =>
  soz.then(
    (v) => ({ v }),
    (err) => ({ hata: err?.message || String(err) }),
  );

// --- SPOT ALTIN (oylama da kullaniyor) ----------------------------------------

/** Spot altin kaynaklari, oncelik sirasiyla. */
const ALTIN_SIRASI = ['swissquote', 'cnbc', 'goldprice', 'gold-api'];

/**
 * Spot XAU/USD'yi dort ayri kaynaktan okur.
 * @returns {Promise<{fiyat: number, kaynak: string, zaman: number|null, yasSn: number|null, taze: boolean,
 *   uyusmuyor: boolean, adaylar: Record<string, number>, yaslar: Record<string, number|null>,
 *   notlar: string[], hatalar: string[], oncekiKapanis: number|null}>}
 *   `adaylar`: taze olup digerleriyle uyusan kaynaklarin fiyati (kaynak -> fiyat).
 *   `yaslar`: yanit veren her kaynagin verisinin yasi (sn).
 */
export async function spotAltin({ cnbcSozu } = {}) {
  const [sq, cq, gp, ga] = await Promise.all([
    dene(swissquote('XAU', 'USD')),
    // Poster goruntusu CNBC'yi zaten tek istekte okuyor; ayni yanit paylasilir.
    cnbcSozu || dene(cnbcKotasyonlar(['XAU='])),
    dene(goldprice()),
    dene(goldApi()),
  ]);
  const an = Date.now();
  const ham = { swissquote: sq.v, cnbc: cq.v?.['XAU='], goldprice: gp.v, 'gold-api': ga.v };
  const hatalar = [
    ['swissquote', sq],
    ['cnbc', cq],
    ['goldprice', gp],
    ['gold-api', ga],
  ]
    .filter(([, r]) => r.hata)
    .map(([ad, r]) => `${ad}: ${r.hata}`);

  const adaylar = ALTIN_SIRASI.filter((k) => ham[k]?.fiyat > 0).map((k) => ({
    kaynak: k,
    fiyat: ham[k].fiyat,
    zaman: ham[k].zaman,
  }));
  const secilen = adaySec(adaylar, an, { sapma: 0.0025 });
  if (!secilen) throw new Error(`Spot altin fiyati alinamadi (${hatalar.join(' | ')})`);
  return {
    ...secilen,
    // Oylama acilis ve kapanisi ayni kaynaktan eslestirirken bunlara bakiyor.
    // Yalnizca taze VE medyanla uyusan adaylar: sapan diye elenen bir kaynak
    // eslestirmeye girip yanlis sonuc ilan ettiremesin.
    adaylar: Object.fromEntries(
      adaylar.filter((a) => secilen.tutarlilar.includes(a.kaynak)).map((a) => [a.kaynak, a.fiyat]),
    ),
    yaslar: Object.fromEntries(
      adaylar.map((a) => [a.kaynak, a.zaman ? Math.max(0, Math.round((an - a.zaman) / 1000)) : null]),
    ),
    hatalar,
    oncekiKapanis: ham.cnbc?.oncekiKapanis ?? null,
  };
}

// --- POSTER GORUNTUSU ----------------------------------------------------------

const BACAKLAR = [
  ['EURUSD', 'EUR', 'USD'],
  ['USDJPY', 'USD', 'JPY'],
  ['GBPUSD', 'GBP', 'USD'],
  ['USDCAD', 'USD', 'CAD'],
  ['USDSEK', 'USD', 'SEK'],
  ['USDCHF', 'USD', 'CHF'],
];

const KRIPTO_SIRASI = [
  ['coinbase', coinbase],
  ['kraken', kraken],
  ['bitstamp', bitstamp],
  ['binance', binanceAyna],
  ['coingecko', coingecko],
];

/**
 * BTC ya da ETH: once ilk borsa (Coinbase). Yanit vermezse ya da son islemi
 * bayatsa (borsa durmus ama API'si yanit veriyor olabilir) digerleri AYNI ANDA
 * sorulur ve oncelik sirasindaki ilk taze olan secilir; hicbiri taze degilse
 * en yenisi. Sirayla sormak, aski kaynaklarda dakikaya varan gecikme demekti.
 */
async function kripto(anahtar) {
  const hatalar = [];
  const oku = async ([ad, getir]) => {
    try {
      const v = await getir(anahtar);
      if (!(v.fiyat > 0)) throw new Error('gecersiz deger');
      return { ...v, kaynak: ad };
    } catch (err) {
      hatalar.push(`${ad}: ${err?.message || err}`);
      return null;
    }
  };
  const taze = (v) => Boolean(v?.zaman) && Date.now() - v.zaman <= TAZE_MS;
  const ilk = await oku(KRIPTO_SIRASI[0]);
  if (taze(ilk)) return { ...ilk, hatalar };
  if (ilk) hatalar.push(`${ilk.kaynak}: son islem bayat`);
  const digerleri = await Promise.all(KRIPTO_SIRASI.slice(1).map(oku));
  const yanitlar = [ilk, ...digerleri].filter(Boolean);
  const secilen = yanitlar.find(taze) || [...yanitlar].sort((a, b) => (b.zaman || 0) - (a.zaman || 0))[0];
  return secilen ? { ...secilen, hatalar } : { hatalar };
}

/** Sureyi okunur yazar: "45 sn", "12 dk", "16 saat", "3 gün". */
export const sureYaz = (sn) =>
  sn >= 172_800
    ? `${Math.round(sn / 86_400)} gün`
    : sn >= 5400
      ? `${Math.round(sn / 3600)} saat`
      : sn >= 90
        ? `${Math.round(sn / 60)} dk`
        : `${sn} sn`;

/** Enstruman adlari, posterdeki sirayla: "DXY, BRENT, XAU/USD". */
const adlar = (anahtarlar) =>
  Object.keys(ENSTRUMANLAR)
    .filter((a) => anahtarlar.includes(a))
    .map((a) => ENSTRUMANLAR[a].ad)
    .join(', ');

// Okuyucuya gorunen notlar (Slack/Telegram mesajina aynen yazilir).
// Resmi tatiller hesaba katilmadigi icin doviz/emtiada saatlerce eski veri
// "kapali olabilir" diye belirtilir; kripto hic kapanmaz.
const bayatNotu = (anahtarlar, yasSn, kapanabilir = true) =>
  `${adlar(anahtarlar)} verisi ${yasSn == null ? 'güncel olmayabilir' : `${sureYaz(yasSn)} öncesine ait`}` +
  (kapanabilir && yasSn >= 2700 ? ' (piyasa kapalı olabilir)' : '');
const veriYokNotu = (anahtar) => `${ENSTRUMANLAR[anahtar].ad} için canlı veri alınamadı`;

/**
 * Posterdeki alti enstrumanin o anki goruntusu.
 *
 * Her enstruman: { fiyat, degisim (yuzde | null), oncekiKapanis, seri (| null),
 * kaynak, zaman, yasSn, taze, seriKaynak, seriEtiketi }. Verisi hic alinamayan
 * enstruman `enstrumanlar` icinde yer almaz.
 *
 * Degisim yuzdesi: altin, EUR/USD, DXY ve Brent'te onceki kapanisa gore gunluk
 * degisim; BTC ve ETH'de 24 saatlik degisim. Kapanis CNBC'den gelir: spot altin
 * ve EUR/USD icin New York 17:00 (islem platformlarinin gunluk mumuyla ayni
 * kural), DXY ve Brent icin ICE uzlasi fiyati (borsa ve haber ekranlarinin
 * kurali; son islem fiyatindan olcen platformlarda Brent yuzdesi farkli
 * gorunebilir). Bu dort enstrumanin grafigi de son New York 17:00'sinden
 * baslar: cizginin yonu ile yuzdenin isareti ayni seyi anlatsin. (11.11.2026'da
 * spot altin gunluk +%0,30, son 24 saatte -%0,58'di; iki kural ters isaret
 * verebiliyor.)
 *
 * `sorunlar`: { enstruman, mesaj, not }. `mesaj` log icindir. `not` doluysa
 * okuyucunun bilmesi gereken bir eksiklik var demektir ve Slack/Telegram
 * mesajina aynen dusulur (kullaniciya gorunen metin, Turkce karakterli).
 */
export async function piyasaGoruntusu() {
  const cnbcSozu = dene(cnbcKotasyonlar(['XAU=', 'EUR=', '.DXY', '@LCO.1']));
  const [cq, altin, sqBacak, barXau, barGc, barEur, barDxy, barBrent, btc, eth] = await Promise.all([
    cnbcSozu,
    dene(spotAltin({ cnbcSozu })),
    Promise.all(BACAKLAR.map(([, a, b]) => dene(swissquote(a, b)))),
    dene(cnbcBarlar('XAU=')),
    dene(cnbcBarlar('@GC.1')),
    dene(cnbcBarlar('EUR=')),
    dene(cnbcBarlar('.DXY')),
    dene(cnbcBarlar('@LCO.1')),
    kripto('BTCUSD'),
    kripto('ETHUSD'),
  ]);
  const an = Date.now();
  const kapali = piyasaKapaliOlabilir(new Date(an));
  const sinir = sonNyKapanisi(an);
  const cnbc = cq.v || {};
  const enstrumanlar = {};
  const sorunlar = [];
  const sorun = (anahtar, mesaj, not = null) => sorunlar.push({ enstruman: ENSTRUMANLAR[anahtar].ad, mesaj, not });
  if (cq.hata) sorunlar.push({ enstruman: 'CNBC', mesaj: `kotasyon alinamadi (${cq.hata})`, not: null });
  // Doviz/emtiada bayat kalanlar ve gunluk degisimi hesaplanamayanlar; sonda
  // ayni durumdakiler tek okuyucu notunda toplanir.
  const bayatlar = [];
  const degisimsizler = [];
  const seridenler = [];
  // Brent'in "onceki kapanis"i ICE uzlasi fiyati (Londra 19:30'a kadarki son dakikalar).
  const brentKapanisAni = sonDuvarSaati(an, 'Europe/London', 19, 30);

  /** Secilen kotasyonu enstruman kaydina cevirir. */
  const kaydet = (anahtar, s, { oncekiKapanis = null, seri = null, gunluk = false, seriKaynak = null } = {}) => {
    for (const n of s.notlar || []) sorun(anahtar, n);
    if (s.uyusmuyor) {
      sorun(
        anahtar,
        `taze kaynaklar birbirini tutmuyor; oncelikli kaynak (${s.kaynak}) yayimlandi`,
        `${ENSTRUMANLAR[anahtar].ad} kaynakları birbirini tutmuyor, değer teyit edilemedi`,
      );
    }
    if (!s.taze) bayatlar.push({ anahtar, yasSn: s.yasSn, kaynak: s.kaynak });
    const seriVar = seri?.length >= 8;
    let degisim = yuzde(s.fiyat, oncekiKapanis);
    if (degisim == null && seriVar) {
      // Onceki kapanis bilinmiyorsa (CNBC kotasyonu da kapanis oncesi barlar da
      // yoksa) serinin ilk degerine gore degisim kullanilir. Seri burada hep
      // enstrumanin kendi serisidir (token sekli bu durumda hic verilmez, bkz.
      // XAU/USD). Sayfa degisimsiz kotasyonda yuzdeyi seriden zaten kendisi
      // hesapliyor; ayni sayi loga ve dogrulamaya da girsin. Yuzdenin anlami
      // degistigi icin okuyucuya not dusulur.
      degisim = yuzde(s.fiyat, seri[0]);
      seridenler.push(anahtar);
    }
    if (degisim == null) degisimsizler.push(anahtar);
    enstrumanlar[anahtar] = {
      fiyat: s.fiyat,
      degisim,
      oncekiKapanis,
      seri: seriVar ? seri : null,
      kaynak: s.kaynak,
      zaman: s.zaman,
      yasSn: s.yasSn,
      taze: s.taze,
      seriKaynak: seriVar ? seriKaynak : null,
      // Grafigin kapsadigi sure: kapanistan bu yana ("1D") ya da son 24 islem saati ("24H").
      seriEtiketi: seriVar ? (gunluk ? '1D' : '24H') : null,
    };
  };
  /**
   * Onceki kapanis: CNBC kotasyonundaki deger; o yoksa barlardan, kapanis
   * anindan (`kapanisAni`) hemen onceki barin kapanisi. Fiyattan %15'ten fazla
   * uzaksa bozuk veri sayilir ve kullanilmaz.
   */
  const kapanis = (sembol, fiyat, barlar = null, kapanisAni = sinir) => {
    for (const k of [cnbc[sembol]?.oncekiKapanis, kapanisBarlardan(barlar, kapanisAni)]) {
      if (k > 0 && Math.abs(fiyat - k) / k < 0.15) return k;
    }
    return null;
  };
  /** Son 1 dk'lik barin kapanisi, bar `azamiYasMs`'den eski degilse; kaynaklar uyusmadiginda hakem. */
  const sonBarFiyati = (barlar, azamiYasMs) => {
    const son = barlar?.at(-1);
    return son && an - son.t <= azamiYasMs ? son.c : null;
  };

  // XAU/USD ------------------------------------------------------------------
  if (altin.v) {
    // Tazelik goruntunun kendi anina gore yeniden olculur: spotAltin kendi
    // okumasini bitirdiginde diger kaynaklar hala bekleniyor olabilir.
    const yasSn = altin.v.zaman ? Math.max(0, Math.round((an - altin.v.zaman) / 1000)) : null;
    const s = { ...altin.v, yasSn, taze: altin.v.taze && yasSn != null && yasSn * 1000 <= TAZE_MS };
    const { kovalar, dolgu } = altinKovalari(barXau.v, barGc.v, s.fiyat);
    const oncekiKapanis = kapanis('XAU=', s.fiyat, barXau.v);
    let { seri, gunluk } = kovalar.size ? gunlukSeri(kovalar, sinir) : { seri: null, gunluk: false };
    let seriKaynak = barXau.v ? (dolgu ? `cnbc, ${dolgu} bos kova vadeliden` : 'cnbc') : 'cnbc vadeli (spot duzeyinde)';
    if (!(seri?.length >= 8)) {
      // Ne spot ne vadeli gecmis var. PAXG mumlarinin SEKLI spot duzeyine
      // tasinarak yalnizca grafik icin kullanilir; yuzde asla token'dan
      // turetilmez. Onceki kapanis da bilinmiyorsa grafik hic verilmez: sayfa
      // degisimsiz kotasyonda yuzdeyi seriden hesapliyor, karta "Gold (Spot)"
      // adi altinda token'in 24 saatlik degisimi yazilirdi.
      seri = null;
      gunluk = false;
      seriKaynak = null;
      if (oncekiKapanis) {
        // Yalnizca grafik icin: kisa zaman asimi, iki kaynak ayni anda.
        const [bn, kr] = await Promise.all([dene(binanceMumlar(BINANCE.PAXG, 4000)), dene(krakenMumlar(KRAKEN.PAXG, 4000))]);
        const paxg = bn.v ? bn : kr;
        seri = paxg.v ? seviyeyeTasi(paxg.v.slice(-96), s.fiyat) : null;
        seriKaynak = 'paxg (duzeyi spota tasinmis)';
      }
      sorun(
        'XAUUSD',
        `altin grafik serisi CNBC'den alinamadi (${barXau.hata}); ${seri ? 'PAXG sekli kullanildi' : 'grafik yok'}`,
      );
    }
    kaydet('XAUUSD', s, { oncekiKapanis, seri, gunluk, seriKaynak });
    if (s.hatalar.length) sorun('XAUUSD', `yanit vermeyen altin kaynaklari: ${s.hatalar.join(' | ')}`);
  } else {
    sorun('XAUUSD', `hicbir spot kaynagi yanit vermedi: ${altin.hata}`, veriYokNotu('XAUUSD'));
  }

  // EUR/USD --------------------------------------------------------------------
  const bacak = Object.fromEntries(BACAKLAR.map(([ad], i) => [ad, sqBacak[i]]));
  {
    const adaylar = [
      bacak.EURUSD.v && { kaynak: 'swissquote', ...bacak.EURUSD.v },
      cnbc['EUR='] && { kaynak: 'cnbc', fiyat: cnbc['EUR='].fiyat, zaman: cnbc['EUR='].zaman },
    ];
    // Iki kaynak birbirini tutmazsa hakem: CNBC'nin son 1 dk'lik EUR= bari.
    const secenek = { sapma: 0.001, hakem: sonBarFiyati(barEur.v, 5 * 60_000) };
    let s = adaySec(adaylar, an, secenek);
    let krakenEur = null;
    // Kraken'de EUR/USD hafta sonu da islem goruyor; doviz piyasasi kapaliyken o
    // fiyat bankalararasi kapanisin yerine gecmemeli. Yalnizca piyasa acikken
    // okunur: iki kaynak da bayatsa yedek, birbirini tutmuyorsa hakem olarak
    // (uc adayla medyan bozuk olani ayirt edebilir).
    if (!kapali && (!s || !s.taze || s.uyusmuyor)) {
      krakenEur = (await dene(kraken('EURUSD'))).v || null;
      if (krakenEur?.fiyat > 0) {
        adaylar.push({ kaynak: 'kraken', fiyat: krakenEur.fiyat, zaman: krakenEur.zaman });
        s = adaySec(adaylar, an, secenek);
      }
    }
    if (s) {
      let { seri, gunluk } = barEur.v ? gunlukSeri(barEur.v, sinir) : { seri: null, gunluk: false };
      let seriKaynak = 'cnbc';
      if (!(seri?.length >= 8)) {
        // Kapali piyasada Kraken'in hafta sonu hareketi EUR/USD grafigi diye cizilmez.
        const yedek = kapali ? null : krakenEur?.seri || (await dene(krakenMumlar(KRAKEN.EURUSD, 4000))).v?.slice(-96);
        seri = yedek ? seviyeyeTasi(yedek, s.fiyat) : null;
        gunluk = false;
        seriKaynak = 'kraken';
      }
      kaydet('EURUSD', s, { oncekiKapanis: kapanis('EUR=', s.fiyat, barEur.v), seri, gunluk, seriKaynak });
    } else {
      sorun('EURUSD', `hicbir kaynak yanit vermedi (swissquote: ${bacak.EURUSD.hata})`, veriYokNotu('EURUSD'));
    }
  }

  // DXY ------------------------------------------------------------------------
  {
    const eksik = BACAKLAR.filter(([ad]) => !bacak[ad].v).map(([ad]) => ad);
    const adaylar = [];
    let bacaklar = null;
    if (eksik.length === 0) {
      bacaklar = Object.fromEntries(BACAKLAR.map(([ad]) => [ad, bacak[ad].v.fiyat]));
      // Endeks en eski bacagi kadar guncel.
      adaylar.push({
        kaynak: 'swissquote (6 kurdan ICE formulu)',
        fiyat: dxyHesapla(bacaklar),
        zaman: Math.min(...BACAKLAR.map(([ad]) => bacak[ad].v.zaman)),
      });
    } else {
      sorun('DXY', `Swissquote bacaklari eksik: ${eksik.join(', ')}`);
    }
    if (cnbc['.DXY']) adaylar.push({ kaynak: 'cnbc', fiyat: cnbc['.DXY'].fiyat, zaman: cnbc['.DXY'].zaman });
    // CNBC'nin .DXY barlari 10 dk gecikmeli ve 10 dk ileri etiketli. Grafik sekli
    // icin onemsiz; fiyat olarak KULLANILMAZ, yalnizca iki kaynak birbirini
    // tutmadiginda hangisinin makul oldugunu gormek icin hakemdir.
    const s = adaySec(adaylar, an, { sapma: 0.001, hakem: sonBarFiyati(barDxy.v, 20 * 60_000) });
    if (s) {
      kaydet('DXY', s, {
        oncekiKapanis: kapanis('.DXY', s.fiyat, barDxy.v),
        ...(barDxy.v ? gunlukSeri(barDxy.v, sinir) : {}),
        seriKaynak: 'cnbc',
      });
      // Sayfa DXY'yi kurlardan kendi hesapliyor; hangi kurlarin verilecegi poster-veri.js'in isi.
      enstrumanlar.DXY.bacaklar = s.kaynak.startsWith('swissquote') ? bacaklar : null;
    } else {
      sorun('DXY', 'hicbir kaynak yanit vermedi', veriYokNotu('DXY'));
    }
  }

  // BRENT ----------------------------------------------------------------------
  {
    const sonBar = barBrent.v?.at(-1);
    const q = cnbc['@LCO.1'];
    const adaylar = [
      sonBar && { kaynak: 'cnbc (1 dk bar)', fiyat: sonBar.c, zaman: sonBar.t },
      q && { kaynak: q.gercekZaman ? 'cnbc' : 'cnbc (10 dk gecikmeli)', fiyat: q.fiyat, zaman: q.zaman },
    ];
    // Gecikmeli kotasyon taze barla kiyaslanamaz (10 dk fark); sapma kontrolu yok.
    const s = adaySec(adaylar, an, { tazeMs: BAR_TAZE_MS, sapma: 1 });
    if (s) {
      kaydet('BRENT', s, {
        oncekiKapanis: kapanis('@LCO.1', s.fiyat, barBrent.v, brentKapanisAni),
        ...(barBrent.v ? gunlukSeri(barBrent.v, sinir) : {}),
        seriKaynak: 'cnbc',
      });
    } else {
      // Poster bu durumda sitenin kendi Brent kaynagina (Yahoo, 10 dk gecikmeli)
      // birakilir. Okuyucu notu burada degil, kart cizildikten sonra dusulur
      // (poster-veri.js dogrula()): sitenin kaynagi da yanit vermeyebilir.
      sorun('BRENT', `CNBC'den alinamadi (${barBrent.hata || 'bar yok'}); sitenin kendi kaynagina birakildi`);
    }
  }

  // BTC, ETH -------------------------------------------------------------------
  for (const [anahtar, v] of [
    ['BTCUSD', btc],
    ['ETHUSD', eth],
  ]) {
    if (v.hatalar.length) sorun(anahtar, `yedege dusuldu: ${v.hatalar.join(' | ')}`);
    if (!(v.fiyat > 0)) {
      sorun(anahtar, 'hicbir borsa yanit vermedi', veriYokNotu(anahtar));
      continue;
    }
    const yasSn = v.zaman ? Math.max(0, Math.round((an - v.zaman) / 1000)) : null;
    const taze = yasSn != null && yasSn * 1000 <= TAZE_MS;
    if (!taze) sorun(anahtar, `bayat veri (${v.kaynak})`, bayatNotu([anahtar], yasSn, false));
    enstrumanlar[anahtar] = {
      fiyat: v.fiyat,
      degisim: v.degisim,
      oncekiKapanis: null,
      seri: v.seri?.length >= 8 ? v.seri : null,
      kaynak: v.kaynak,
      zaman: v.zaman,
      yasSn,
      taze,
      seriKaynak: v.seri?.length >= 8 ? v.kaynak : null,
      seriEtiketi: v.seri?.length >= 8 ? '24H' : null,
    };
  }

  // Okuyucu notlari: ayni durumdaki enstrumanlar tek notta ---------------------
  if (bayatlar.length && kapali) {
    // Hafta sonu ve gunluk arada eski kotasyon ariza degil; kartlarin neyi
    // gosterdigi yine de soylenir (BTC ve ETH kartlari canli, digerleri degil).
    const liste = adlar(bayatlar.map((b) => b.anahtar));
    sorunlar.push({
      enstruman: liste,
      mesaj: 'piyasa kapali; son kapanis gosteriliyor',
      not: `Döviz ve emtia piyasaları kapalı; ${liste} son kapanış fiyatını gösteriyor`,
    });
  } else if (bayatlar.length) {
    const gruplar = new Map(); // ayni yastakiler birlikte
    for (const b of bayatlar) {
      const sure = b.yasSn == null ? '' : sureYaz(b.yasSn);
      gruplar.set(sure, [...(gruplar.get(sure) || []), b]);
    }
    for (const grup of gruplar.values()) {
      const anahtarlar = grup.map((b) => b.anahtar);
      sorunlar.push({
        enstruman: adlar(anahtarlar),
        mesaj: `bayat veri (${[...new Set(grup.map((b) => b.kaynak))].join(', ')})`,
        not: bayatNotu(anahtarlar, grup[0].yasSn),
      });
    }
  }
  if (degisimsizler.length) {
    sorunlar.push({
      enstruman: adlar(degisimsizler),
      mesaj: 'onceki kapanis da seri de yok; degisim rozeti bos kalacak',
      not: `${adlar(degisimsizler)} günlük değişimi alınamadı`,
    });
  }
  if (seridenler.length) {
    sorunlar.push({
      enstruman: adlar(seridenler),
      mesaj: 'onceki kapanis bilinmiyor; degisim serinin ilk degerine gore',
      not: `${adlar(seridenler)} yüzdesi önceki kapanışa göre değil, grafiğin başlangıcına göre`,
    });
  }

  return { an, kapali, enstrumanlar, sorunlar };
}

/** Log icin: enstruman basina fiyat, degisim, kaynak ve verinin yasi. */
export function goruntuOzeti(goruntu) {
  return Object.keys(ENSTRUMANLAR)
    .map((anahtar) => {
      const e = goruntu.enstrumanlar[anahtar];
      const { ad, ondalik } = ENSTRUMANLAR[anahtar];
      if (!e) return `  ${ad.padEnd(8)} VERI YOK`;
      const degisim = e.degisim == null ? '   —   ' : `${e.degisim >= 0 ? '+' : ''}${e.degisim.toFixed(2)}%`;
      const yas = e.yasSn == null ? 'zaman damgasi yok' : `${sureYaz(e.yasSn)} once`;
      const seri = e.seri ? `${e.seriEtiketi}, ${e.seri.length} nokta (${e.seriKaynak})` : 'yok';
      return `  ${ad.padEnd(8)} ${e.fiyat.toFixed(ondalik).padStart(10)}  ${degisim.padStart(7)}  <- ${e.kaynak}, ${yas} | grafik: ${seri}`;
    })
    .join('\n');
}
