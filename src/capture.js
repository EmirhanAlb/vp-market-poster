import { chromium } from 'playwright';
import { piyasaGoruntusu, goruntuOzeti, ENSTRUMANLAR } from './piyasa.js';
import { posterVerisiniSagla } from './poster-veri.js';

const POSTER_URL = process.env.POSTER_URL || 'https://vestaprimes.com/en/market-poster';
const POSTER_WIDTH = 1080;
const POSTER_HEIGHT = 1350;

// Fiyat ve grafik verisini sayfaya biz veriyoruz (src/piyasa.js ve
// src/poster-veri.js); sayfa yalnizca ciziyor. Fiyatlar cizilene kadar her
// fiyat alaninda "·····" ve "--pending" sinifi duruyor. Bunlarin hepsinin
// gecmesini bekliyoruz.
//
// Sinif adi tasarimla degisiyor: eski liste tasariminda vpmp-row__price,
// Ekim 2026 kart tasariminda vpmp-card__price. Ikisini de yakalamak icin
// "__price" ekine bakiyoruz. Durum rozeti (vpmp__live--live) tek basina
// yetmez: ilk fiyat gelir gelmez "LIVE" oluyor, diger kartlar hala bos.
const FIYAT = '.vpmp [class*="__price"]';
const BEKLEYEN_FIYAT = '.vpmp [class*="__price--pending"]';
const LIVE_TIMEOUT_MS = Number(process.env.LIVE_TIMEOUT_MS || 60_000);
// Cekim, fiyatlarin okunmasindan bu kadar saniyeden uzun surduyse mesaja not dusulur.
const VERI_YAS_SINIRI_SN = 45;

// Grafik gelince kartin SVG'sine path ekleniyor, gelmeden once yalnizca
// kesikli cizgi var. Serisini bizim verdigimiz kartlarin grafigi beklenir;
// veri hazir oldugu icin bu birkac saniye surer. Sinir ust sinirdir: serisi
// hic alinamamis bir kart icin beklenmez, cunku beklerken fiyatlar eskir.
const GRAFIK_BEKLEME_MS = Number(process.env.GRAFIK_BEKLEME_SN || 50) * 1000;

/**
 * market-poster sayfasini acar, fiyatlar yuklenene kadar bekler ve
 * poster kartini 1080x1350 PNG olarak diske yazar.
 *
 * @param {string} outPath PNG'nin yazilacagi dosya yolu
 * @returns {Promise<{path: string, status: string, stamp: string, live: boolean, dogrulandi: boolean,
 *   sorunlar: Array<{enstruman: string, mesaj: string, not: string|null}>}>}
 *   `sorunlar`: bayat/eksik/dogrulanamayan veri; `not`u dolu olanlar mesaja dusulur.
 */
export async function capturePoster(outPath) {
  const browser = await chromium.launch({
    args: ['--font-render-hinting=none', '--force-color-profile=srgb'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: POSTER_WIDTH, height: POSTER_HEIGHT },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: process.env.TZ_NAME || 'Europe/Istanbul',
      colorScheme: 'dark',
    });
    const page = await context.newPage();

    // Veri sayfa acilmadan hemen once okunur: sayfanin ilk yoklamasi hazir
    // yanit bulur ve cekim anindaki fiyat birkac saniyelik olur.
    const goruntu = await piyasaGoruntusu();
    console.log(`Piyasa verisi:\n${goruntuOzeti(goruntu)}`);
    for (const s of goruntu.sorunlar) console.warn(`  ${s.not ? '!' : '-'} ${s.enstruman}: ${s.mesaj}`);
    // Hicbir kaynak yanit vermediyse (ag kesik) alti bos kartlik bir poster
    // gondermenin anlami yok; bu saat atlanir, hata loga duser.
    if (Object.keys(goruntu.enstrumanlar).length === 0) {
      throw new Error('Hicbir piyasa verisi alinamadi; poster cekilmedi.');
    }
    const veri = await posterVerisiniSagla(page, goruntu);

    // Sayfanin kendi yedek kaynaklarina giden istekleri bilerek reddediyoruz
    // (src/poster-veri.js); tarayici her biri icin ayni hata satirini yaziyor.
    // Onlar sayilir, digerleri oldugu gibi loglanir.
    let reddedilen = 0;
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (/net::ERR_FAILED/.test(msg.text())) reddedilen += 1;
      else console.warn('[sayfa hatasi]', msg.text());
    });

    await page.goto(POSTER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.vpmp', { timeout: 60_000 });
    const acilis = Date.now();

    // Fiyatlarin gelmesini bekle. Gelmezse yine de poster'i cekiyoruz ama
    // "live" olmadigini raporluyoruz ki Slack mesajinda belli olsun.
    //
    // Fiyat alani hic bulunamazsa da beklemeye devam ediyoruz: tasarim sinif
    // adlarini yeniden degistirirse kontrol sessizce gecip bos kartlari
    // cekmesin, zaman asimina dussun ve Slack notunda gorunsun.
    //
    // Verisi hic alinamamis ya da sayfaya ulastirilamayan enstrumanin karti bos
    // kalacak; onu beklemek yalnizca diger kartlarin fiyatini eskitir. Brent
    // verimiz yoksa kart sitenin kendi kaynagina birakilir: dolabilir de
    // dolmayabilir de. Sayfa butun fiyatlari tek seferde yazdigi icin bizim
    // kartlar geldiginde onun sonucu da bellidir; ayrica beklenmez.
    const bosKalacak = Object.keys(ENSTRUMANLAR).filter(
      (anahtar) => !goruntu.enstrumanlar[anahtar] || veri.verilemeyen.includes(anahtar),
    ).length;
    let live = true;
    try {
      await page.waitForFunction(
        ([fiyat, bekleyen, izin]) =>
          document.querySelector('.vpmp__live--live') !== null &&
          document.querySelectorAll(fiyat).length > 0 &&
          document.querySelectorAll(bekleyen).length <= izin,
        [FIYAT, BEKLEYEN_FIYAT, bosKalacak],
        { timeout: LIVE_TIMEOUT_MS },
      );
      if (bosKalacak) console.warn(`Uyari: ${bosKalacak} kartin verisi yok ya da sayfaya verilemiyor; bos kalabilir.`);
    } catch {
      live = false;
      const [toplam, bekleyen] = await page.evaluate(
        ([fiyat, bek]) => [document.querySelectorAll(fiyat).length, document.querySelectorAll(bek).length],
        [FIYAT, BEKLEYEN_FIYAT],
      );
      console.warn(
        `Uyari: ${LIVE_TIMEOUT_MS}ms icinde tum fiyatlar gelmedi (${toplam - bekleyen}/${toplam}), mevcut haliyle cekiliyor.` +
          (toplam === 0 ? ' Fiyat alani bulunamadi: poster tasarimi sinif adlarini degistirmis olabilir.' : ''),
      );
    }

    // Grafikler susleme: gelmeyenler olursa poster yine gider, yalnizca loglanir.
    const grafikDurumu = () =>
      page.evaluate(() => {
        const svgler = Array.from(document.querySelectorAll('.vpmp-card__chart'));
        return [svgler.filter((s) => s.querySelector('path')).length, svgler.length];
      });
    const seriliKartlar = Object.entries(ENSTRUMANLAR)
      .filter(([anahtar]) => goruntu.enstrumanlar[anahtar]?.seri)
      .map(([, { ad }]) => ad);
    const grafikKalan = GRAFIK_BEKLEME_MS - (Date.now() - acilis);
    if (grafikKalan > 0 && seriliKartlar.length) {
      await page
        .waitForFunction(
          (adlar) =>
            Array.from(document.querySelectorAll('.vpmp-card'))
              .filter((kart) => adlar.includes(kart.querySelector('.vpmp-card__sym')?.textContent.trim()))
              .every((kart) => kart.querySelector('.vpmp-card__chart path')),
          seriliKartlar,
          { timeout: grafikKalan, polling: 500 },
        )
        .catch(() => {});
    }
    const [grafik, kart] = await grafikDurumu();
    console.log(`Grafikler: ${grafik}/${kart} (${((Date.now() - acilis) / 1000).toFixed(0)} sn sonra)`);
    // Grafik cizim animasyonunun bitmesi icin.
    if (grafik > 0) await page.waitForTimeout(1500);

    // Kartlarda yazanlar verdigimiz degerler mi? Site veri mantigini degistirirse
    // yakalama sessizce devre disi kalir; bunu burada yakalayip gorunur kiliyoruz.
    const dogrulama = await veri.dogrula();
    for (const s of dogrulama) console.warn(`  ${s.bilgi ? '-' : '!'} ${s.enstruman}: ${s.mesaj}`);
    const tutmayan = dogrulama.filter((s) => !s.bilgi).length;
    console.log(tutmayan ? `Dogrulama: ${tutmayan} kart tutmuyor` : 'Dogrulama: kartlar verilen degerlerle ayni');
    // Altin ve EUR/USD kartlarinin grafik etiketi verinin kapsadigi sureyi soylesin.
    await veri.etiketleriDuzelt().catch(() => 0);

    // Sayfa karti ekrana sigdirmak icin CSS transform ile kucultuyor (--s degiskeni).
    // Birebir 1080x1350 cekmek icin olcegi 1'e sabitliyoruz.
    await page.addStyleTag({
      content: `
        .vpmp-stage { padding: 0 !important; min-height: 0 !important; gap: 0 !important; }
        .vpmp-bar { display: none !important; }
        .vpmp-fitbox {
          --s: 1 !important;
          width: ${POSTER_WIDTH}px !important;
          height: ${POSTER_HEIGHT}px !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }
        .vpmp-scale { transform: none !important; }
      `,
    });

    // Fontlar ve gorseller (logo vb.) hazir olmadan cekersek eksik render riski var.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.vpmp img')).every((img) => img.complete && img.naturalWidth > 0),
      null,
      { timeout: 15_000 },
    ).catch(() => console.warn('Uyari: bazi gorseller yuklenmedi.'));

    // Layout'un oturmasi icin kisa bir soluklanma.
    await page.waitForTimeout(600);

    const card = page.locator('.vpmp');
    const box = await card.boundingBox();
    if (!box) throw new Error('Poster karti (.vpmp) sayfada bulunamadi.');
    console.log(`Kart olculeri: ${Math.round(box.width)}x${Math.round(box.height)}`);

    await card.screenshot({ path: outPath, type: 'png' });

    const status = (await page.locator('.vpmp__live').first().innerText().catch(() => '')).trim();
    const stamp = (await page.locator('.vpmp__stamp').first().innerText().catch(() => '')).trim();

    // Fiyatlar sayfa acilmadan once okundu ve o andan beri degismedi. Cekim
    // normalde birkac saniye surer; sayfa yavas yuklendiyse ya da bir grafik
    // hic cizilmediyse (beklemeler dolar) posterdeki fiyat o kadar eskidir.
    const gecenSn = Math.round((Date.now() - goruntu.an) / 1000);
    console.log(
      `Fiyatlar cekimden ${gecenSn} sn once okundu.` +
        (reddedilen ? ` Sayfanin kendi kaynaklarina giden ${reddedilen} istek reddedildi (beklenen).` : ''),
    );
    const gecikme =
      gecenSn > VERI_YAS_SINIRI_SN
        ? [{ enstruman: 'Poster', mesaj: `cekim ${gecenSn} sn surdu`, not: `Fiyatlar çekimden yaklaşık ${gecenSn} sn önce okundu` }]
        : [];

    return {
      path: outPath,
      status,
      stamp,
      live,
      // Kartlar verilen degerleri gosteriyor mu (yakalama calisiyor mu)?
      dogrulandi: tutmayan === 0,
      sorunlar: [...goruntu.sorunlar, ...dogrulama, ...gecikme],
    };
  } finally {
    await browser.close();
  }
}
