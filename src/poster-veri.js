/**
 * Poster sayfasina piyasa verisini biz veririz; sayfa yalnizca cizer.
 *
 * NEDEN: Poster vestaprimes.com/en/market-poster sayfasinin ekran goruntusu ve
 * sayfa veriyi tarayicidan, anahtarsiz ve CORS'a acik olmak zorunda olan
 * kaynaklardan kendisi cekiyor. Bu kaynaklar yanlis ya da bayat (bkz.
 * src/piyasa.js): "XAU/USD" aslinda PAXG token'i, EUR/USD ve DXY gunde bir kez
 * guncellenen kurlar, grafikler ABD'den erisilemeyen Binance/Yahoo.
 *
 * NASIL: Sayfa acilmadan once piyasa goruntusu alinir (src/piyasa.js). Sayfanin
 * veri istekleri Playwright ile yolda yakalanir ve o goruntuden, sayfanin
 * bekledigi bicimde yanitlanir. Sitenin koduna dokunulmaz.
 *
 * Sayfanin istekleri (kaynak: sitenin src/lib/marketData.js, posterSeries.js,
 * brentSource.js, dayOpen.js dosyalari):
 *   CoinGecko simple/price            BTC, ETH ve "pax-gold" adiyla XAU kotasyonu
 *   Binance ticker/24hr?symbol=EURUSDT  EUR/USD kotasyonu (er-api'yi ezer)
 *   open.er-api.com latest/USD        alti kur -> DXY (ICE formulu), yedek EUR/USD
 *   Supabase functions/v1/brent       Brent kotasyonu; ?symbol=X&series=1 ile
 *                                     Brent ve DXY grafik serisi
 *   Binance klines 15m x 96           BTC, ETH, XAU (PAXGUSDT), EUR grafik serisi
 *   corsproxy.io / allorigins         Yahoo yedegi (reddedilir; yalnizca Brent
 *                                     siteye birakildiysa BZ=F istekleri gecer)
 * Kotasyonlar 20 sn'de bir yeniden istenir.
 *
 * BU BAGIMLILIK KIRILGAN: site veri mantigini degistirirse yakalama ise
 * yaramaz ve sayfa yine kendi (yanlis) verisini gosterir. Bu yuzden cekimden
 * once `dogrula()` kartlarda yazan degerleri bizim verdigimizle karsilastirir;
 * tutmayan kart sessiz kalmaz, Slack mesajina not olarak duser.
 */

import { ENSTRUMANLAR } from './piyasa.js';

const CORS = { 'access-control-allow-origin': '*' };

const yanitla = (route, govde) =>
  route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(govde) });

/**
 * Sayfa DXY'yi open.er-api kurlarindan ICE formuluyle kendi hesapliyor.
 * Bacaklar elimizdeyse aynen verilir; sayfanin sonucu bizimkiyle ayni cikar.
 * DXY baska kaynaktan (CNBC) geldiyse formul o degeri versin diye JPY bacagi
 * geriye dogru cozulur. EUR bacagi gercek EUR/USD'de tutulur: sayfa EUR/USD'yi
 * de bu kurlardan okuyabiliyor.
 */
function erApiKurlari(e) {
  if (!e.DXY || !e.EURUSD) return null;
  const b = e.DXY.bacaklar;
  if (b) {
    return { USD: 1, EUR: 1 / b.EURUSD, JPY: b.USDJPY, GBP: 1 / b.GBPUSD, CAD: b.USDCAD, SEK: b.USDSEK, CHF: b.USDCHF };
  }
  const eur = e.EURUSD.fiyat;
  const jpy = (e.DXY.fiyat / (50.14348112 * eur ** -0.576)) ** (1 / 0.136);
  return { USD: 1, EUR: 1 / eur, JPY: jpy, GBP: 1, CAD: 1, SEK: 1, CHF: 1 };
}

/** Kapanis serisini Binance klines satirlarina cevirir; sayfa ilk acilisi ve kapanislari okuyor. */
function mumSatirlari(seri) {
  const simdi = Date.now();
  return seri.map((kapanis, i) => {
    const acilis = i ? seri[i - 1] : kapanis;
    const t = simdi - (seri.length - i) * 900_000;
    return [
      t,
      String(acilis),
      String(Math.max(acilis, kapanis)),
      String(Math.min(acilis, kapanis)),
      String(kapanis),
      '0',
      t + 899_999,
      '0',
      0,
      '0',
      '0',
      '0',
    ];
  });
}

const KLINES = { BTCUSDT: 'BTCUSD', ETHUSDT: 'ETHUSD', PAXGUSDT: 'XAUUSD', EURUSDT: 'EURUSD' };
const COINGECKO = { bitcoin: 'BTCUSD', ethereum: 'ETHUSD', 'pax-gold': 'XAUUSD' };

/**
 * Yakalamalari kurar. page.goto'dan once cagrilmali.
 * @param {import('playwright').Page} page
 * @param {Awaited<ReturnType<typeof import('./piyasa.js').piyasaGoruntusu>>} goruntu
 * @returns {Promise<{ dogrula: () => Promise<Array<{enstruman: string, mesaj: string, not: string, bilgi?: boolean}>>,
 *   etiketleriDuzelt: () => Promise<number> }>}
 */
export async function posterVerisiniSagla(page, goruntu) {
  const e = goruntu.enstrumanlar;

  // Sayfa, kaynagi degisim vermeyen enstrumanlarda (DXY) yuzdeyi "bu tarayicinin
  // o UTC gununde ilk gordugu fiyata gore" kendisi uretiyor ve o fiyati
  // localStorage'da tutuyor (vp:open:<ANAHTAR>:<UTC gunu>). Temiz bir tarayicida
  // ilk gorulen fiyat o anki fiyat oldugu icin 20 sn sonraki yoklamada kart
  // "%0,00" yaziyordu. O anahtarin okunmasi, sayfanin hesabi bizim degisimimizi
  // verecek taban fiyatla yanitlanir. Kaydi onceden yazmak yerine okumayi
  // yanitlamak, UTC gun donumunde sayfanin eski gun kayitlarini silmesinden
  // etkilenmez.
  const tabanlar = Object.fromEntries(
    Object.entries(e)
      .filter(([, v]) => v.degisim != null && v.degisim > -100)
      .map(([anahtar, v]) => [anahtar, v.fiyat / (1 + v.degisim / 100)]),
  );
  await page.addInitScript((taban) => {
    try {
      const asil = Storage.prototype.getItem;
      Storage.prototype.getItem = function getItem(anahtar) {
        const m = /^vp:open:([A-Z]+):\d{4}-\d{2}-\d{2}$/.exec(String(anahtar));
        return m && Object.prototype.hasOwnProperty.call(taban, m[1]) ? String(taban[m[1]]) : asil.call(this, anahtar);
      };
    } catch {
      /* olmazsa sayfa ilk turda serinin degisimine dusuyor, o da bizden geliyor */
    }
  }, tabanlar);

  // Degisimi bilinmeyen kotasyon yalnizca ILK yoklamada verilir. Sayfa o turda
  // serinin degisimini gosterir; sonraki turlarda ayni kotasyon yeniden gelirse
  // kendi "gun acilisi" farkini (hep ~%0,00) yazardi.
  let coingeckoTuru = 0;
  await page.route(/^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price\?/, (route) => {
    const ilk = coingeckoTuru++ === 0;
    const govde = {};
    for (const [id, anahtar] of Object.entries(COINGECKO)) {
      const v = e[anahtar];
      if (v && (ilk || v.degisim != null)) govde[id] = { usd: v.fiyat, usd_24h_change: v.degisim };
    }
    return yanitla(route, govde);
  });

  const tickerSatiri = (sembol, v) => ({
    symbol: sembol,
    lastPrice: String(v.fiyat),
    priceChangePercent: String(v.degisim),
  });
  await page.route(/^https:\/\/api\.binance\.com\/api\/v3\/ticker\/24hr\?/, (route) => {
    const p = new URL(route.request().url()).searchParams;
    if (p.get('symbol') === 'EURUSDT') {
      // Degisim bilinmiyorsa bu yol kapatilir; EUR/USD er-api yanitindan (ilk tur) okunur.
      return e.EURUSD?.degisim != null ? yanitla(route, tickerSatiri('EURUSDT', e.EURUSD)) : route.abort();
    }
    // CoinGecko yaniti eksik kaldiginda sayfanin dustugu yedek: ayni veri.
    const satirlar = [
      ['BTCUSDT', e.BTCUSD],
      ['ETHUSDT', e.ETHUSD],
      ['PAXGUSDT', e.XAUUSD],
    ]
      .filter(([, v]) => v && v.degisim != null)
      .map(([sembol, v]) => tickerSatiri(sembol, v));
    return yanitla(route, satirlar);
  });

  const kurlar = erApiKurlari(e);
  let erApiTuru = 0;
  await page.route(/^https:\/\/open\.er-api\.com\/v6\/latest\/USD/, (route) => {
    // Yalnizca ilk tur (bkz. yukarisi). Sayfa sonraki turlarda son bildigi degeri korur.
    if (!kurlar || erApiTuru++ > 0) return route.abort();
    return yanitla(route, { result: 'success', base_code: 'USD', rates: kurlar });
  });

  await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/brent(\?|$)/, (route) => {
    const p = new URL(route.request().url()).searchParams;
    if (p.get('series') === '1') {
      const sembol = (p.get('symbol') || 'BRENT').toUpperCase();
      const v = e[sembol];
      // Enstrumanin verisi hic yoksa (Brent) kart sitenin kendi kaynagina birakilmistir.
      if (!v) return route.continue();
      // Fiyati bizden gelen ama serisi olmayan kart: istek reddedilir ki sayfa
      // kendi gunluk yedegine dusup karta baska bir yuzde ve "2W" grafik yazmasin
      // (CNBC kesintisinde DXY boyle "%0,62 · 2W" gostermisti).
      if (!v.seri) return route.abort();
      return yanitla(route, {
        symbol: sembol,
        // Sayfa "1D" serilerine canli fiyati eklemiyor; cizgi kartta yazan
        // fiyatta bitsin diye son nokta olarak burada ekleniyor.
        series: [...v.seri, v.fiyat],
        changePct: v.degisim,
        price: v.fiyat,
        source: 'yahoo',
        at: Date.now(),
      });
    }
    // Brent verimiz yoksa sitenin kendi kaynagi (Yahoo, 10 dk gecikmeli) kullanilir.
    // Degisimi bilinmeyen kotasyon da verilmez: sayfa Brent'i bellekte tuttugu
    // icin "yalnizca ilk tur" numarasi burada islemiyor, ikinci yoklamada karta
    // kendi "%0,00"ini yaziyor (gercek sayfada denendi).
    if (!e.BRENT || e.BRENT.degisim == null) return route.continue();
    return yanitla(route, {
      price: e.BRENT.fiyat,
      changePct: e.BRENT.degisim,
      prevClose: e.BRENT.oncekiKapanis,
      source: 'yahoo',
      at: Date.now(),
    });
  });

  await page.route(/^https:\/\/api\.binance\.com\/api\/v3\/klines\?/, (route) => {
    const sembol = new URL(route.request().url()).searchParams.get('symbol');
    const seri = e[KLINES[sembol]]?.seri;
    return seri ? yanitla(route, mumSatirlari(seri)) : route.abort();
  });

  // Yahoo'ya giden CORS vekilleri: seriler yukaridan geldigi icin gerekmiyor.
  // Hemen reddedilir ki serisi olmayan kartta sayfa 8 sn beklemeden kendi son
  // yedegine (DXY icin jsDelivr) gecsin. Tek istisna: Brent verimiz yoksa kart
  // sitenin kendi zincirine birakilmistir; o zincirin son halkasi olan Brent
  // (BZ=F) vekil istekleri gecirilir.
  await page.route(/^https:\/\/(corsproxy\.io\/\?url=|api\.allorigins\.win\/raw\?url=)/, (route) =>
    !e.BRENT && /BZ(=|%3D|%253D)F/i.test(route.request().url()) ? route.continue() : route.abort(),
  );

  // Sayfanin DXY icin son yedegi: gunde bir guncellenen doviz arsivi (iki
  // haftalik grafik ve gunden gune degisim). Fiyati biz verdigimiz icin asla
  // gerekmez; acik kalirsa serisiz DXY kartina kendi yuzdesini yazar.
  await page.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@fawazahmed0\/currency-api/, (route) => route.abort());
  // Ayni sey Brent'in gunluk yedegi (Alpha Vantage, bir aylik grafik) icin:
  // Brent bizden geliyorsa kapatilir, siteye birakildiysa acik kalir.
  await page.route(/^https:\/\/www\.alphavantage\.co\/query\?/, (route) => (e.BRENT ? route.abort() : route.continue()));

  // Okuyucu notlarindaki sayilar Turkce yazilir: 4.046,10 ve −%0,75.
  const trSayi = (deger, ondalik) =>
    new Intl.NumberFormat('tr-TR', { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik }).format(deger);
  const trYuzde = (deger) => `${deger < 0 ? '−' : '+'}%${trSayi(Math.abs(deger), 2)}`;

  /**
   * Kartlarda yazan fiyat ve yuzdeyi verdigimiz degerlerle karsilastirir.
   * Sayfa fiyati `Intl.NumberFormat('en-US')` ile enstrumanin ondalik
   * sayisina, yuzdeyi mutlak deger olarak iki ondaliga yuvarliyor; yon
   * rozetin sinifinda (vpmp-pill--up/down/flat). Karsilastirma yuvarlama
   * payi kadar toleranslidir: gorunen deger gercegin yarim basamak icindedir.
   *
   * Donen kayitlarda `bilgi: true` olanlar uyusmazlik degil durum bildirimidir
   * (Brent'in sitenin kendi kaynagindan cizilmesi); `not`lari yine mesaja duser.
   */
  async function dogrula() {
    const kartlar = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.vpmp-card')).map((kart) => ({
        sembol: kart.querySelector('.vpmp-card__sym')?.textContent.trim(),
        fiyat: kart.querySelector('[class*="__price"]')?.textContent.trim(),
        bekliyor: Boolean(kart.querySelector('[class*="__price--pending"]')),
        rozet: kart.querySelector('.vpmp-pill')?.textContent.trim(),
        yon: ['up', 'down', 'flat'].find((y) => kart.querySelector(`.vpmp-pill--${y}`)) || null,
      })),
    );
    const sorunlar = [];
    for (const [anahtar, { ad, ondalik }] of Object.entries(ENSTRUMANLAR)) {
      const v = e[anahtar];
      const kart = kartlar.find((k) => k.sembol === ad);
      if (!v) {
        // Verisi olmayan enstruman zaten goruntunun sorunlarinda. Brent haric: o
        // sitenin kendi kaynagina birakildi ve sonucu ancak kart cizilince belli olur.
        if (anahtar === 'BRENT') {
          const dolu = Boolean(kart) && !kart.bekliyor;
          sorunlar.push({
            enstruman: ad,
            bilgi: true,
            mesaj: dolu
              ? `sitenin kendi kaynagindan cizildi (${kart.fiyat})`
              : 'sitenin kendi kaynagi da yanit vermedi; kart bos',
            not: dolu ? `${ad} yedek kaynaktan alındı (yaklaşık 10 dk gecikmeli)` : `${ad} için canlı veri alınamadı`,
          });
        }
        continue;
      }
      if (!kart) {
        sorunlar.push({
          enstruman: ad,
          mesaj: 'kart sayfada bulunamadi (tasarim degismis olabilir)',
          not: `${ad} kartı doğrulanamadı`,
        });
        continue;
      }
      const gorunen = kart.bekliyor ? NaN : Number(String(kart.fiyat).replace(/[^0-9.-]/g, ''));
      if (!(Math.abs(gorunen - v.fiyat) <= 0.505 * 10 ** -ondalik)) {
        sorunlar.push({
          enstruman: ad,
          mesaj:
            `kart ${kart.bekliyor ? 'bos' : kart.fiyat} gosteriyor, kaynak ${v.fiyat.toFixed(ondalik)} ` +
            '(sayfanin veri mantigi degismis olabilir)',
          not: kart.bekliyor
            ? `${ad} kartı boş kaldı`
            : `${ad} kartındaki değer kaynakla uyuşmuyor (kaynak: ${trSayi(v.fiyat, ondalik)})`,
        });
        continue;
      }
      if (v.degisim == null) {
        // Degisim de seri de vermedik: rozet "—" kalmali. Sayi gorunuyorsa sayfa
        // kendi "gun acilisi" farkini (hep ~%0,00) yazmis demektir.
        if (!v.seri && /\d/.test(kart.rozet || '')) {
          sorunlar.push({
            enstruman: ad,
            mesaj: `kartta degisim ${kart.rozet} gorunuyor, kaynakta degisim yok`,
            not: `${ad} değişim yüzdesi doğrulanamadı`,
          });
        }
        continue;
      }
      const gorunenYuzde = Number(String(kart.rozet).replace('%', ''));
      const yonTutuyor = Math.abs(v.degisim) < 0.011 || kart.yon === (v.degisim > 0 ? 'up' : 'down'); // sinirdaki degerde yon belirsiz
      if (!(Math.abs(gorunenYuzde - Math.abs(v.degisim)) <= 0.0051) || !yonTutuyor) {
        sorunlar.push({
          enstruman: ad,
          mesaj: `kartta degisim ${kart.rozet} (${kart.yon}), kaynak ${v.degisim >= 0 ? '+' : ''}${v.degisim.toFixed(2)}%`,
          not: `${ad} değişim yüzdesi kaynakla uyuşmuyor (kaynak: ${trYuzde(v.degisim)})`,
        });
      }
    }
    // Kartlarin cogu tutmuyorsa yakalama devre disi kalmis demektir (site veri
    // mantigini ya da tasarimini degistirmis): alti ayri not yerine tek not.
    const tutmayan = sorunlar.filter((s) => !s.bilgi);
    if (tutmayan.length >= 3) {
      for (const s of tutmayan) s.not = 'Posterdeki değerler kaynakla doğrulanamadı; güncel olmayabilir';
    }
    return sorunlar;
  }

  /**
   * XAU/USD ve EUR/USD kartlarinda grafik etiketini "24H"ten "1D"ye cevirir.
   *
   * Sayfa bu iki kartin serisini Binance mumlarindan bekledigi icin etiketi
   * sabit "24H" yaziyor. Bizim verdigimiz seri ve yuzde ise DXY ve Brent
   * kartlarindaki gibi gunluk (son New York kapanisindan bu yana); etiket
   * yanlis bir sure soylemesin. Seri gunluk degilse (yedek kaynak, hafta sonu)
   * etikete dokunulmaz. Etiket bulunamazsa hicbir sey degismez.
   * @returns {Promise<number>} degistirilen etiket sayisi
   */
  async function etiketleriDuzelt() {
    const adlar = ['XAUUSD', 'EURUSD'].filter((anahtar) => e[anahtar]?.seriEtiketi === '1D').map((a) => ENSTRUMANLAR[a].ad);
    if (adlar.length === 0) return 0;
    return page.evaluate((kartAdlari) => {
      let degisen = 0;
      for (const kart of document.querySelectorAll('.vpmp-card')) {
        if (!kartAdlari.includes(kart.querySelector('.vpmp-card__sym')?.textContent.trim())) continue;
        const son = kart.querySelector('.vpmp-card__meta')?.lastChild;
        if (son?.nodeType === Node.TEXT_NODE && son.textContent.trim() === '24H') {
          son.textContent = '1D';
          degisen += 1;
        }
      }
      return degisen;
    }, adlar);
  }

  return { dogrula, etiketleriDuzelt };
}
