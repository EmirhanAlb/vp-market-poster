import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
import { oylamaHtml, sonucHtml, OYLAMA_BOYUT, SONUC_BOYUT, SONUC_SURE } from './kart-sablon.js';

const { GIFEncoder, quantize, applyPalette } = gifenc;

/** GIF kare hizi. 25 fps akici gorunuyor; daha fazlasi dosyayi buyutuyor. */
const FPS = 25;
/** Animasyon bittikten sonra son karenin ekranda kalma suresi (ms). */
const SON_KARE_MS = 3000;
/** Palet 255 renk; 256. indeks "degismedi" anlamina gelen saydam renk. */
const SAYDAM = 255;

async function sayfaAc(boyut, olcek) {
  const tarayici = await chromium.launch({ args: ['--font-render-hinting=none', '--force-color-profile=srgb'] });
  const sayfa = await tarayici.newPage({
    viewport: { width: boyut.genislik, height: boyut.yukseklik },
    deviceScaleFactor: olcek,
  });
  return { tarayici, sayfa };
}

async function hazirla(sayfa, html) {
  await sayfa.setContent(html, { waitUntil: 'load' });
  await sayfa.evaluate(() => document.fonts.ready);
  await sayfa.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
}

/**
 * Oylama kartini PNG olarak yazar.
 * @returns {Promise<string>} dosya yolu
 */
export async function oylamaKarti(veri, hedef) {
  const { tarayici, sayfa } = await sayfaAc(OYLAMA_BOYUT, 2);
  try {
    await hazirla(sayfa, oylamaHtml(veri));
    fs.mkdirSync(path.dirname(hedef), { recursive: true });
    await sayfa.locator('.kart').screenshot({ path: hedef, type: 'png' });
    return hedef;
  } finally {
    await tarayici.close();
  }
}

/**
 * Sonuc kartini animasyonlu GIF olarak yazar.
 *
 * Kareler tek tek yakalaniyor: animasyon her karede tam o zamana
 * sabitleniyor (bkz. sablondaki kare()), gercek zaman akmiyor. Boylece
 * yavas bir makinede de kare atlamadan ayni GIF cikiyor.
 *
 * Boyut icin iki onlem: tum kareler tek bir ortak paleti kullaniyor ve ilk
 * kareden sonra yalnizca degisen pikseller yaziliyor (gerisi saydam, onceki
 * kare yerinde kaliyor). Zemin hareketsiz oldugu icin kareler cok kucuk.
 *
 * @returns {Promise<string>} dosya yolu
 */
export async function sonucKarti(veri, hedef) {
  const { genislik: W, yukseklik: H } = SONUC_BOYUT;
  const { tarayici, sayfa } = await sayfaAc(SONUC_BOYUT, 1);
  const kareler = [];
  try {
    await hazirla(sayfa, sonucHtml(veri));
    const adim = 1000 / FPS;
    for (let t = 0; t <= SONUC_SURE + 0.5; t += adim) {
      await sayfa.evaluate((an) => window.kare(an), t);
      const png = PNG.sync.read(await sayfa.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } }));
      kareler.push(png.data);
    }
  } finally {
    await tarayici.close();
  }

  // Ortak palet: animasyonun basindan, ortasindan ve sonundan ornekler.
  const ornek = [0, Math.floor(kareler.length / 3), Math.floor((2 * kareler.length) / 3), kareler.length - 1];
  const birlesik = new Uint8Array(ornek.length * W * H * 4);
  ornek.forEach((k, i) => birlesik.set(kareler[k], i * W * H * 4));
  const palet = quantize(birlesik, 255);
  const tamPalet = [...palet];
  while (tamPalet.length < 256) tamPalet.push([0, 0, 0]);

  const gif = GIFEncoder();
  let onceki = null;
  kareler.forEach((rgba, i) => {
    const indeks = applyPalette(rgba, palet);
    const yazilacak = onceki ? indeks.slice() : indeks;
    if (onceki) {
      for (let p = 0; p < indeks.length; p++) if (indeks[p] === onceki[p]) yazilacak[p] = SAYDAM;
    }
    onceki = indeks;
    const son = i === kareler.length - 1;
    gif.writeFrame(yazilacak, W, H, {
      palette: i === 0 ? tamPalet : undefined,
      delay: son ? SON_KARE_MS : Math.round(1000 / FPS),
      transparent: i > 0,
      transparentIndex: SAYDAM,
      dispose: 1, // onceki kareyi yerinde birak
      repeat: 0,
    });
  });
  gif.finish();

  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.writeFileSync(hedef, gif.bytes());
  return hedef;
}
