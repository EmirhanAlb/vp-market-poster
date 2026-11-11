/**
 * Slack'e giden icerigin Telegram kanallarina da gonderilmesi.
 *
 * Her akis kendi hedef degiskeniyle acilir; hedef tanimli degilse hicbir sey
 * gonderilmez ve mevcut Slack akisi hic degismez. Boylece Telegram'i akis akis
 * ve kanal kanal devreye alabiliyoruz.
 *
 * Hedef cozumleme (tek bot / coklu bot yazimlari) targets.js icinde.
 *
 * KURAL: Telegram kanallari ayri bir marka. Buradan cikan hicbir mesajda
 * "Vestaprime" adi, vestaprimes.com bagi veya baska bir marka izi
 * BULUNMAYACAK. Yeni bir mesaj bicimi eklerken bunu kontrol edin - client.js
 * icindeki koruma son savunma hatti, ilk savunma buradaki dikkat.
 */

import { mesajGonder, fotografGonder, kacir } from './client.js';
import { hedefler } from './targets.js';

const KATEGORI_EMOJI = {
  Ekonomi: '📊',
  Emtia: '🛢️',
  Döviz: '💱',
  Kripto: '🪙',
  Borsa: '📈',
};

async function hepsineGonder(akis, html, secenekler) {
  const liste = hedefler(akis);
  if (liste.length === 0) return 0;
  let basarili = 0;
  for (const { token, chatId } of liste) {
    if (await mesajGonder(token, chatId, html, secenekler)) basarili += 1;
  }
  return basarili;
}

/** Son Dakika haberi. */
export async function haberGonder({ baslik, kategori, kaynak, saat, link }) {
  const emoji = KATEGORI_EMOJI[kategori] || '📰';
  const html =
    `🚨 <b>SON DAKİKA</b>\n\n` +
    `<b>${kacir(baslik)}</b>\n\n` +
    `${emoji} ${kacir(kategori)} · ${kacir(kaynak)} · ${kacir(saat)}` +
    (link ? `\n<a href="${kacir(link)}">Habere git</a>` : '');
  return hepsineGonder('news', html);
}

/**
 * FinancialJuice ham akis basligi.
 *
 * Kaynak bagi bilerek YOK: bag kaynagin kendi Telegram kanalina gidiyordu ve
 * bizim kanallarimizin abonelerini oraya yonlendiriyordu. Isim (FinancialJuice)
 * atif olarak kaliyor, tiklanabilir bag kalmiyor.
 */
export async function juiceGonder({ metin, saat, cevrildi = true }) {
  const html =
    `⚡ ${kacir(metin)}\n\n` +
    `<i>FinancialJuice · ${kacir(saat)}</i>` +
    (cevrildi ? '' : ' · <i>çeviri yapılamadı</i>');
  return hepsineGonder('juice', html);
}

/**
 * Piyasa posteri (gorsel).
 *
 * UYARI: Poster GORSELININ KENDISINDE logo ve "vestaprimes.com" yazisi var -
 * bu metinden temizlenemez. Marka gecmemesi gereken bir kanala poster
 * gondermeyin; hedefi bos birakin veya markasiz bir gorsel uretin.
 */
export async function posterGonder({ dosyaYolu, saat, canli = true, notlar = [] }) {
  const liste = hedefler('poster');
  if (liste.length === 0) return 0;
  const aciklama =
    `📈 <b>Canlı Piyasalar</b> · ${kacir(saat)}` +
    (canli ? '' : '\n<i>Fiyatlar canlı akışa geçmeden yakalandı.</i>') +
    (notlar.length ? `\n<i>Not: ${kacir(notlar.join(' · '))}</i>` : '');
  let basarili = 0;
  for (const { token, chatId } of liste) {
    if (await fotografGonder(token, chatId, dosyaYolu, aciklama)) basarili += 1;
  }
  return basarili;
}

/** Gunun tahmini oylamasi - sonuc duyurusu (Telegram'da oylama yok, ozet gider). */
export async function oylamaSonucGonder({ acilis, kapanis, degisim, yonEtiket, sert }) {
  const isaret = degisim > 0 ? '+' : '';
  const html =
    `${sert ? '🚨' : '🏁'} <b>SONUÇ — Altın (XAU/USD)</b>\n\n` +
    `Açılış: <b>$${kacir(acilis)}</b> → 1 saat sonra: <b>$${kacir(kapanis)}</b>\n` +
    `Değişim: <b>${isaret}${degisim.toFixed(2)}%</b> → <b>${kacir(yonEtiket)}</b>` +
    (sert ? ' <i>(sert hareket)</i>' : '');
  return hepsineGonder('poll', html);
}
