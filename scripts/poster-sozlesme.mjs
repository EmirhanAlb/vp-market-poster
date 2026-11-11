// Yakalama sozlesmesi testi: GERCEK poster sayfasi + taninabilir sahte veri.
//
// src/poster-veri.js sitenin ic veri mantigina dayaniyor. Site degisirse
// yakalama sessizce ise yaramaz hale gelebilir; bu test onu dakikalar icinde
// gosterir. Sayfa sahte degerlerle (XAU 1.111,11, EUR/USD 1,2345...) acilir ve
// 10., 26. ve 46. saniyede - yani sayfanin 20 sn'lik ikinci ve ucuncu veri
// yoklamasindan sonra da - kartlarda yazanlar okunur. (Ilk okuma 10. saniyede:
// Brent siteye birakildiginda sayfa butun kartlari o yanit gelince, en gec
// ~8. saniyede yaziyor.) Iki ayri denetim yapilir:
// uretimdeki dogrula() ve ondan bagimsiz beklentiler (degisim verilmediyse rozet
// bos mu, sayfa kendi gunluk yedegine dusmus mu, grafik verdigimiz seriyle mi).
// Slack'e hicbir sey gonderilmez. Kullanim: npm run poster:sozlesme [senaryo no]
import { chromium } from 'playwright';
import { posterVerisiniSagla } from '../src/poster-veri.js';
import { dxyHesapla, ENSTRUMANLAR } from '../src/piyasa.js';

const seri = (bas, son, n = 96) => Array.from({ length: n }, (_, i) => bas + ((son - bas) * i) / (n - 1) + Math.sin(i / 3) * (son * 0.001));
const bacaklar = { EURUSD: 1.2345, USDJPY: 150.5, GBPUSD: 1.3, USDCAD: 1.4, USDSEK: 10.1, USDCHF: 0.85 };
const dxy = dxyHesapla(bacaklar);

function goruntu(degistir = (e) => e) {
  const e = {
    DXY: { fiyat: dxy, degisim: 0.21, oncekiKapanis: dxy / 1.0021, seri: seri(dxy * 0.995, dxy), bacaklar },
    BTCUSD: { fiyat: 12345.4, degisim: -3.21, oncekiKapanis: null, seri: seri(12700, 12345) },
    ETHUSD: { fiyat: 2345.67, degisim: 4.56, oncekiKapanis: null, seri: seri(2240, 2345) },
    BRENT: { fiyat: 77.77, degisim: -2.5, oncekiKapanis: 79.764, seri: seri(79.8, 77.77) },
    EURUSD: { fiyat: 1.2345, degisim: -0.45, oncekiKapanis: 1.24008, seri: seri(1.24, 1.2345) },
    XAUUSD: { fiyat: 1111.11, degisim: 1.23, oncekiKapanis: 1097.61, seri: seri(1098, 1111) },
  };
  return { an: Date.now(), kapali: false, enstrumanlar: degistir(e), sorunlar: [] };
}

const SENARYOLAR = [
  ['1 tam veri', (e) => e],
  ['2 DXY bacaksiz (CNBC degeri 99.99)', (e) => ({ ...e, DXY: { ...e.DXY, fiyat: 99.99, oncekiKapanis: 99.99 / 1.0021, bacaklar: null } })],
  // Onceki kapanis yokken piyasa.js degisimi serinin ilk degerine gore verir; burada da oyle.
  ['3 onceki kapanis bilinmiyor (CNBC kotasyonu yok)', (e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, ['BTCUSD', 'ETHUSD'].includes(k) ? v : { ...v, degisim: ((v.fiyat - v.seri[0]) / v.seri[0]) * 100, oncekiKapanis: null }]))],
  ['4 Brent ve DXY serisi yok', (e) => ({ ...e, BRENT: { ...e.BRENT, seri: null }, DXY: { ...e.DXY, seri: null } })],
  ['5 XAU ve BTC verisi yok', (e) => { const { XAUUSD, BTCUSD, ...kalan } = e; return kalan; }],
  // Ne onceki kapanis ne seri: rozet bos (—) kalmali; sonraki yoklamalarda "%0,00"a donmemeli,
  // sayfa kendi gunluk yedegine dusup baska bir yuzde ve "2W" grafik yazmamali.
  ['6 XAU, EUR ve DXY: degisim de seri de yok', (e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, ['XAUUSD', 'EURUSD', 'DXY'].includes(k) ? { ...v, degisim: null, oncekiKapanis: null, seri: null } : v]))],
  // Brent verimiz yok: kart sitenin kendi kaynagina birakilir; diger bes kart bizim degerlerimizi gostermeli.
  ['7 Brent verisi yok (siteye birakilir)', (e) => { const { BRENT, ...kalan } = e; return kalan; }],
  // Brent bizde ama serisi yok: sayfa kendi Brent grafik yedegine dusmemeli.
  ['8 Brent serisi yok, DXY degisimsiz ve serisiz', (e) => ({ ...e, BRENT: { ...e.BRENT, seri: null }, DXY: { ...e.DXY, degisim: null, oncekiKapanis: null, seri: null } })],
  // CNBC tamamen yokken piyasa.js'in urettigi goruntu: Brent yok, DXY ve XAU degisimsiz ve serisiz.
  ['9 CNBC kesintisi: Brent yok, DXY ve XAU degisimsiz ve serisiz', (e) => { const { BRENT, ...kalan } = e; return { ...kalan, DXY: { ...e.DXY, degisim: null, oncekiKapanis: null, seri: null }, XAUUSD: { ...e.XAUUSD, degisim: null, oncekiKapanis: null, seri: null } }; }],
];
const secim = process.argv[2] ? SENARYOLAR.filter(([ad]) => ad.startsWith(process.argv[2])) : SENARYOLAR;

const tarayici = await chromium.launch();
let basarisiz = 0;
await Promise.all(
  secim.map(async ([ad, degistir]) => {
    const g = goruntu(degistir);
    const baglam = await tarayici.newContext({ viewport: { width: 1080, height: 1350 }, locale: 'en-US', timezoneId: 'Europe/Istanbul', colorScheme: 'dark' });
    const sayfa = await baglam.newPage();
    const veri = await posterVerisiniSagla(sayfa, g);
    const t0 = Date.now();
    await sayfa.goto('https://vestaprimes.com/en/market-poster', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sayfa.waitForSelector('.vpmp', { timeout: 60_000 });
    const satirlar = [`\n## ${ad}`];
    for (const sn of [10, 26, 46]) {
      await sayfa.waitForTimeout(Math.max(0, sn * 1000 - (Date.now() - t0)));
      const kartlar = await sayfa.evaluate(() =>
        Array.from(document.querySelectorAll('.vpmp-card')).map((k) => ({
          ad: k.querySelector('.vpmp-card__sym')?.textContent.trim(),
          fiyat: k.querySelector('[class*="__price"]')?.textContent.trim(),
          bos: Boolean(k.querySelector('[class*="__price--pending"]')),
          yon: ['up', 'down', 'flat'].find((y) => k.querySelector(`.vpmp-pill--${y}`)) || '?',
          rozet: k.querySelector('.vpmp-pill')?.textContent.trim() || '',
          etiket: k.querySelector('.vpmp-card__meta')?.textContent.trim().replace(/^.*?(24H|1D|2W|1M)?$/, '$1') || '-',
          grafik: Boolean(k.querySelector('.vpmp-card__chart path')),
        })),
      );
      const canli = await sayfa.evaluate(() => document.querySelector('.vpmp__live')?.className.replace('vpmp__live ', ''));
      const bulgular = await veri.dogrula();
      const sorunlar = bulgular.filter((s) => !s.bilgi).map((s) => `${s.enstruman} ${s.mesaj}`);
      // dogrula()'dan bagimsiz beklentiler.
      for (const [anahtar, { ad: kartAdi }] of Object.entries(ENSTRUMANLAR)) {
        const v = g.enstrumanlar[anahtar];
        const k = kartlar.find((x) => x.ad === kartAdi);
        if (!k) { sorunlar.push(`${kartAdi} karti sayfada yok`); continue; }
        if (!v) {
          // Verisi olmayan kart bos kalmali (Brent haric: sitenin kendi kaynagindan dolabilir).
          if (anahtar !== 'BRENT' && !k.bos) sorunlar.push(`${kartAdi}: veri verilmedi ama kart ${k.fiyat} gosteriyor`);
          continue;
        }
        if (v.degisim == null && /\d/.test(k.rozet)) sorunlar.push(`${kartAdi}: degisim verilmedi ama rozet ${k.rozet}`);
        if (['2W', '1M'].includes(k.etiket)) sorunlar.push(`${kartAdi}: sayfa kendi gunluk yedegine dusmus (${k.etiket})`);
        if (sn >= 26 && Boolean(v.seri) !== k.grafik) sorunlar.push(`${kartAdi}: grafik ${k.grafik ? 'var' : 'yok'}, seri ${v.seri ? 'verildi' : 'verilmedi'}`);
      }
      if (sorunlar.length) basarisiz += 1;
      satirlar.push(`  t=${sn}sn  rozet=${canli}  denetim=${sorunlar.length ? 'TUTMUYOR: ' + sorunlar.join(' ;; ') : 'tamam'}`);
      for (const b of bulgular.filter((s) => s.bilgi)) satirlar.push(`      (bilgi) ${b.enstruman}: ${b.mesaj}  ->  "${b.not}"`);
      for (const k of kartlar) satirlar.push(`      ${[k.ad, k.fiyat, `${k.yon} ${k.rozet}`, k.etiket, k.grafik ? 'grafik' : 'GRAFIK-YOK'].join(' | ')}`);
    }
    console.log(satirlar.join('\n'));
    await baglam.close();
  }),
);
await tarayici.close();
console.log(`\nDXY beklenen (bacaklardan): ${dxy.toFixed(4)}`);
console.log(basarisiz ? `SONUC: ${basarisiz} anda denetim tutmadi` : 'SONUC: tum senaryolarda denetimler tamam');
process.exit(basarisiz ? 1 : 0);
