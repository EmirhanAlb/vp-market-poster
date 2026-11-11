// src/piyasa.js ve src/poll/price.js icin senaryo testleri. Ag sahte: hicbir
// gercek kaynaga istek gitmez, saat sabit. Kaynak secimi, yedege dusme,
// bayatlik/sapma notlari ve oylamanin kaynak eslestirmesi sinanir.
// Kullanim: npm run fiyat:test
import assert from 'node:assert/strict';
import {
  piyasaGoruntusu,
  spotAltin,
  adaySec,
  dxyHesapla,
  seriyeIndir,
  sonNyKapanisi,
  piyasaKapaliOlabilir,
  isGunuKaldi,
  TAZE_MS,
} from '../src/piyasa.js';
import { kaynakEslestir, fiyatCoz } from '../src/poll/price.js';

// --- sahte ag ---------------------------------------------------------------
const GercekDate = Date;
let SIMDI = GercekDate.UTC(2026, 10, 11, 12, 0, 0); // Carsamba 12:00 UTC (NY 07:00) - piyasa acik
globalThis.Date = class extends GercekDate {
  constructor(...a) { if (a.length === 0) super(SIMDI); else super(...a); }
  static now() { return SIMDI; }
};

const LEGS = { 'EUR/USD': 1.1135, 'USD/JPY': 159.1, 'GBP/USD': 1.331, 'USD/CAD': 1.423, 'USD/SEK': 9.92, 'USD/CHF': 0.8294 };
const varsayilan = () => ({
  sq: { 'XAU/USD': { mid: 4046.0, yas: 1000 }, ...Object.fromEntries(Object.entries(LEGS).map(([k, v]) => [k, { mid: v, yas: 2000 }])) },
  cnbc: { 'XAU=': { last: '4,045.50', yas: 30_000, prev: '4,030.93', rt: 'true' }, 'EUR=': { last: '1.1134', yas: 40_000, prev: '1.1163', rt: 'true' }, '.DXY': { last: '102.530', yas: 5000, prev: '102.231', rt: 'true' }, '@LCO.1': { last: '92.75', yas: 600_000, prev: '91.49', rt: 'false', vade: '2026-11-30', kod: 'LCOF7' }, '@LCO.2': { last: '90.45', yas: 600_000, prev: '89.45', rt: 'false', vade: '2026-12-30', kod: 'LCOG7' } },
  bar: { 'XAU=': { son: 4045.2, yas: 90_000 }, 'EUR=': { son: 1.1135, yas: 90_000 }, '.DXY': { son: 102.52, yas: 90_000 }, '@LCO.1': { son: 93.2, yas: 100_000 }, '@LCO.2': { son: 90.9, yas: 100_000 } },
  gunluk: { '@LCO.1': [['20261109', '92.5700'], ['20261110', '91.4900']], '@LCO.2': [['20261109', '90.5000'], ['20261110', '89.4500']] },
  goldapi: { fiyat: 4046.4, yas: 20_000 },
  coinbase: { BTC: 73800, ETH: 2050 },
  kraken: { BTC: 73810, ETH: 2051, EUR: 1.1133, PAXG: 4032 },
  bitstamp: { BTC: 73790, ETH: 2049 },
  binance: { BTC: 73870, ETH: 2052, PAXG: 4035 },
  coingecko: { BTC: 73900, ETH: 2053 },
});
let S = varsayilan();
const istekler = [];
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const yok = () => { throw new TypeError('fetch failed (test)'); };

globalThis.fetch = async (url) => {
  url = String(url);
  istekler.push(url);
  let m;
  if ((m = /swissquote\.com\/public-quotes\/bboquotes\/instrument\/(\w+)\/(\w+)/.exec(url))) {
    const k = S.sq?.[`${m[1]}/${m[2]}`];
    if (!k) return yok();
    const ts = SIMDI - k.yas;
    return json([
      { topo: { platform: 'A' }, spreadProfilePrices: [{ spreadProfile: 'premium', bid: k.mid * 0.9999, ask: k.mid * 1.0001 }, { spreadProfile: 'elite', bid: k.mid * 0.99999, ask: k.mid * 1.00001 }], ts },
      { topo: { platform: 'B' }, spreadProfilePrices: [{ spreadProfile: 'prime', bid: k.mid * 0.99995, ask: k.mid * 1.00005 }], ts: ts - 500 },
    ]);
  }
  if (url.includes('quote.cnbc.com')) {
    if (!S.cnbc) return yok();
    const istenen = decodeURIComponent(/symbols=([^&]+)/.exec(url)[1]).split('|');
    const liste = istenen.filter((s) => S.cnbc[s]).map((s) => ({ symbol: s, last: S.cnbc[s].last, last_time: new GercekDate(SIMDI - S.cnbc[s].yas).toISOString(), previous_day_closing: S.cnbc[s].prev, realTime: S.cnbc[s].rt, expiration_date: S.cnbc[s].vade ?? null, altSymbol: S.cnbc[s].kod ?? s }));
    if (liste.length === 0) return json({}); // CNBC'nin tanimadigi istemciye verdigi bos govde gibi
    return json({ FormattedQuoteResult: { FormattedQuote: liste.length === 1 ? liste[0] : liste } });
  }
  if ((m = /ts-api\.cnbc\.com\/harmony\/app\/bars\/([^/]+)\/1D\//.exec(url))) {
    const g = S.gunluk?.[decodeURIComponent(m[1])];
    if (!g) return yok();
    return json({ barData: { priceBars: g.map(([gun, close]) => ({ open: '0.0000', close, tradeTime: `${gun}000000` })) } });
  }
  if ((m = /ts-api\.cnbc\.com\/harmony\/app\/charts\/1D\.json\?symbol=([^&]+)/.exec(url))) {
    const k = S.bar?.[decodeURIComponent(m[1])];
    if (!k) return yok();
    const n = 2000;
    // 2000 dakikada %1 yukselen 1 dk'lik barlar; `bosluk: [a, b]` son bardan a..b dakika oncesini siler.
    const priceBars = Array.from({ length: n }, (_, i) => ({ close: String((k.son * (1 - 0.01 * (1 - i / (n - 1)))).toFixed(4)), tradeTimeinMills: SIMDI - k.yas - (n - 1 - i) * 60_000 }))
      .filter((_, i) => !k.bosluk || n - 1 - i < k.bosluk[0] || n - 1 - i >= k.bosluk[1]);
    return json({ barData: { priceBars } });
  }
  if (url.includes('gold-api.com')) return S.goldapi ? json({ price: S.goldapi.fiyat, updatedAt: new GercekDate(SIMDI - S.goldapi.yas).toISOString() }) : yok();
  if ((m = /api\.exchange\.coinbase\.com\/products\/(BTC|ETH)-USD\/(ticker|stats|candles)/.exec(url))) {
    if (!S.coinbase) return yok();
    const f = S.coinbase[m[1]];
    if (m[2] === 'ticker') return json({ price: String(f), time: new GercekDate(SIMDI - (S.coinbase.yas ?? 800)).toISOString() });
    // Mumlar: istenen pencere ve aralikta, yeniden eskiye. 1 dk'lik mumlar (24 saat onceki referans)
    // fiyatin %0,5 ustunde; 15 dk'lik mumlar geriye dogru mum basina %0,01 artiyor.
    const g = Number(/granularity=(\d+)/.exec(url)[1]);
    const bas = Date.parse(decodeURIComponent(/start=([^&]+)/.exec(url)[1]));
    const son = Date.parse(decodeURIComponent(/end=([^&]+)/.exec(url)[1]));
    const satirlar = [];
    for (let t = Math.floor(son / 1000 / g) * g, i = 0; t * 1000 >= bas; t -= g, i++) satirlar.push([t, 0, 0, f * 1.005, g === 60 ? f * 1.005 : f * (1 + i * 0.0001), 1]);
    return json(satirlar);
  }
  if ((m = /api\.kraken\.com\/0\/public\/(Ticker|OHLC)\?pair=(\w+)/.exec(url))) {
    if (!S.kraken) return yok();
    const ad = { XBTUSD: 'BTC', ETHUSD: 'ETH', EURUSD: 'EUR', PAXGUSD: 'PAXG' }[m[2]];
    const f = S.kraken[ad];
    if (m[1] === 'Ticker') return json({ error: [], result: { X: { c: [String(f * 0.999)], b: [String(f * 0.99999)], a: [String(f * 1.00001)], o: String(f) } } });
    return json({ error: [], result: { X: Array.from({ length: 200 }, (_, i) => [0, 0, 0, 0, String(f * (0.99 + 0.01 * (i / 199)))]), last: 1 } });
  }
  if ((m = /bitstamp\.net\/api\/v2\/(ticker|ohlc)\/(btc|eth)usd/.exec(url))) {
    if (!S.bitstamp) return yok();
    const f = S.bitstamp[m[2].toUpperCase()];
    if (m[1] === 'ticker') return json({ last: String(f), timestamp: String(Math.floor(SIMDI / 1000)), percent_change_24: '-0.64' });
    return json({ data: { ohlc: Array.from({ length: 96 }, (_, i) => ({ close: String(f * (1 + (i - 95) * 0.0001)) })) } });
  }
  if ((m = /data-api\.binance\.vision\/api\/v3\/(ticker\/24hr|klines)\?symbol=(\w+)/.exec(url))) {
    if (!S.binance) return yok();
    const ad = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', PAXGUSDT: 'PAXG' }[m[2]];
    const f = S.binance[ad];
    if (m[1] === 'klines') return json(Array.from({ length: 96 }, (_, i) => [0, '0', '0', '0', String(f * (0.99 + 0.01 * (i / 95)))]));
    return json({ lastPrice: String(f), priceChangePercent: '-0.7', closeTime: SIMDI - 500 });
  }
  if (url.includes('api.coingecko.com')) {
    if (!S.coingecko) return yok();
    const id = /ids=(\w+)/.exec(url)[1];
    return json({ [id]: { usd: S.coingecko[id === 'bitcoin' ? 'BTC' : 'ETH'], usd_24h_change: -0.5, last_updated_at: Math.floor(SIMDI / 1000) - 50 } });
  }
  throw new Error(`testte beklenmeyen istek: ${url}`);
};

let gecen = 0;
const test = async (ad, fn) => {
  S = varsayilan();
  SIMDI = GercekDate.UTC(2026, 10, 11, 12, 0, 0);
  istekler.length = 0;
  try { await fn(); gecen += 1; console.log(`  ok  ${ad}`); }
  catch (err) { console.log(`  HATA ${ad}\n      ${String(err.message).split('\n').join('\n      ')}`); process.exitCode = 1; }
};
const yakin = (a, b, tol, ne) => assert.ok(Math.abs(a - b) <= tol, `${ne}: ${a} ~ ${b} (tol ${tol})`);
const notlar = (g) => g.sorunlar.filter((s) => s.not).map((s) => s.not);

console.log('piyasaGoruntusu');
await test('tum kaynaklar saglikli: Swissquote spot, gunluk degisim CNBC kapanisina gore, uyari yok', async () => {
  const g = await piyasaGoruntusu();
  const e = g.enstrumanlar;
  assert.deepEqual(Object.keys(e).sort(), ['BRENT', 'BTCUSD', 'DXY', 'ETHUSD', 'EURUSD', 'XAUUSD']);
  assert.equal(e.XAUUSD.kaynak, 'swissquote'); yakin(e.XAUUSD.fiyat, 4046.0, 0.01, 'XAU');
  yakin(e.XAUUSD.degisim, ((4046.0 - 4030.93) / 4030.93) * 100, 1e-6, 'XAU degisim');
  assert.equal(e.EURUSD.kaynak, 'swissquote'); yakin(e.EURUSD.degisim, ((1.1135 - 1.1163) / 1.1163) * 100, 1e-6, 'EUR degisim');
  yakin(e.DXY.fiyat, dxyHesapla({ EURUSD: 1.1135, USDJPY: 159.1, GBPUSD: 1.331, USDCAD: 1.423, USDSEK: 9.92, USDCHF: 0.8294 }), 1e-9, 'DXY');
  assert.ok(e.DXY.bacaklar, 'DXY bacaklari');
  assert.equal(e.BRENT.kaynak, 'cnbc (1 dk bar)'); yakin(e.BRENT.fiyat, 93.2, 1e-9, 'Brent bar');
  yakin(e.BRENT.degisim, ((93.2 - 91.49) / 91.49) * 100, 1e-6, 'Brent degisim');
  assert.equal(e.BTCUSD.kaynak, 'coinbase'); yakin(e.BTCUSD.degisim, ((1 - 1.005) / 1.005) * 100, 1e-6, 'BTC 24s');
  // Doviz/emtia grafikleri son New York 17:00'sinden (Sali 22:00 UTC) baslar: 14 saat = 56 kova; kripto 24 saat.
  for (const k of ['XAUUSD', 'EURUSD', 'DXY', 'BRENT']) { assert.equal(e[k].seri.length, 56, `${k} seri`); assert.equal(e[k].seriEtiketi, '1D'); }
  for (const k of ['BTCUSD', 'ETHUSD']) { assert.equal(e[k].seri.length, 96, `${k} seri`); assert.equal(e[k].seriEtiketi, '24H'); }
  assert.equal(e.BTCUSD.seri.at(-1), 73800, 'BTC serisi eskiden yeniye');
  assert.deepEqual(notlar(g), []);
  assert.ok(!istekler.some((u) => /api\.binance\.com|er-api|yahoo|pax-gold|goldprice/.test(u)), 'yasakli kaynak istenmedi');
  assert.ok(!istekler.some((u) => /charts\/1D\.json\?symbol=%40LCO\.2/.test(u)), 'vade uzakken ikinci ay Brent barlari istenmedi');
  assert.equal(e.BRENT.sozlesme, 'LCOF7');
});
await test('Swissquote tamamen yok: altin/EUR/DXY CNBC\'den, DXY bacaksiz, not yok', async () => {
  S.sq = null;
  const g = await piyasaGoruntusu();
  const e = g.enstrumanlar;
  assert.equal(e.XAUUSD.kaynak, 'cnbc'); yakin(e.XAUUSD.fiyat, 4045.5, 1e-9, 'XAU');
  assert.equal(e.EURUSD.kaynak, 'cnbc');
  assert.equal(e.DXY.kaynak, 'cnbc'); assert.equal(e.DXY.bacaklar, null); yakin(e.DXY.fiyat, 102.53, 1e-9, 'DXY');
  assert.deepEqual(notlar(g), []);
});
await test('CNBC tamamen yok: fiyatlar canli; altinda token yuzdesi ve grafigi yok, DXY rozetsiz, Brent siteye birakilir', async () => {
  S.cnbc = null; S.bar = null;
  const g = await piyasaGoruntusu();
  const e = g.enstrumanlar;
  assert.equal(e.XAUUSD.kaynak, 'swissquote'); assert.equal(e.XAUUSD.oncekiKapanis, null);
  assert.equal(e.XAUUSD.seri, null, 'onceki kapanis yokken PAXG sekli verilmez'); assert.equal(e.XAUUSD.degisim, null, 'token yuzdesi yayimlanmaz');
  assert.ok(!istekler.some((u) => /PAXG/.test(u)), 'PAXG hic istenmedi');
  assert.equal(e.EURUSD.seriKaynak, 'kraken'); assert.ok(e.EURUSD.degisim != null); assert.equal(e.EURUSD.seriEtiketi, '24H');
  assert.equal(e.DXY.seri, null); assert.equal(e.DXY.degisim, null);
  assert.equal(e.BRENT, undefined, 'Brent notu kart cizildikten sonra dogrula() tarafindan dusulur');
  assert.deepEqual(notlar(g).sort(), ['DXY, XAU/USD günlük değişimi alınamadı', 'EUR/USD yüzdesi önceki kapanışa göre değil, grafiğin başlangıcına göre']);
});
await test('CNBC grafik servisi yok, kotasyon var: altin grafigi PAXG sekli ama yuzde kapanisa gore', async () => {
  S.bar = null;
  const g = await piyasaGoruntusu();
  const x = g.enstrumanlar.XAUUSD;
  assert.ok(x.seriKaynak.startsWith('paxg'), x.seriKaynak); yakin(x.seri.at(-1), x.fiyat, 1e-6, 'PAXG sekli spot duzeyinde'); assert.equal(x.seriEtiketi, '24H');
  yakin(x.degisim, ((4046.0 - 4030.93) / 4030.93) * 100, 1e-6, 'yuzde CNBC kapanisina gore');
  assert.equal(g.enstrumanlar.DXY.seri, null); yakin(g.enstrumanlar.DXY.degisim, ((g.enstrumanlar.DXY.fiyat - 102.231) / 102.231) * 100, 1e-6, 'DXY yuzdesi');
  assert.equal(g.enstrumanlar.BRENT.kaynak, 'cnbc (10 dk gecikmeli)');
  assert.deepEqual(notlar(g), ['BRENT verisi 10 dk öncesine ait']);
});
await test('CNBC kotasyonu yok, barlar var: onceki kapanis barlardan (Brent icin gunluk barlardaki ICE uzlasisi)', async () => {
  S.cnbc = null;
  let g = await piyasaGoruntusu();
  let e = g.enstrumanlar;
  // Sahte 1 dk'lik barlar 2000 dakikada %1 yukseliyor. Sinirdan hemen onceki bar: XAU/EUR icin Sali 17:00 NY
  // (22:00 UTC, son bardan 839 dk once), DXY icin "15:10" NY etiketi (20:10 UTC, 949 dk once).
  yakin(e.XAUUSD.oncekiKapanis, 4045.2 * (1 - (0.01 * 839) / 1999), 0.03, 'XAU kapanis');
  yakin(e.DXY.oncekiKapanis, 102.52 * (1 - (0.01 * 949) / 1999), 0.001, 'DXY kapanis (New York 15:00)');
  yakin(e.BRENT.oncekiKapanis, 91.49, 1e-9, 'Brent: gunluk bardaki uzlasi');
  for (const k of ['XAUUSD', 'EURUSD', 'DXY', 'BRENT']) assert.ok(e[k].degisim > 0 && e[k].degisim < 2, `${k} degisim ${e[k].degisim}`);
  assert.deepEqual(notlar(g), [], 'kapanis barlardan bulundu: okuyucu notu yok');
  // Gunluk barlar da yoksa: 1 dk'lik barlarda Londra 19:30'dan (19:30 UTC, son bardan 989 dk once) hemen onceki bar.
  S.gunluk = null;
  g = await piyasaGoruntusu(); e = g.enstrumanlar;
  yakin(e.BRENT.oncekiKapanis, 93.2 * (1 - (0.01 * 989) / 1999), 0.001, 'Brent: Londra 19:30 oncesi bar');
  assert.deepEqual(notlar(g), []);
});
await test('CNBC kotasyonu bos govde donuyor (taninmayan istemci): hata sayilir, kapanislar barlardan gelir', async () => {
  S.cnbc = {};
  const g = await piyasaGoruntusu();
  assert.ok(g.sorunlar.some((s) => s.enstruman === 'CNBC' && /bos yanit/.test(s.mesaj)), 'CNBC sorunu loglandi');
  assert.equal(g.enstrumanlar.XAUUSD.kaynak, 'swissquote'); assert.ok(g.enstrumanlar.XAUUSD.oncekiKapanis > 4000);
});
await test('Brent vade gecisi: vadeye 5 is gunu kala ikinci ay kontrati yayimlanir', async () => {
  SIMDI = GercekDate.UTC(2026, 10, 20, 12, 0, 0); // Cuma 20 Kasim: 30 Kasim vadesine 6 is gunu
  let g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.BRENT.sozlesme, 'LCOF7'); yakin(g.enstrumanlar.BRENT.fiyat, 93.2, 1e-9, 'on ay');
  SIMDI = GercekDate.UTC(2026, 10, 23, 12, 0, 0); // Pazartesi 23 Kasim: 5 is gunu
  g = await piyasaGoruntusu();
  const b = g.enstrumanlar.BRENT;
  assert.equal(b.sozlesme, 'LCOG7'); yakin(b.fiyat, 90.9, 1e-9, 'ikinci ay bari'); assert.equal(b.kaynak, 'cnbc (1 dk bar)');
  yakin(b.oncekiKapanis, 89.45, 1e-9, 'ikinci ayin kendi uzlasisi'); yakin(b.degisim, ((90.9 - 89.45) / 89.45) * 100, 1e-6, 'degisim');
  assert.equal(b.seriEtiketi, '1D'); assert.deepEqual(notlar(g), []);
  // Vade gecince CNBC'nin on ay adi yeni kontrata doner; kural kendiliginden on aya geri gelir.
  SIMDI = GercekDate.UTC(2026, 11, 1, 12, 0, 0);
  S.cnbc['@LCO.1'] = { ...S.cnbc['@LCO.2'] }; S.bar['@LCO.1'] = { ...S.bar['@LCO.2'] };
  g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.BRENT.sozlesme, 'LCOG7'); yakin(g.enstrumanlar.BRENT.fiyat, 90.9, 1e-9, 'yeni on ay');
  // Kotasyon yokken vade ayin son is gunu varsayilir.
  SIMDI = GercekDate.UTC(2026, 10, 25, 12, 0, 0); S = varsayilan(); S.cnbc = null;
  g = await piyasaGoruntusu();
  yakin(g.enstrumanlar.BRENT.fiyat, 90.9, 1e-9, 'kotasyonsuz: takvim kurali ikinci aya gecirir');
});
await test('Brent bari bayat: 10 dk gecikmeli kotasyona duser ve okuyucuya not duser', async () => {
  S.bar['@LCO.1'].yas = 20 * 60_000;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.BRENT.kaynak, 'cnbc (10 dk gecikmeli)'); yakin(g.enstrumanlar.BRENT.fiyat, 92.75, 1e-9, 'Brent');
  assert.deepEqual(notlar(g), ['BRENT verisi 10 dk öncesine ait']);
});
await test('Swissquote altini bayat (5 dk), CNBC taze: CNBC secilir, not yok', async () => {
  S.sq['XAU/USD'].yas = 5 * 60_000;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.XAUUSD.kaynak, 'cnbc'); assert.deepEqual(notlar(g), []);
});
await test('iki taze kaynak uyusmuyor (CNBC 4045.5, gold-api 3900): oncelikli secilir, isaretlenir, sapan eslestirmeye giremez', async () => {
  S.goldapi.fiyat = 3900; S.sq['XAU/USD'] = null;
  const a = await spotAltin();
  assert.equal(a.kaynak, 'cnbc'); assert.equal(a.uyusmuyor, true); assert.ok(a.notlar.some((n) => n.includes('gold-api')), 'sapma notu');
  assert.deepEqual(Object.keys(a.adaylar), ['cnbc'], 'uyusmayan kaynak adaylarda yok');
  assert.deepEqual(Object.keys(a.yaslar).sort(), ['cnbc', 'gold-api'], 'yaslar yanit veren her kaynagi icerir');
  const g = await piyasaGoruntusu();
  assert.ok(notlar(g).includes('XAU/USD kaynakları birbirini tutmuyor, değer teyit edilemedi'), notlar(g).join('|'));
});
await test('Swissquote sapik (4500), diger ucu tutarli: medyana uyan secilir', async () => {
  S.sq['XAU/USD'].mid = 4500;
  const a = await spotAltin();
  assert.equal(a.kaynak, 'cnbc'); assert.ok(a.notlar.some((n) => n.includes('swissquote')));
  assert.deepEqual(Object.keys(a.adaylar).sort(), ['cnbc', 'gold-api'], 'elenen Swissquote adaylarda yok');
  assert.equal(a.uyusmuyor, false);
});
await test('oylama: kapanista sapan diye elenen kaynak, acilisin kaynagi olsa bile eslestirmeye giremez', async () => {
  const acilis = await spotAltin(); // hepsi uyumlu, Swissquote 4046 secilir
  assert.equal(acilis.kaynak, 'swissquote');
  // Bir saat sonra piyasa 4050'de (+%0,10 = duragan); Swissquote taze ama bozuk bir 4037 veriyor.
  S.sq['XAU/USD'].mid = 4037; S.cnbc['XAU='].last = '4,049.50'; S.goldapi.fiyat = 4050.4;
  const kapanis = await spotAltin();
  assert.equal(kapanis.kaynak, 'cnbc'); assert.ok(!('swissquote' in kapanis.adaylar));
  const e = kaynakEslestir(acilis, kapanis);
  assert.deepEqual(e, { acilisFiyat: 4045.5, kapanisFiyat: 4049.5, kaynak: 'cnbc', karisik: false });
  yakin(((e.kapanisFiyat - e.acilisFiyat) / e.acilisFiyat) * 100, 0.099, 0.002, 'duragan');
});
await test('EUR/USD ve DXY: Swissquote bozuk, CNBC dogru -> son bar hakem, CNBC secilir, not yok', async () => {
  S.sq['EUR/USD'].mid = 1.125;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.EURUSD.kaynak, 'cnbc'); yakin(g.enstrumanlar.EURUSD.fiyat, 1.1134, 1e-9, 'EUR/USD');
  assert.equal(g.enstrumanlar.DXY.kaynak, 'cnbc'); assert.equal(g.enstrumanlar.DXY.bacaklar, null); yakin(g.enstrumanlar.DXY.fiyat, 102.53, 1e-9, 'DXY');
  assert.deepEqual(notlar(g), []);
  assert.ok(!istekler.some((u) => /kraken\.com.*EURUSD/.test(u)), 'hakem cozdugu icin Kraken istenmedi');
});
await test('EUR/USD: iki kaynak uyusmuyor ve bar yok -> Kraken hakem olur; DXY cozulmez ve okuyucuya not duser', async () => {
  S.sq['EUR/USD'].mid = 1.125; S.bar = null;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.EURUSD.kaynak, 'cnbc', 'uc adayin medyani Swissquote u eler');
  assert.ok(istekler.some((u) => /kraken\.com.*Ticker.*EURUSD/.test(u)), 'Kraken soruldu');
  assert.ok(notlar(g).includes('DXY kaynakları birbirini tutmuyor, değer teyit edilemedi'), notlar(g).join('|'));
  assert.ok(!notlar(g).some((n) => n.startsWith('EUR/USD kaynak')), 'EUR/USD cozuldu');
});
await test('hafta ici tum altin kaynaklari bayat: en yenisi secilir ve not duser', async () => {
  S.sq['XAU/USD'].yas = 40 * 60_000; S.cnbc['XAU='].yas = 30 * 60_000; S.goldapi.yas = 45 * 60_000;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.XAUUSD.kaynak, 'cnbc'); assert.equal(g.enstrumanlar.XAUUSD.taze, false);
  assert.ok(notlar(g).includes('XAU/USD verisi 30 dk öncesine ait'), notlar(g).join('|'));
});
await test('hafta sonu (Cumartesi): eski kotasyon ariza sayilmaz, tek sakin not; kripto canli', async () => {
  SIMDI = GercekDate.UTC(2026, 10, 14, 9, 0, 0);
  const eski = 12 * 3600_000;
  for (const k of Object.keys(S.sq)) S.sq[k].yas = eski;
  for (const k of Object.keys(S.cnbc)) S.cnbc[k].yas = eski;
  for (const k of Object.keys(S.bar)) S.bar[k].yas = eski;
  S.goldapi.yas = eski;
  const g = await piyasaGoruntusu();
  assert.equal(g.kapali, true);
  assert.deepEqual(notlar(g), ['Döviz ve emtia piyasaları kapalı; DXY, BRENT, EUR/USD, XAU/USD son kapanış fiyatını gösteriyor']);
  assert.equal(g.enstrumanlar.XAUUSD.taze, false); assert.equal(g.enstrumanlar.BTCUSD.taze, true);
  assert.equal(g.enstrumanlar.XAUUSD.seri.length, 96, 'hafta sonu son 96 dolu kova');
  assert.equal(g.enstrumanlar.XAUUSD.seriEtiketi, '24H', 'kapanistan beri bar yok: etiket 24H kalir');
  // Kraken'de EUR/USD hafta sonu da islem gorur; kapali piyasada cuma kapanisinin yerine gecmemeli.
  assert.equal(g.enstrumanlar.EURUSD.kaynak, 'swissquote');
  assert.ok(!istekler.some((u) => /kraken\.com.*EURUSD/.test(u)), 'hafta sonu Kraken EUR/USD istenmedi');
});
await test('hafta ici Swissquote ve CNBC EUR/USD bayat: Kraken yedegi devreye girer', async () => {
  S.sq['EUR/USD'].yas = 10 * 60_000; S.cnbc['EUR='].yas = 10 * 60_000;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.EURUSD.kaynak, 'kraken'); yakin(g.enstrumanlar.EURUSD.fiyat, 1.1133, 1e-6, 'alis-satis ortasi');
});
await test('altin barlarinda bosluk: eksik kovalar vadeliden, medyan fark kadar kaydirilarak dolar', async () => {
  S.bar['XAU='].bosluk = [300, 720]; // 5-12 saat oncesi yok (pazartesi sabahi deligi gibi)
  S.bar['@GC.1'] = { son: 4053.2, yas: 90_000 }; // vadeli, spotun 8 $ ustunde
  const g = await piyasaGoruntusu();
  const x = g.enstrumanlar.XAUUSD;
  assert.equal(x.seri.length, 56, 'pencere bosluksuz');
  assert.ok(x.seriKaynak.includes('vadeliden'), x.seriKaynak);
  const enBuyukAdim = Math.max(...x.seri.slice(1).map((v, i) => Math.abs(v - x.seri[i])));
  assert.ok(enBuyukAdim < 1.5, `dolgu sinirlarinda sicrama yok (en buyuk adim ${enBuyukAdim.toFixed(2)} $)`);
  S.bar['XAU='] = undefined; delete S.bar['XAU='];
  const y = (await piyasaGoruntusu()).enstrumanlar.XAUUSD;
  assert.ok(y.seriKaynak.startsWith('cnbc vadeli')); yakin(y.seri.at(-1), y.fiyat, 0.6, 'vadeli seri spot duzeyinde');
});
await test('Coinbase yok: Kraken; ikisi de yok: Bitstamp; hepsi yok: not', async () => {
  S.coinbase = null;
  let g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.BTCUSD.kaynak, 'kraken'); assert.equal(g.enstrumanlar.BTCUSD.seri.length, 96);
  S.kraken = null;
  g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.ETHUSD.kaynak, 'bitstamp'); yakin(g.enstrumanlar.ETHUSD.degisim, -0.64, 1e-9, '24s');
  S.bitstamp = null; S.binance = null; S.coingecko = null;
  g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.BTCUSD, undefined);
  assert.ok(notlar(g).includes('BTC/USD için canlı veri alınamadı') && notlar(g).includes('ETH/USD için canlı veri alınamadı'));
});
await test('Coinbase yanit veriyor ama son islemi 30 dk eski: taze olan sonraki borsa secilir', async () => {
  S.coinbase.yas = 30 * 60_000;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.BTCUSD.kaynak, 'kraken'); assert.equal(g.enstrumanlar.BTCUSD.taze, true); assert.deepEqual(notlar(g), []);
  S.kraken = null; S.bitstamp = null; S.binance = null; S.coingecko = null;
  const h = await piyasaGoruntusu();
  assert.equal(h.enstrumanlar.BTCUSD.kaynak, 'coinbase', 'baska yanit yoksa bayat olan son care');
  assert.ok(notlar(h).includes('BTC/USD verisi 30 dk öncesine ait'), notlar(h).join('|'));
});
await test('bozuk onceki kapanis (%15ten fazla sapma) kullanilmaz', async () => {
  S.cnbc['XAU='].prev = '403.09';
  const g = await piyasaGoruntusu();
  // Yedek: barlardan son New York 17:00'sinden (Sali 22:00 UTC) hemen onceki kapanis.
  // Sahte barlarda o bar son bardan 839 dk once: 4045.2 * (1 - 0.01 * 839/1999) = 4028.22.
  yakin(g.enstrumanlar.XAUUSD.oncekiKapanis, 4028.22, 0.02, 'barlardan kapanis');
  yakin(g.enstrumanlar.XAUUSD.degisim, ((4046.0 - 4028.22) / 4028.22) * 100, 0.002, 'degisim');
});
await test('hicbir altin kaynagi yok: enstruman yok, not var, digerleri calisir', async () => {
  S.sq['XAU/USD'] = null; S.cnbc['XAU='] = undefined; delete S.cnbc['XAU=']; S.goldapi = null;
  const g = await piyasaGoruntusu();
  assert.equal(g.enstrumanlar.XAUUSD, undefined); assert.ok(g.enstrumanlar.EURUSD && g.enstrumanlar.DXY);
  assert.ok(notlar(g).includes('XAU/USD için canlı veri alınamadı'));
});

console.log('yardimcilar');
await test('adaySec: oncelik, tazelik, tek aday, bos', async () => {
  const an = 1_000_000_000;
  assert.equal(adaySec([], an), null);
  assert.equal(adaySec([{ kaynak: 'a', fiyat: 10, zaman: an - 1000 }, { kaynak: 'b', fiyat: 10.01, zaman: an - 10 }], an).kaynak, 'a');
  assert.equal(adaySec([{ kaynak: 'a', fiyat: 10, zaman: an - TAZE_MS - 1 }, { kaynak: 'b', fiyat: 10.01, zaman: an - 10 }], an).kaynak, 'b');
  const eski = adaySec([{ kaynak: 'a', fiyat: 10, zaman: an - 9e6 }, { kaynak: 'b', fiyat: 11, zaman: an - 8e6 }, { kaynak: 'c', fiyat: 12, zaman: null }], an);
  assert.equal(eski.kaynak, 'b'); assert.equal(eski.taze, false);
  const ikili = adaySec([{ kaynak: 'a', fiyat: 100, zaman: an }, { kaynak: 'b', fiyat: 110, zaman: an }], an);
  assert.equal(ikili.kaynak, 'a'); assert.equal(ikili.notlar.length, 2, 'iki kaynak uyusmazsa ikisi de isaretlenir, oncelikli secilir');
  assert.equal(ikili.uyusmuyor, true); assert.deepEqual(ikili.tutarlilar, ['a']);
  const hakemli = adaySec([{ kaynak: 'a', fiyat: 100, zaman: an }, { kaynak: 'b', fiyat: 110, zaman: an }], an, { hakem: 109.9 });
  assert.equal(hakemli.kaynak, 'b'); assert.equal(hakemli.uyusmuyor, false); assert.deepEqual(hakemli.tutarlilar, ['b']);
  // Iki aday dogrudan birbiriyle kiyaslanir: %0,25 sinirinda 100 ile 100,3 uyusmaz (ortalamaya gore kiyas bunu kacirirdi).
  assert.equal(adaySec([{ kaynak: 'a', fiyat: 100, zaman: an }, { kaynak: 'b', fiyat: 100.3, zaman: an }], an).uyusmuyor, true);
  assert.equal(adaySec([{ kaynak: 'a', fiyat: 100, zaman: an }, { kaynak: 'b', fiyat: 100.2, zaman: an }], an).uyusmuyor, false);
});
await test('dxyHesapla ICE formulu; seriyeIndir kovalar; piyasaKapaliOlabilir', async () => {
  yakin(dxyHesapla({ EURUSD: 1.11352, USDJPY: 159.137, GBPUSD: 1.33083, USDCAD: 1.42302, USDSEK: 9.92282, USDCHF: 0.82944 }), 102.53, 0.01, 'DXY (11.11.2026 12:05 UTC olcumu; CNBC .DXY 102.532)');
  const barlar = Array.from({ length: 50 }, (_, i) => ({ t: i * 60_000, c: i }));
  assert.deepEqual(seriyeIndir(barlar), [14, 29, 44, 49]);
  assert.deepEqual(seriyeIndir(barlar, { adet: 2 }), [44, 49]);
  assert.deepEqual(seriyeIndir(barlar, { baslangic: 15 * 60_000 }), [14, 29, 44, 49], 'pencere 8 kovadan azsa tum seri');
  const uzun = Array.from({ length: 200 }, (_, i) => ({ t: i * 60_000, c: i }));
  assert.deepEqual(seriyeIndir(uzun, { baslangic: 60 * 60_000 }), [74, 89, 104, 119, 134, 149, 164, 179, 194, 199], 'baslangictan sonraki kovalar');
  const iso = (ms) => new GercekDate(ms).toISOString();
  assert.equal(iso(sonNyKapanisi(GercekDate.UTC(2026, 10, 11, 12, 0))), '2026-11-10T22:00:00.000Z', 'kis: 17:00 NY = 22:00 UTC');
  assert.equal(iso(sonNyKapanisi(GercekDate.UTC(2026, 10, 11, 22, 30))), '2026-11-11T22:00:00.000Z', 'kapanistan hemen sonra');
  assert.equal(iso(sonNyKapanisi(GercekDate.UTC(2026, 6, 15, 12, 0))), '2026-07-14T21:00:00.000Z', 'yaz: 17:00 NY = 21:00 UTC');
  assert.equal(iso(sonNyKapanisi(GercekDate.UTC(2026, 10, 16, 8, 0))), '2026-11-15T22:00:00.000Z', 'pazartesi sabahi: pazar 17:00 NY');
  const ny = (g, s) => new GercekDate(GercekDate.UTC(2026, 10, g, s + 5, 0)); // Kasim: NY = UTC-5
  assert.equal(piyasaKapaliOlabilir(ny(11, 9)), false, 'Car 09:00');
  assert.equal(piyasaKapaliOlabilir(ny(11, 18)), true, 'Car 18:00 gunluk ara');
  assert.equal(piyasaKapaliOlabilir(ny(11, 20)), false, 'Car 20:00');
  assert.equal(piyasaKapaliOlabilir(ny(13, 17)), true, 'Cum 17:00');
  assert.equal(piyasaKapaliOlabilir(ny(14, 12)), true, 'Cmt');
  assert.equal(piyasaKapaliOlabilir(ny(15, 17)), true, 'Paz 17:00');
  assert.equal(piyasaKapaliOlabilir(ny(15, 18)), false, 'Paz 18:00');
  const gun = (ay, g) => GercekDate.UTC(2026, ay - 1, g, 12);
  assert.equal(isGunuKaldi(gun(11, 20), gun(11, 30)), 6, 'Cuma 20 Kasim -> 30 Kasim');
  assert.equal(isGunuKaldi(gun(11, 21), gun(11, 30)), 6, 'hafta sonu sayilmaz');
  assert.equal(isGunuKaldi(gun(11, 23), gun(11, 30)), 5); assert.equal(isGunuKaldi(gun(11, 30), gun(11, 30)), 0); assert.equal(isGunuKaldi(gun(12, 1), gun(11, 30)), 0, 'gecmis vade');
});
await test('kaynakEslestir: ayni kaynak > ortak kaynak > karisik', async () => {
  const acilis = { fiyat: 4046, kaynak: 'swissquote', adaylar: { swissquote: 4046, cnbc: 4045.5, 'gold-api': 4046.4 } };
  assert.deepEqual(kaynakEslestir(acilis, { fiyat: 4050, kaynak: 'swissquote', adaylar: { swissquote: 4050, cnbc: 4049 } }), { acilisFiyat: 4046, kapanisFiyat: 4050, kaynak: 'swissquote', karisik: false });
  assert.deepEqual(kaynakEslestir(acilis, { fiyat: 4049, kaynak: 'cnbc', adaylar: { cnbc: 4049, 'gold-api': 4049.4 } }), { acilisFiyat: 4045.5, kapanisFiyat: 4049, kaynak: 'cnbc', karisik: false });
  const k = kaynakEslestir({ fiyat: 4046, kaynak: 'swissquote', adaylar: { swissquote: 4046 } }, { fiyat: 4049.4, kaynak: 'gold-api', adaylar: { 'gold-api': 4049.4 } });
  assert.equal(k.karisik, true); assert.equal(k.acilisFiyat, 4046); assert.equal(k.kapanisFiyat, 4049.4);
  const elle = kaynakEslestir({ fiyat: 4040, kaynak: null, adaylar: {} }, { fiyat: 4050, kaynak: 'swissquote', adaylar: { swissquote: 4050 } });
  assert.equal(elle.karisik, true); assert.equal(elle.acilisFiyat, 4040);
  // Kapanis bayat (adaylar bos) ama iki ucta da ayni kaynak secilmis: eslesir, "karisik" denmez.
  assert.deepEqual(kaynakEslestir(acilis, { fiyat: 4046, kaynak: 'swissquote', adaylar: {} }), { acilisFiyat: 4046, kapanisFiyat: 4046, kaynak: 'swissquote', karisik: false });
});
await test('fiyatCoz: elle girilen fiyat bicimleri', async () => {
  assert.equal(fiyatCoz('4046.50'), 4046.5); assert.equal(fiyatCoz('4046,5'), 4046.5); assert.equal(fiyatCoz('4046'), 4046);
  assert.equal(fiyatCoz('4.046,50'), 4046.5); assert.equal(fiyatCoz('4,046.50'), 4046.5); assert.equal(fiyatCoz('$4046.5'), 4046.5);
  for (const kotu of ['4.046', '4,046', 'abc', '', '4.046.50', '-4046', undefined]) assert.equal(fiyatCoz(kotu), null, String(kotu));
});
console.log(`\n${gecen} test gecti${process.exitCode ? ', HATALAR VAR' : ''}`);
