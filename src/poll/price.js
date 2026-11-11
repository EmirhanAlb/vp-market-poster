/**
 * Oylamanin altin (XAU/USD) fiyati: gercek SPOT.
 *
 * Eskiden zincir Binance PAXG -> CoinGecko PAXG -> Yahoo GC=F idi ve her
 * cagrida bastan deneniyordu. Ucu de spot degil: PAXG altin token'i (Kasim
 * 2026'nin ilk 11 gununde spotun 31 $ altindan 22 $ ustune kadar gezdi), GC=F
 * vadeli kontrat (primi vadeye gore degisir; 11.11.2026'da spotun ~12 $ ustu).
 * Hangisinin okundugu kaydedilmedigi icin gecmis sonuclarin hangi
 * enstrumandan ciktigi bilinmiyor. Ayni gunun acilisi bir kaynaktan, kapanisi
 * digerinden gelseydi yarim puani asan sahte bir hareket ilan edilirdi
 * ("duragan" bandi %0,15).
 *
 * Artik uc ayri spot kaynagi (Swissquote, CNBC, gold-api.com) birlikte
 * okunuyor; bkz. src/piyasa.js. `kaynakEslestir()`
 * acilis ve kapanisi ayni kaynaktan eslestirir.
 */

import { spotAltin } from '../piyasa.js';

const uyu = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Guncel spot altin fiyati.
 *
 * `denemeSn` verilirse fiyat taze degilken ya da hic okunamazken o sure
 * boyunca `aralikSn` arayla yeniden denenir. Tek seferlik okuma, runner
 * tarafindaki birkac saniyelik bir ag kesintisinde gunun oylamasini
 * kaybettirirdi. Sure dolunca eldeki son (bayat) deger doner; hic
 * okunamadiysa son hata firlatilir.
 *
 * @param {{denemeSn?: number, aralikSn?: number, bildir?: (neden: string, deneme: number) => void}} [secenekler]
 * @returns {Promise<{fiyat: number, kaynak: string, zaman: number|null, yasSn: number|null, taze: boolean,
 *   adaylar: Record<string, number>, yaslar: Record<string, number|null>, notlar: string[], hatalar: string[]}>}
 *   `adaylar`: o an taze olup digerleriyle uyusan kaynaklarin fiyati (kaynak -> fiyat).
 */
export async function altinFiyati({ denemeSn = 0, aralikSn = 15, bildir = () => {} } = {}) {
  const bitis = Date.now() + denemeSn * 1000;
  let son = null;
  let sonHata = null;
  for (let deneme = 1; ; deneme++) {
    try {
      const f = await spotAltin();
      if (f.taze) return f;
      son = f;
      bildir(`taze degil (${f.kaynak}, ${f.yasSn ?? '?'} sn once)`, deneme);
    } catch (err) {
      sonHata = err;
      bildir(err?.message || String(err), deneme);
    }
    if (Date.now() + aralikSn * 1000 > bitis) break;
    await uyu(aralikSn * 1000);
  }
  if (son) return son;
  throw sonHata;
}

/**
 * Acilis ve kapanis fiyatini AYNI kaynaktan eslestirir.
 *
 * Kaynaklar ayni piyasayi gosterse de aralarinda 1-2 $ fark olabiliyor;
 * "duragan" bandi (%0,15, ~6 $) dar oldugu icin acilis ve kapanis farkli
 * kaynaklardan alinirsa sinirdaki bir sonuc ters donebilir. Once acilista
 * secilen kaynak, o kapanista yoksa iki ucta da bulunan ilk kaynak kullanilir.
 * Ortak kaynak yoksa secilen degerler kullanilir ve `karisik` isaretlenir.
 *
 * Her ucta bakilan degerler: o an taze olup digerleriyle uyusan kaynaklar
 * (`adaylar`; sapan diye elenen kaynak burada yer almaz) ve ucun kendi
 * sectigi kaynak. Secilen kaynak bayat olsa da eslestirmeye girer; bayatligi
 * tazelik kontrolu ayrica bildirir.
 *
 * @param {{fiyat: number, kaynak?: string|null, adaylar?: Record<string, number>}} acilis
 * @param {{fiyat: number, kaynak: string, adaylar?: Record<string, number>}} kapanis
 * @returns {{acilisFiyat: number, kapanisFiyat: number, kaynak: string, karisik: boolean}}
 */
export function kaynakEslestir(acilis, kapanis) {
  const acilisAdaylari = { ...(acilis.adaylar || {}) };
  if (acilis.kaynak) acilisAdaylari[acilis.kaynak] = acilis.fiyat;
  const kapanisAdaylari = { ...(kapanis.adaylar || {}) };
  if (kapanis.kaynak) kapanisAdaylari[kapanis.kaynak] = kapanis.fiyat;
  const sira = [acilis.kaynak, ...Object.keys(acilisAdaylari)].filter(Boolean);
  for (const kaynak of sira) {
    const a = acilisAdaylari[kaynak];
    const b = kapanisAdaylari[kaynak];
    if (a > 0 && b > 0) return { acilisFiyat: a, kapanisFiyat: b, kaynak, karisik: false };
  }
  return {
    acilisFiyat: acilis.fiyat,
    kapanisFiyat: kapanis.fiyat,
    kaynak: `${acilis.kaynak || 'bilinmiyor'} -> ${kapanis.kaynak}`,
    karisik: true,
  };
}

/**
 * Elle girilen fiyati cozer: "4046.50", "4046,5", "4.046,50", "4,046.50", "$4046".
 * Tek ayracli ve uc haneli kusuratli girdi ("4.046") binlik mi ondalik mi
 * belli olmadigi icin reddedilir. Cozulemezse null.
 */
export function fiyatCoz(metin) {
  const s = String(metin ?? '')
    .trim()
    .replace(/^\$/, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const nokta = s.lastIndexOf('.');
  const virgul = s.lastIndexOf(',');
  let sade = s;
  if (nokta >= 0 && virgul >= 0) {
    const ondalik = nokta > virgul ? '.' : ',';
    const binlik = ondalik === '.' ? ',' : '.';
    if (s.split(ondalik).length > 2) return null;
    sade = s.split(binlik).join('').replace(ondalik, '.');
  } else if (nokta >= 0 || virgul >= 0) {
    const parcalar = s.split(nokta >= 0 ? '.' : ',');
    if (parcalar.length > 2 || parcalar[1].length === 3) return null;
    sade = `${parcalar[0]}.${parcalar[1]}`;
  }
  const n = Number(sade);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 1.234,56 bicimi. */
export function fiyatYaz(deger) {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(deger);
}
