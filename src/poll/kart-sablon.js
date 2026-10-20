import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Gunun Tahmini kartlarinin HTML/CSS sablonlari.
 *
 * Gorsel dil vestaprimes.com/en/market-poster'dan alindi: koyu sicak zemin,
 * ince + kalin italik buyuk harf baslik, alt kenarinda renkli parilti olan
 * cam kartlar, turuncu site imzasi. Renk yonu anlatir: yukari yesil, asagi
 * kirmizi, duragan turuncu (poster'deki kart renkleriyle ayni).
 *
 * Yazi tipi: poster SF Pro Display kullaniyor ama lisansi dagitima izin
 * vermiyor. Inter (OFL) ona en yakin acik yazi tipi ve pakette geliyor; boylece
 * kart Mac'te ve GitHub'in Linux makinesinde birebir ayni cikiyor.
 *
 * Kaynaklar (logo, yazi tipi) data: URI olarak gomuluyor: sayfa setContent ile
 * aciliyor ve about:blank kokenli bir sayfa file:// kaynak yukleyemez.
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

function dataUri(dosya, tur) {
  return `data:${tur};base64,${fs.readFileSync(dosya).toString('base64')}`;
}

let kaynaklar;
function kaynak() {
  if (kaynaklar) return kaynaklar;
  const font = (ad) => dataUri(require.resolve(`@fontsource-variable/inter/files/${ad}.woff2`), 'font/woff2');
  kaynaklar = {
    logoYatay: dataUri(path.join(rootDir, 'assets/kart/vestaprime-yatay-beyaz.png'), 'image/png'),
    logoV: dataUri(path.join(rootDir, 'assets/kart/vestaprime-v.png'), 'image/png'),
    fontlar: `
      @font-face { font-family: 'Kart'; font-style: normal; font-weight: 100 900;
        src: url(${font('inter-latin-opsz-normal')}) format('woff2');
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
      @font-face { font-family: 'Kart'; font-style: normal; font-weight: 100 900;
        src: url(${font('inter-latin-ext-opsz-normal')}) format('woff2');
        unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
      @font-face { font-family: 'Kart'; font-style: italic; font-weight: 100 900;
        src: url(${font('inter-latin-opsz-italic')}) format('woff2');
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
      @font-face { font-family: 'Kart'; font-style: italic; font-weight: 100 900;
        src: url(${font('inter-latin-ext-opsz-italic')}) format('woff2');
        unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }`,
  };
  return kaynaklar;
}

/** Yon -> parilti rengi (RGB uclusu) ve okunur metin rengi. */
export const YONLER = {
  yukari: { etiket: 'YUKARI', parilti: '46 214 128', metin: '#7cf0ac' },
  asagi: { etiket: 'AŞAĞI', parilti: '255 70 92', metin: '#ff7a8b' },
  duragan: { etiket: 'DURAĞAN', parilti: '255 132 46', metin: '#ffaa6e' },
};

const IKONLAR = {
  yukari: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  asagi: '<path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/>',
  duragan: '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/>',
};

function ikon(yon, sinif = 'ikon') {
  return `<svg class="${sinif}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IKONLAR[yon]}</svg>`;
}

const kacis = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** 0.4213 -> "+%0,42" (Turkce yazim). */
export function yuzdeYaz(deger, isaretli = true) {
  const mutlak = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(deger),
  );
  const isaret = !isaretli ? '' : deger > 0 ? '+' : deger < 0 ? '−' : '';
  return `${isaret}%${mutlak}`;
}

const fiyatYaz = (f) =>
  `$${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(f)}`;

const tarihUzun = (t) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).format(t);

const saatYaz = (t) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);

// Poster'deki cam kart ve zemin; iki kart turu de kullaniyor.
function ortakStil() {
  return `
    ${kaynak().fontlar}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #0d0a08; }
    body { font-family: 'Kart', sans-serif; color: #f6f3f0; -webkit-font-smoothing: antialiased; }
    .kart { position: relative; overflow: hidden; background: #0d0a08; isolation: isolate; }
    .zemin { position: absolute; inset: 0; z-index: -2;
      background:
        radial-gradient(55% 70% at 4% 0%, rgba(255, 112, 40, .42) 0%, rgba(255, 112, 40, 0) 70%),
        radial-gradient(45% 60% at 100% 8%, rgba(170, 60, 30, .32) 0%, rgba(170, 60, 30, 0) 70%),
        radial-gradient(70% 60% at 85% 110%, rgba(120, 45, 25, .45) 0%, rgba(120, 45, 25, 0) 70%),
        linear-gradient(160deg, #24150e 0%, #120c09 48%, #0b0807 100%); }
    .cam { position: relative; border-radius: 30px;
      background:
        radial-gradient(60% 50% at 0% 0%, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 70%),
        radial-gradient(52% 26% at 50% 104%, rgba(255,255,255,.42) 0%, rgba(255,255,255,0) 70%),
        radial-gradient(78% 52% at 50% 112%, rgb(var(--p)) 0%, rgb(var(--p) / .62) 30%, rgb(var(--p) / .16) 62%, rgb(var(--p) / 0) 82%),
        linear-gradient(0deg, rgb(var(--p) / .3) 0%, rgb(var(--p) / .06) 34%, rgb(var(--p) / 0) 52%),
        linear-gradient(rgba(40,35,32,.74) 0%, rgba(19,16,15,.84) 55%, rgba(12,10,9,.9) 100%);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,.12), inset 0 0 0 1px rgba(255,255,255,.06),
        inset 0 -3px 0 rgb(var(--p) / .95), inset 0 -30px 36px -26px rgb(var(--p) / .9),
        0 30px 56px -26px rgb(var(--p) / .7), 0 22px 48px rgba(0,0,0,.4); }
    .baslik { font-style: italic; text-transform: uppercase; line-height: .92; white-space: nowrap; }
    .baslik .ince { font-weight: 300; color: rgba(255,255,255,.9); letter-spacing: -.02em; }
    .baslik .kalin { font-weight: 800; color: #fff; letter-spacing: -.025em; }
    .site { font-weight: 700; color: #ff9a52; letter-spacing: .005em; }
  `;
}

// Poster'deki ince taneli dokunun hafif bir esi. Yalnizca PNG kartta: GIF'te
// her karede degisen gurultu dosyayi katlarca buyuturdu.
const DOKU = `<svg class="doku" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><filter id="d"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#d)"/></svg>`;

// --- OYLAMA KARTI (PNG) ------------------------------------------------------

export const OYLAMA_BOYUT = { genislik: 1200, yukseklik: 675 };

/**
 * @param {{ tarih: Date, fiyat: number, paylasAni: Date, acilisAni: Date, sonucAni: Date, bant: number }} v
 */
export function oylamaHtml(v) {
  const { genislik: W, yukseklik: H } = OYLAMA_BOYUT;
  const bant = yuzdeYaz(v.bant, false);
  const secenekler = [
    // Kurallar ek almadan yaziliyor: "%0,15'ten" / "%0,20'den" gibi ekler
    // bant degerine gore degisirdi.
    { yon: 'yukari', kural: `Değişim +${bant} üzerinde` },
    { yon: 'asagi', kural: `Değişim −${bant} altında` },
    { yon: 'duragan', kural: `Değişim ±${bant} içinde` },
  ];
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    ${ortakStil()}
    .kart { width: ${W}px; height: ${H}px; padding: 46px 48px 40px; display: flex; flex-direction: column; }
    .doku { position: absolute; inset: 0; z-index: -1; opacity: .07; mix-blend-mode: overlay; }
    .ust { display: flex; justify-content: space-between; align-items: flex-start; }
    .baslik { font-size: 76px; }
    .meta { display: flex; align-items: center; gap: 18px; margin-top: 16px; font-size: 22px; }
    .tarih { display: flex; align-items: center; gap: 10px; font-style: italic; font-weight: 300; color: rgba(255,255,255,.78); }
    .tarih svg { width: 24px; height: 24px; color: #ff9a52; }
    .ayrac { width: 1px; height: 26px; background: rgba(255,255,255,.18); }
    .acik { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; letter-spacing: .18em; color: #eafff1; }
    .acik i { width: 10px; height: 10px; border-radius: 50%; background: #3be38a; box-shadow: 0 0 0 4px rgba(59,227,138,.18), 0 0 14px rgba(59,227,138,.9); }
    .logo { width: 236px; margin-top: 10px; }
    .soru { margin-top: 30px; font-size: 31px; font-weight: 500; line-height: 1.3; color: rgba(255,255,255,.86); letter-spacing: -.01em; }
    .soru b { font-weight: 700; color: #fff; }
    .secenekler { list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 28px; }
    .secenek { height: 186px; padding: 28px 26px 0; }
    .secenek .ust-satir { display: flex; align-items: center; gap: 16px; }
    .secenek .ikon-kutu { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center;
      background: rgb(var(--p) / .16); box-shadow: inset 0 0 0 1px rgb(var(--p) / .45); color: var(--m); }
    .secenek .ikon { width: 30px; height: 30px; }
    .secenek b { font-size: 36px; font-weight: 800; font-style: italic; letter-spacing: -.02em; }
    .secenek .kural { margin-top: 18px; font-size: 21px; font-weight: 500; color: rgba(255,255,255,.8); }
    .ipucu { margin-top: 30px; display: flex; align-items: center; gap: 12px; font-size: 19px; font-weight: 500; color: rgba(255,255,255,.62); }
    .ipucu .mini { display: flex; gap: 6px; }
    .ipucu .mini span { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: rgb(var(--p) / .16); box-shadow: inset 0 0 0 1px rgb(var(--p) / .45); color: var(--m); }
    .ipucu .mini svg { width: 17px; height: 17px; }
    .ipucu b { color: rgba(255,255,255,.9); font-weight: 600; }
    .alt { margin-top: auto; display: flex; align-items: center; justify-content: space-between; font-size: 21px; }
    .fiyat { display: flex; align-items: center; gap: 14px; }
    .au { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font: 600 18px Georgia, serif; color: #6b4a06;
      background: radial-gradient(circle at 35% 30%, #fff2b0 0%, #f2c94c 45%, #b8860b 100%); box-shadow: inset 0 -2px 4px rgba(0,0,0,.25); }
    .fiyat small { display: block; font-size: 16px; color: rgba(255,255,255,.6); font-weight: 500; }
    .fiyat strong { font-size: 28px; font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .akis { display: flex; align-items: center; gap: 14px; color: rgba(255,255,255,.7); font-weight: 500; }
    .akis span b { color: #fff; font-weight: 700; margin-right: 6px; font-variant-numeric: tabular-nums; }
    .akis i { width: 34px; height: 2px; background: repeating-linear-gradient(90deg, rgba(255,154,82,.8) 0 4px, transparent 4px 9px); }
    .site { font-size: 23px; }
  </style></head><body>
  <div class="kart">
    <div class="zemin"></div>${DOKU}
    <header class="ust">
      <div>
        <h1 class="baslik"><span class="ince">Günün</span> <span class="kalin">Tahmini</span></h1>
        <p class="meta">
          <span class="tarih"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>${kacis(tarihUzun(v.tarih))}</span>
          <span class="ayrac"></span>
          <span class="acik"><i></i>OYLAMA AÇIK</span>
        </p>
      </div>
      <img class="logo" src="${kaynak().logoYatay}" alt="">
    </header>
    <p class="soru">Altın <b>(XAU/USD)</b>, ABD açılışından sonraki <b>1 saatte</b> nasıl seyreder?</p>
    <ul class="secenekler">
      ${secenekler
        .map(({ yon, kural }) => {
          const y = YONLER[yon];
          return `<li class="cam secenek" style="--p: ${y.parilti}; --m: ${y.metin}">
            <div class="ust-satir"><span class="ikon-kutu">${ikon(yon)}</span><b>${y.etiket}</b></div>
            <p class="kural">${kacis(kural)}</p>
          </li>`;
        })
        .join('')}
    </ul>
    <p class="ipucu">
      <span class="mini">${['yukari', 'asagi', 'duragan'].map((yon) => `<span style="--p: ${YONLER[yon].parilti}; --m: ${YONLER[yon].metin}">${ikon(yon, '')}</span>`).join('')}</span>
      <span>Oy vermek için mesajın altındaki <b>tepkilerden birine</b> tıklayın · Tek seçenek geçerli</span>
    </p>
    <footer class="alt">
      <div class="fiyat"><span class="au">Au</span><div><small>Şu anki fiyat</small><strong>${fiyatYaz(v.fiyat)}</strong></div></div>
      <div class="akis">
        <span><b>${saatYaz(v.paylasAni)}</b>Oylama</span><i></i>
        <span><b>${saatYaz(v.acilisAni)}</b>ABD açılışı</span><i></i>
        <span><b>${saatYaz(v.sonucAni)}</b>Sonuç</span>
      </div>
      <span class="site">vestaprimes.com</span>
    </footer>
  </div></body></html>`;
}

// --- SONUC KARTI (GIF) -------------------------------------------------------

export const SONUC_BOYUT = { genislik: 800, yukseklik: 450 };
/** Animasyon suresi (ms). Son kare GIF'te ayrica bekletilir. */
export const SONUC_SURE = 3200;

/** Tohumlu, tekrarlanabilir rastgele sayi: ayni sonuc her seferinde ayni GIF'i uretir. */
function tohumlu(tohum) {
  let s = tohum >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Yonu anlatan sahte fiyat cizgisi (dekor; gercek veri degil). */
function cizgiYolu(yon, W, ust, alt, tohum) {
  const r = tohumlu(tohum);
  const n = 34;
  const orta = (ust + alt) / 2;
  const genlik = (alt - ust) / 2;
  const hedef = { yukari: -0.85, asagi: 0.85, duragan: 0 }[yon];
  const noktalar = [];
  let sapma = 0;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    sapma = sapma * 0.55 + (r() - 0.5) * (yon === 'duragan' ? 0.5 : 0.42);
    const y = orta + genlik * (hedef * k * k * (3 - 2 * k) + sapma);
    noktalar.push([Math.round(k * W), Math.round(Math.max(ust - 10, Math.min(alt + 10, y)))]);
  }
  return noktalar;
}

/**
 * @param {{ tur: 'kazanan'|'kimse'|'oysuz', tarih: Date, yon: string, degisim: number,
 *   acilisFiyat: number, kapanisFiyat: number, kazananSayisi: number, oySayisi: number,
 *   sert: boolean, sonrakiGun: string, sonrakiSaat: string }} v
 */
export function sonucHtml(v) {
  const { genislik: W, yukseklik: H } = SONUC_BOYUT;
  const y = YONLER[v.yon];
  const tohum = Math.round(Math.abs(v.degisim) * 1000) + v.oySayisi * 7 + 1;

  const metin = {
    kazanan: {
      baslik: v.sert ? 'TAM İSABET!' : 'TEBRİKLER!',
      alt: `Doğru bilen: <b>${v.kazananSayisi} kişi</b> · Toplam oy: <b>${v.oySayisi}</b>`,
    },
    kimse: {
      baslik: 'KİMSE BİLEMEDİ',
      alt: `${v.sert ? 'Sert hareket' : 'Piyasa'} bugün herkesi şaşırttı · Sıradaki oylama: <b>${kacis(v.sonrakiGun)} ${kacis(v.sonrakiSaat)}</b>`,
    },
    oysuz: {
      baslik: 'BUGÜN OY YOKTU',
      alt: `Sıradaki oylama: <b>${kacis(v.sonrakiGun)} ${kacis(v.sonrakiSaat)}</b> · Tahmininizi bekliyoruz`,
    },
  }[v.tur];

  // Cizgi alt bantta: baslik ve alt yazinin arkasindan gecip okunurlugu bozmasin.
  const cizgi = cizgiYolu(v.yon, W, 322, 422, tohum);
  const yol = cizgi.map(([x, yy], i) => `${i ? 'L' : 'M'}${x} ${yy}`).join(' ');
  const [sonX, sonY] = cizgi[cizgi.length - 1];

  const konfeti = v.tur === 'kazanan' ? (v.sert ? 150 : 90) : 0;
  const renkler = JSON.stringify([`rgb(${y.parilti})`, '#ff9a52', '#ffffff', '#ffd36b', `rgb(${y.parilti})`]);

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    ${ortakStil()}
    .kart { width: ${W}px; height: ${H}px; --p: ${y.parilti}; --m: ${y.metin}; }
    .yer-isigi { position: absolute; left: 50%; bottom: -260px; width: 900px; height: 480px; transform: translateX(-50%); z-index: -1;
      background: radial-gradient(closest-side, rgb(var(--p) / .38), rgb(var(--p) / .12) 55%, rgb(var(--p) / 0)); }
    /* ILK KARE = SON KARE = EKSIKSIZ KART. Slack, mesaja gomulu GIF'in yalnizca
       ilk karesini gosteriyor (oynatmak icin tiklamak gerekiyor); kart orada da
       tam okunmali. Bu yuzden hicbir icerik bos sahneden dogmuyor: hareketler
       (halka, isik, nabiz, parilti, konfeti) hazir kartin ustunde oynayip ayni
       kareye donuyor. Dongu de boylece kesintisiz. */
    .cizgi { position: absolute; inset: 0; z-index: -1; }
    .kuyruk { stroke-dasharray: 140 1000; animation: kuyruk 1500ms cubic-bezier(.45,.05,.3,1) 200ms both; }
    @keyframes kuyruk { from { stroke-dashoffset: 140; } to { stroke-dashoffset: -1000; } }
    .uc-nabiz { transform-box: fill-box; transform-origin: center; animation: nabiz 900ms ease-out 1550ms both; }
    @keyframes nabiz { 0% { opacity: 0; transform: scale(1); } 12% { opacity: .9; } 100% { opacity: 0; transform: scale(3.4); } }
    .ust { position: absolute; top: 26px; left: 32px; right: 32px; display: flex; justify-content: space-between; align-items: center;
      font-size: 15px; font-weight: 700; letter-spacing: .16em; color: rgba(255,255,255,.72); }
    .ust .etiket { display: flex; align-items: center; gap: 10px; }
    .ust .etiket i { width: 8px; height: 8px; border-radius: 50%; background: #ff9a52; box-shadow: 0 0 10px #ff9a52; }
    .ust .tarih { font-weight: 400; font-style: italic; letter-spacing: .02em; font-size: 16px; color: rgba(255,255,255,.62); }
    .merkez { position: absolute; left: 0; right: 0; top: 74px; display: flex; flex-direction: column; align-items: center; text-align: center; }
    .marka { position: relative; width: 96px; height: 75px; display: grid; place-items: center;
      animation: marka 700ms ease-in-out 120ms both; }
    @keyframes marka { 0%, 100% { transform: none; } 40% { transform: scale(1.2) rotate(-6deg); } 70% { transform: scale(.96) rotate(2deg); } }
    .marka img { width: 96px; position: relative; filter: drop-shadow(0 0 18px rgba(255,154,82,.45)); }
    .halka { position: absolute; left: 50%; top: 50%; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
      border: 3px solid rgb(var(--p) / .9); animation: halka 950ms ease-out 200ms both; }
    @keyframes halka { 0% { opacity: 0; transform: scale(.4); } 10% { opacity: .9; } 100% { opacity: 0; transform: scale(2.4); } }
    .baslik { margin-top: 26px; font-size: ${v.tur === 'kimse' || v.tur === 'oysuz' ? 66 : 78}px; text-shadow: 0 6px 30px rgba(0,0,0,.45);
      animation: ${{ kazanan: 'zipla 650ms ease-in-out 380ms both', kimse: 'salla 560ms ease-in-out 420ms both', oysuz: 'none' }[v.tur]}; }
    @keyframes zipla { 0%, 100% { transform: none; } 45% { transform: scale(1.08); } }
    @keyframes salla { 0%,100% { translate: 0 0; } 20% { translate: -9px 0; } 40% { translate: 8px 0; } 60% { translate: -5px 0; } 80% { translate: 3px 0; } }
    .alt { margin-top: 16px; font-size: 21px; font-weight: 500; color: rgba(255,255,255,.78); }
    .alt b { color: #fff; font-weight: 700; }
    .sonuc { margin-top: 26px; display: flex; align-items: center; gap: 14px; padding: 10px 22px 10px 12px; border-radius: 999px;
      background: rgba(20,15,12,.72); border: 1px solid rgb(var(--p) / .55);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 0 34px -6px rgb(var(--p) / .7);
      position: relative; overflow: hidden; }
    .sonuc::after { content: ''; position: absolute; top: -10px; bottom: -10px; left: -90px; width: 60px; transform: skewX(-20deg);
      background: linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.22), rgba(255,255,255,0));
      animation: parilti 900ms ease-in-out 1150ms both; }
    @keyframes parilti { from { left: -90px; } to { left: calc(100% + 40px); } }
    .sonuc .ikon-kutu { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: rgb(var(--p) / .2); color: var(--m); }
    .sonuc .ikon { width: 22px; height: 22px; }
    .sonuc .yon { font-size: 22px; font-weight: 800; font-style: italic; color: var(--m); letter-spacing: .01em; }
    .sonuc .yuzde { font-size: 22px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
    .sonuc .fiyatlar { font-size: 18px; font-weight: 500; color: rgba(255,255,255,.62); font-variant-numeric: tabular-nums; }
    .sonuc .sert { font-size: 13px; font-weight: 800; letter-spacing: .14em; color: #1a0d06; background: #ff9a52; padding: 5px 10px; border-radius: 999px; }
    .imza { position: absolute; bottom: 22px; left: 0; right: 0; text-align: center; font-size: 17px; }
    canvas { position: absolute; inset: 0; pointer-events: none; }
  </style></head><body>
  <div class="kart">
    <div class="zemin"></div><div class="yer-isigi"></div>
    <svg class="cizgi" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs>
        <linearGradient id="alan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${y.parilti})" stop-opacity=".18"/><stop offset="1" stop-color="rgb(${y.parilti})" stop-opacity="0"/></linearGradient>
        <filter id="isilti" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
        <filter id="isilti-ince" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>
      </defs>
      <path d="${yol} L${W} ${H} L0 ${H} Z" fill="url(#alan)"/>
      <path d="${yol}" fill="none" stroke="rgb(${y.parilti})" stroke-width="7" stroke-opacity=".55" filter="url(#isilti)"/>
      <path d="${yol}" fill="none" stroke="rgb(${y.parilti})" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" stroke-opacity=".9"/>
      <path class="kuyruk" d="${yol}" pathLength="1000" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round" stroke-opacity=".9" filter="url(#isilti-ince)"/>
      <circle class="uc-nabiz" cx="${sonX - 6}" cy="${sonY}" r="7" fill="none" stroke="rgb(${y.parilti})" stroke-width="3"/>
      <circle cx="${sonX - 6}" cy="${sonY}" r="7" fill="#fff" stroke="rgb(${y.parilti})" stroke-width="4"/>
    </svg>
    <header class="ust">
      <span class="etiket"><i></i>GÜNÜN TAHMİNİ</span>
      <span class="tarih">${kacis(tarihUzun(v.tarih))}</span>
    </header>
    <div class="merkez">
      <div class="marka"><span class="halka"></span><img src="${kaynak().logoV}" alt=""></div>
      <h1 class="baslik"><span class="kalin">${metin.baslik}</span></h1>
      <p class="alt">${metin.alt}</p>
      <div class="sonuc">
        <span class="ikon-kutu">${ikon(v.yon)}</span>
        <span class="yon">${y.etiket}</span>
        <span class="yuzde">${yuzdeYaz(v.degisim)}</span>
        <span class="fiyatlar">${fiyatYaz(v.acilisFiyat)} → ${fiyatYaz(v.kapanisFiyat)}</span>
        ${v.sert ? '<span class="sert">SERT HAREKET</span>' : ''}
      </div>
    </div>
    <div class="imza site">vestaprimes.com</div>
    <canvas id="konfeti" width="${W}" height="${H}"></canvas>
  </div>
  <script>
    // Konfeti tuvalde, zamanin saf fonksiyonu olarak ciziliyor: kare(t) her
    // cagrildiginda ayni t icin ayni goruntu. CSS animasyonlari da ayni t'ye
    // sabitleniyor; boylece GIF kareleri gercek zamandan bagimsiz.
    const W = ${W}, H = ${H}, SURE = ${SONUC_SURE};
    const tuval = document.getElementById('konfeti').getContext('2d');
    let s = ${tohum} >>> 0;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const renkler = ${renkler};
    const parcalar = Array.from({ length: ${konfeti} }, () => ({
      x: W / 2 + (r() - 0.5) * 140, y: 150 + (r() - 0.5) * 40,
      vx: (r() - 0.5) * 1100, vy: -(380 + r() * 620),
      a: r() * Math.PI * 2, va: (r() - 0.5) * 16, cevir: 6 + r() * 10,
      w: 6 + r() * 6, h: 9 + r() * 9, renk: renkler[Math.floor(r() * renkler.length)],
      t0: 320 + r() * 260,
    }));
    function konfetiCiz(t) {
      tuval.clearRect(0, 0, W, H);
      const solma = Math.max(0, Math.min(1, (SURE - 150 - t) / 650));
      for (const p of parcalar) {
        const d = (t - p.t0) / 1000;
        if (d <= 0) continue;
        const surtunme = (1 - Math.exp(-2.2 * d)) / 2.2;
        const x = p.x + p.vx * surtunme;
        const y = p.y + p.vy * surtunme + 420 * d * d;
        if (y > H + 30) continue;
        tuval.save();
        tuval.globalAlpha = solma;
        tuval.translate(x, y);
        tuval.rotate(p.a + p.va * d);
        tuval.scale(1, Math.cos(p.cevir * d));
        tuval.fillStyle = p.renk;
        tuval.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        tuval.restore();
      }
    }
    window.kare = (t) => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
      konfetiCiz(t);
    };
    window.kare(0);
  </script></body></html>`;
}
