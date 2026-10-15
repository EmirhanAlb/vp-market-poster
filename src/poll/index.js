import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebClient } from '@slack/web-api';
import { hedefler as slackHedefleri } from '../slack-out/targets.js';
import { altinFiyati, fiyatYaz } from './price.js';
import { bugunSaat, saatCoz, trSaat, trTarih, bekle } from './time.js';
import { oylamaKarti, sonucKarti } from './kart.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(rootDir, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const KAYIT_DOSYASI = path.join(rootDir, 'state', 'poll-history.json');
const AKTIF_DOSYASI = path.join(rootDir, 'state', 'poll-active.json');
const dryRun = process.argv.includes('--dry-run');
/**
 * Sonuclandirma modu: daha once paylasilmis bir oylamayi simdi sonuclandirir.
 * Hem testi kolaylastirir hem de is ortasinda coktuyse kurtarma saglar.
 */
const settleMode = process.argv.includes('--settle');
/** Zincir modu: workflow her calistirmada bir halka yurutur, bkz. zincirHalkasi(). */
const loopMode = process.argv.includes('--loop');
/** Bir zincir halkasinin calisma suresi (dakika). */
const HALKA_DK = Number(process.env.LOOP_MINUTES || 300);

function arg(ad) {
  const i = process.argv.indexOf(ad);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function aktifOku() {
  try {
    return JSON.parse(fs.readFileSync(AKTIF_DOSYASI, 'utf8'));
  } catch {
    return null;
  }
}

function aktifYaz(veri) {
  fs.mkdirSync(path.dirname(AKTIF_DOSYASI), { recursive: true });
  fs.writeFileSync(AKTIF_DOSYASI, `${JSON.stringify(veri, null, 2)}\n`);
}

function aktifSil() {
  try {
    fs.unlinkSync(AKTIF_DOSYASI);
  } catch {
    /* yoksa sorun degil */
  }
}

/** Oylama mesajinin paylasilacagi saat (Turkiye). */
const [PAYLAS_S, PAYLAS_D] = saatCoz(process.env.POLL_POST_TR, [14, 0]);
/** ABD borsasinin acilis saati (New York). Yaz saatini kendisi cozer. */
const [ACILIS_S, ACILIS_D] = saatCoz(process.env.POLL_OPEN_NY, [9, 30]);
/** Acilistan kac dakika sonra sonuc aciklanir. */
const SONUC_DK = Number(process.env.POLL_SETTLE_MINUTES || 60);

/** Bu bandin icindeki hareket "duragan" sayilir (yuzde). */
const DURAGAN_BANDI = Number(process.env.POLL_FLAT_BAND || 0.15);
/** Bu esigi asan hareket "sert" sayilir ve kutlama dozu artar (yuzde). */
const SERT_ESIK = Number(process.env.POLL_SHARP_BAND || 0.5);

const SECENEKLER = [
  { yon: 'yukari', emoji: 'chart_with_upwards_trend', etiket: 'Yukarı', gorsel: ':chart_with_upwards_trend:' },
  { yon: 'asagi', emoji: 'chart_with_downwards_trend', etiket: 'Aşağı', gorsel: ':chart_with_downwards_trend:' },
  { yon: 'duragan', emoji: 'left_right_arrow', etiket: 'Durağan', gorsel: ':left_right_arrow:' },
];

/**
 * Oylama kanallari.
 *
 * Eskiden yalnizca POLL_CHANNEL_ID okunuyordu. Diger akislar SLACK_CONFIG'e
 * tasindiginda oylama geride kaldi: kanal yalnizca SLACK_CONFIG'te tanimliysa
 * bu fonksiyon bos donuyor ve akis "tanimli degil" diye duruyordu. Artik
 * hedefler ortak cozumleyiciden geliyor (o zaten her iki yazimi da destekler).
 *
 * Oylama akisi hala tek token'la calisiyor: oylari okumak ve sonucu ayni
 * mesajin altina yazmak icin mesaji atan workspace'in istemcisi gerekiyor.
 * Baska workspace'lerdeki hedefler bu yuzden atlanir - ama sessizce degil.
 */
function kanallar() {
  const token = process.env.SLACK_BOT_TOKEN;

  // POLL_CHANNEL_ID acikca verilmisse tek yetkili odur; SLACK_CONFIG'teki
  // "poll" alani dikkate alinmaz. Diger akislar iki kaynagi BIRLESTIRIR ama
  // oylama icin bu yanlis olurdu: secret'ta kalmis eski bir kanal sessizce
  // oylamaya dahil olur ve onu dusurmenin tek yolu secret'i bastan yazmak
  // olurdu (GitHub secret degerlerini geri gostermiyor).
  const acik = (process.env.POLL_CHANNEL_ID || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  if (acik.length) return [...new Set(acik)];

  const hepsi = slackHedefleri('poll');
  const disarida = hepsi.filter((h) => h.token !== token);
  if (disarida.length) {
    const slotlar = [...new Set(disarida.map((d) => d.slot))].join(', ');
    console.warn(
      `  ! ${disarida.length} oylama kanali baska workspace'te (${slotlar}); ` +
        'oylama akisi coklu workspace desteklemiyor, bu kanallar atlaniyor.',
    );
  }
  return [...new Set(hepsi.filter((h) => h.token === token).map((h) => h.channel))];
}

/**
 * Token'a verilmis OAuth scope'lari.
 *
 * Slack scope listesini govdede degil "x-oauth-scopes" yanit basliginda
 * donuyor ve WebClient bu basligi disari vermiyor; bu yuzden dogrudan fetch.
 * Okuyamazsak bos donuyoruz: kontrol akisi durdurmasin.
 */
async function scopeler(token) {
  try {
    const r = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return (r.headers.get('x-oauth-scopes') || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gecmisOku() {
  try {
    return JSON.parse(fs.readFileSync(KAYIT_DOSYASI, 'utf8'))?.oylamalar || [];
  } catch {
    return [];
  }
}

function kayitEkle(kayit) {
  const gecmis = gecmisOku();
  gecmis.push(kayit);
  fs.mkdirSync(path.dirname(KAYIT_DOSYASI), { recursive: true });
  fs.writeFileSync(KAYIT_DOSYASI, `${JSON.stringify({ oylamalar: gecmis.slice(-120) }, null, 2)}\n`);
}

// --- KART GORSELLERI --------------------------------------------------------

/**
 * Dosyayi kanala paylasmadan Slack'e yukler ve kimligini dondurur.
 *
 * files.uploadV2 yerine adimlar elle: dosya kimligi ilk adimda geliyor ve
 * kanala paylasilmamis dosya mesaj blogunda (slack_file) kullanilabiliyor.
 * Boylece kart mesajin icinde gorunuyor, ts dogrudan chat.postMessage'tan
 * geliyor ve oy tepkileri ile sonuc zinciri ayni mesaja baglaniyor.
 */
async function gorselYukle(client, dosyaYolu, baslik) {
  const veri = fs.readFileSync(dosyaYolu);
  const { upload_url: adres, file_id: id } = await client.files.getUploadURLExternal({
    filename: path.basename(dosyaYolu),
    length: veri.length,
  });
  const yanit = await fetch(adres, { method: 'POST', body: veri });
  if (!yanit.ok) throw new Error(`yukleme HTTP ${yanit.status}`);
  await client.files.completeUploadExternal({ files: [{ id, title: baslik }] });
  return id;
}

/**
 * Karti uretir ve yukler. Kart suslemedir: herhangi bir adim basarisiz olursa
 * null doner ve mesaj gorselsiz gider, oylama asla bu yuzden durmaz.
 */
async function kartHazirla(client, uret, dosyaAdi, alt) {
  try {
    const yol = await uret(path.join(rootDir, 'out', 'kart', dosyaAdi));
    if (!client) return { yol };
    return { id: await gorselYukle(client, yol, alt), alt, yol };
  } catch (err) {
    console.warn(`  ! kart hazirlanamadi (${err?.data?.error || err.message}); mesaj gorselsiz gidecek`);
    return null;
  }
}

/**
 * Mesaji en uste kart gorseli koyarak gonderir; olmazsa gorselsiz gonderir.
 * Yeni yuklenen dosya Slack'te islenene kadar birkac saniye blokta
 * kullanilamiyor (invalid_blocks); bu yuzden artan araliklarla yeniden deneniyor.
 */
async function kartliGonder(client, mesaj, kart, kartliBloklar = mesaj.blocks) {
  if (kart?.id) {
    const blocks = [{ type: 'image', slack_file: { id: kart.id }, alt_text: kart.alt }, ...kartliBloklar];
    for (let deneme = 1; deneme <= 5; deneme++) {
      try {
        const res = await client.chat.postMessage({ ...mesaj, blocks });
        return Object.assign(res, { kartli: true });
      } catch (err) {
        const hata = err?.data?.error || err.message;
        if (hata !== 'invalid_blocks' || deneme === 5) {
          console.warn(`  ! kart mesaja eklenemedi (${hata}); gorselsiz gonderiliyor`);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500 * deneme));
      }
    }
  }
  return client.chat.postMessage(mesaj);
}

function oylamaKartVerisi(fiyat, { paylasAni, acilisAni, sonucAni }) {
  return { tarih: new Date(), fiyat, paylasAni, acilisAni, sonucAni, bant: DURAGAN_BANDI };
}

/** Bir sonraki oylama gunu: "Yarın" ya da gun adi (Cuma'dan sonra "Pazartesi"). */
function sonrakiOylamaGunu(an = new Date()) {
  for (let g = 1; g <= 7; g++) {
    const aday = new Date(an.getTime() + g * 86_400_000);
    if (!haftaIciMi(aday)) continue;
    return g === 1 ? 'Yarın' : new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long' }).format(aday);
  }
  return 'Yarın';
}

const PAYLAS_METIN = `${String(PAYLAS_S).padStart(2, '0')}:${String(PAYLAS_D).padStart(2, '0')}`;

// --- 1) OYLAMAYI PAYLAS ----------------------------------------------------

async function oylamaPaylas(client, kanal, acilisAni, sonucAni, baslangicFiyat, kart) {
  const metinBloklari = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `:bar_chart: *GÜNÜN TAHMİNİ — ${trTarih(new Date())}*\n\n` +
          `ABD piyasası *${trSaat(acilisAni)}*'da açılıyor.\n` +
          `*Altın (XAU/USD)* açılıştan sonraki 1 saatte nasıl seyreder?`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: SECENEKLER.map((s) => `${s.gorsel}  *${s.etiket}*`).join('\n'),
      },
    },
  ];
  const baglam = {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text:
          `Şu anki fiyat: *$${fiyatYaz(baslangicFiyat)}*  ·  ` +
          `Sonuç *${trSaat(sonucAni)}*'da açıklanır  ·  ` +
          `Tek seçenek işaretleyin — birden fazlası geçersiz sayılır`,
      },
    ],
  };

  // Kart varsa baslik, soru ve secenekler zaten gorselde: metin tekrarlanmiyor.
  // Kart eklenemezse mesaj eskisi gibi tam metinle gider.
  const res = await kartliGonder(
    client,
    {
      channel: kanal,
      text: `GÜNÜN TAHMİNİ — Altın açılıştan sonra nasıl seyreder?`,
      blocks: [...metinBloklari, baglam],
      unfurl_links: false,
    },
    kart,
    [baglam],
  );
  if (!res.ok) throw new Error(JSON.stringify(res));

  // Secenek emojilerini onceden koyuyoruz ki tek tikla oy verilebilsin.
  for (const secenek of SECENEKLER) {
    try {
      await client.reactions.add({ channel: kanal, timestamp: res.ts, name: secenek.emoji });
    } catch (err) {
      console.warn(`  ! ${secenek.emoji} tepkisi eklenemedi: ${err?.data?.error || err.message}`);
    }
  }

  console.log(`  ${kanal}: oylama paylasildi (ts ${res.ts}${res.kartli ? ', kartli' : ''})`);
  return res.ts;
}

// --- 2) OYLARI OKU ---------------------------------------------------------

/**
 * Oylari okur. Birden fazla secenek isaretleyen kullanicilar gecersiz sayilir:
 * emoji tepkileriyle "tek oy" teknik olarak zorlanamiyor, bu yuzden kural
 * sayim aninda uygulaniyor ve sonuc mesajinda belirtiliyor.
 */
async function oylariOku(client, kanal, ts, botKullanici) {
  const res = await client.reactions.get({ channel: kanal, timestamp: ts, full: true });
  if (!res.ok) throw new Error(JSON.stringify(res));

  const tepkiler = res.message?.reactions || [];
  const kullaniciOylari = new Map(); // kullanici -> [yon...]

  for (const tepki of tepkiler) {
    const secenek = SECENEKLER.find((s) => s.emoji === tepki.name);
    if (!secenek) continue;
    for (const kullanici of tepki.users || []) {
      if (kullanici === botKullanici) continue;
      if (!kullaniciOylari.has(kullanici)) kullaniciOylari.set(kullanici, []);
      kullaniciOylari.get(kullanici).push(secenek.yon);
    }
  }

  const gecerli = new Map(); // kullanici -> yon
  const gecersiz = [];
  for (const [kullanici, yonler] of kullaniciOylari) {
    if (yonler.length === 1) gecerli.set(kullanici, yonler[0]);
    else gecersiz.push(kullanici);
  }
  return { gecerli, gecersiz };
}

// --- 3) SONUCU ACIKLA ------------------------------------------------------

function yonBelirle(degisimYuzde) {
  if (Math.abs(degisimYuzde) < DURAGAN_BANDI) return 'duragan';
  return degisimYuzde > 0 ? 'yukari' : 'asagi';
}

async function sonucPaylas(client, kanal, ts, veri) {
  const { acilisFiyat, kapanisFiyat, degisim, yon, gecerli, gecersiz } = veri;
  const secenek = SECENEKLER.find((s) => s.yon === yon);
  const sert = Math.abs(degisim) >= SERT_ESIK;

  const kazananlar = [...gecerli.entries()].filter(([, y]) => y === yon).map(([k]) => k);
  const dagilim = SECENEKLER.map((s) => {
    const adet = [...gecerli.values()].filter((y) => y === s.yon).length;
    return `${s.gorsel} ${s.etiket}: *${adet}*`;
  }).join('   ·   ');

  const isaret = degisim > 0 ? '+' : '';
  const bloklar = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${sert ? ':rotating_light:' : ':checkered_flag:'} *SONUÇ — Altın (XAU/USD)*\n\n` +
          `Açılış: *$${fiyatYaz(acilisFiyat)}*  →  1 saat sonra: *$${fiyatYaz(kapanisFiyat)}*\n` +
          `Değişim: *${isaret}${degisim.toFixed(2)}%* → ${secenek.gorsel} *${secenek.etiket}*` +
          (sert ? '  _(sert hareket)_' : ''),
      },
    },
    { type: 'section', text: { type: 'mrkdwn', text: `Oy dağılımı:  ${dagilim}` } },
  ];

  if (kazananlar.length) {
    const etiketler = kazananlar.map((k) => `<@${k}>`).join(' ');
    bloklar.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: sert
          ? `:trophy: *Sert hareketi bilenler!* ${etiketler}\nTebrikler, yönü tam isabet okudunuz.`
          : `:tada: *Doğru bilenler:* ${etiketler}\nTebrikler!`,
      },
    });
  } else if (gecerli.size > 0) {
    bloklar.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:see_no_evil: Bu kez kimse tutturamadı. ${sonrakiOylamaGunu()} yeniden!` },
    });
  } else {
    bloklar.push({ type: 'section', text: { type: 'mrkdwn', text: '_Bu oylamaya geçerli oy verilmedi._' } });
  }

  if (gecersiz.length) {
    bloklar.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:warning: ${gecersiz.length} kişi birden fazla seçenek işaretlediği için geçersiz sayıldı.`,
        },
      ],
    });
  }

  // Kutlama karti: dogru bilen varsa konfetili tebrik, yoksa "kimse bilemedi".
  // Kazanan sayisi kanala gore degistigi icin kart her kanal icin ayri.
  const tur = kazananlar.length ? 'kazanan' : gecerli.size > 0 ? 'kimse' : 'oysuz';
  const kart = await kartHazirla(
    client,
    (yol) =>
      sonucKarti(
        {
          tur,
          tarih: new Date(),
          yon,
          degisim,
          acilisFiyat,
          kapanisFiyat,
          kazananSayisi: kazananlar.length,
          oySayisi: gecerli.size,
          sert,
          sonrakiGun: sonrakiOylamaGunu(),
          sonrakiSaat: PAYLAS_METIN,
        },
        yol,
      ),
    `sonuc-${kanal}.gif`,
    tur === 'kazanan' ? 'Tebrikler kartı' : 'Günün Tahmini sonuç kartı',
  );

  const res = await kartliGonder(
    client,
    {
      channel: kanal,
      thread_ts: ts,
      reply_broadcast: true, // sonuc kanalda da gorunsun
      text: `SONUÇ — Altın ${isaret}${degisim.toFixed(2)}%`,
      blocks: bloklar,
      unfurl_links: false,
    },
    kart,
  );
  if (!res.ok) throw new Error(JSON.stringify(res));
  console.log(
    `  ${kanal}: sonuc paylasildi (${kazananlar.length} kazanan, ${gecersiz.length} gecersiz` +
      `${res.kartli ? ', kartli' : ''})`,
  );
}

// --- ANA AKIS --------------------------------------------------------------

/** Bir oylamayi sonuclandirir: oylari okur, sonucu paylasir, gecmise yazar. */
async function sonuclandir(client, botKullanici, mesajlar, acilisFiyat, kapanisFiyat) {
  const degisim = ((kapanisFiyat - acilisFiyat) / acilisFiyat) * 100;
  const yon = yonBelirle(degisim);
  console.log(
    `Acilis $${fiyatYaz(acilisFiyat)} -> kapanis $${fiyatYaz(kapanisFiyat)} | ` +
      `degisim ${degisim.toFixed(2)}% -> ${yon}`,
  );

  for (const { kanal, ts } of mesajlar) {
    try {
      const { gecerli, gecersiz } = await oylariOku(client, kanal, ts, botKullanici);
      await sonucPaylas(client, kanal, ts, { acilisFiyat, kapanisFiyat, degisim, yon, gecerli, gecersiz });
      kayitEkle({
        tarih: trTarih(new Date()),
        kanal,
        ts,
        acilisFiyat,
        kapanisFiyat,
        degisim: Number(degisim.toFixed(3)),
        yon,
        oySayisi: gecerli.size,
        gecersiz: gecersiz.length,
        kazananlar: [...gecerli.entries()].filter(([, y]) => y === yon).map(([k]) => k),
      });
    } catch (err) {
      console.error(`  ${kanal}: sonuc paylasilamadi -> ${err?.data?.error || err.message}`);
      throw err;
    }
  }
  aktifSil();
}

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  const hedefler = kanallar();
  if (!token) throw new Error('SLACK_BOT_TOKEN tanimli degil.');
  if (hedefler.length === 0) {
    throw new Error('Oylama kanali tanimli degil (SLACK_CONFIG icinde "poll" ya da POLL_CHANNEL_ID).');
  }

  // Oylama iki tepki iznine dayaniyor:
  //   reactions:write - oy seceneklerinin emojilerini mesaja onceden koymak.
  //                     Yoksa oylama tikanacak secenek olmadan paylasilir ve
  //                     kimse oy veremez. Eksikligi sessiz, cunku kod
  //                     reactions.add hatasini yutup uyari basiyor.
  //   reactions:read  - oylari geri okumak. Yoksa sonuc asla aciklanamaz.
  // Ikisi de burada kontrol ediliyor: sonuclanamayacak ya da oy alamayacak
  // bir oylamayi kanalda birakmaktansa hicbir sey paylasmadan duruyoruz.
  const GEREKLI_IZINLER = ['reactions:write', 'reactions:read'];
  const izinler = await scopeler(token);
  const eksikler = izinler.length ? GEREKLI_IZINLER.filter((i) => !izinler.includes(i)) : [];
  if (eksikler.length) {
    throw new Error(
      `Slack uygulamasinda su izin(ler) yok: ${eksikler.join(', ')}. ` +
        `Mevcut izinler: ${izinler.join(', ')}. ` +
        'Duzeltme: api.slack.com/apps > uygulama > OAuth & Permissions > Bot Token Scopes ' +
        `altina ${eksikler.join(' ve ')} ekleyin, "Reinstall to Workspace" yapin. Token degisirse ` +
        'SLACK_BOT_TOKEN ve SLACK_CONFIG secret larini guncelleyin.',
    );
  }

  const client = new WebClient(token);
  const kimlik = await client.auth.test();
  const botKullanici = kimlik.user_id;

  // --settle: onceden paylasilmis bir oylamayi simdi sonuclandir.
  if (settleMode) {
    const aktif = aktifOku();
    const ts = arg('--ts') || aktif?.mesajlar?.[0]?.ts;
    const kanal = arg('--kanal') || aktif?.mesajlar?.[0]?.kanal || hedefler[0];
    const acilisFiyat = Number(arg('--acilis') || aktif?.acilisFiyat || aktif?.baslangicFiyat);

    if (!ts) throw new Error('Sonuclandirilacak oylama yok. --ts <zaman damgasi> verin.');
    if (!Number.isFinite(acilisFiyat)) throw new Error('Acilis fiyati bilinmiyor. --acilis <fiyat> verin.');

    const { fiyat: kapanisFiyat } = await altinFiyati();
    await sonuclandir(client, botKullanici, [{ kanal, ts }], acilisFiyat, kapanisFiyat);
    return;
  }

  const plan = gununPlani();
  console.log(`Oylama    : ${trSaat(plan.paylasAni)} TR`);
  console.log(`ABD acilis: ${trSaat(plan.acilisAni)} TR`);
  console.log(`Sonuc     : ${trSaat(plan.sonucAni)} TR`);
  console.log(`Kanallar  : ${hedefler.join(', ')}\n`);

  if (dryRun) {
    const { fiyat, kaynak } = await altinFiyati();
    console.log(`--dry-run: guncel altin $${fiyatYaz(fiyat)} (${kaynak}). Gonderim yapilmadi.`);
    // Kartin bu makinede uretilebildigini de dogrula (Chromium, yazi tipleri).
    const kart = await kartHazirla(null, (yol) => oylamaKarti(oylamaKartVerisi(fiyat, plan), yol), 'oylama.png');
    if (kart) console.log(`--dry-run: oylama karti uretildi -> ${kart.yol}`);
    return;
  }

  if (loopMode) {
    await zincirHalkasi(client, botKullanici, hedefler);
    return;
  }

  // Elle tek seferlik calistirma. Acilis gecmisse oylamanin anlami kalmaz:
  // paylasilir paylasilmaz sonuclanirdi.
  const paySuresiKaldi = plan.acilisAni.getTime() - Date.now();
  if (paySuresiKaldi < 5 * 60_000) {
    console.log(
      `Atlaniyor: ABD acilisina ${Math.round(paySuresiKaldi / 60000)} dk kaldi, ` +
        'oylama icin anlamli sure yok.',
    );
    return;
  }
  await gunlukAkis(client, botKullanici, hedefler, plan);
}

/**
 * Verilen gunun (Turkiye takvimiyle) oylama saatleri.
 *
 * ABD acilisi, paylasim aninin New York'taki gunune gore hesaplaniyor.
 * "Simdi"ye gore hesaplansaydi Turkiye'de gece yarisini gectikten sonra New
 * York hala onceki gunde oldugundan acilis bir gun geriye duserdi. Zincirdeki
 * halkalar gunun her saatinde calistigi icin bu fark onemli.
 */
function gununPlani(referans = new Date()) {
  const paylasAni = bugunSaat(PAYLAS_S, PAYLAS_D, 'Europe/Istanbul', referans);
  const acilisAni = bugunSaat(ACILIS_S, ACILIS_D, 'America/New_York', paylasAni);
  const sonucAni = new Date(acilisAni.getTime() + SONUC_DK * 60_000);
  return { paylasAni, acilisAni, sonucAni };
}

function haftaIciMi(an) {
  const gun = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', weekday: 'short' }).format(an);
  return gun !== 'Sat' && gun !== 'Sun';
}

/**
 * Bugunun oylamasi ele alinmis mi: sonuclanmis, kacirildigi kaydedilmis ya
 * da paylasilmis ama henuz sonuclanmamis (is yarida kesildiyse). Son durumda
 * ikinci bir oylama acmak yerine elle "npm run poll:settle" bekleniyor.
 */
function bugunIslendiMi(bugun) {
  if (gecmisOku().some((k) => k.tarih === bugun)) return true;
  const aktif = aktifOku();
  if (aktif?.paylasildi && trTarih(new Date(aktif.paylasildi)) === bugun) {
    console.warn('  ! Bugunun oylamasi paylasilmis ama sonuclanmamis. Sonuclandirmak icin: npm run poll:settle');
    return true;
  }
  return false;
}

/**
 * Zincirin tek halkasi. Workflow is bitince kendini yeniden tetikliyor.
 *
 * NEDEN ZINCIR? Is eskiden hafta ici 09:00 UTC cron'uyla basliyordu. GitHub'in
 * zamanlayicisi bu cron'u giderek daha gec atesledi: Eylul basinda 13:10 UTC,
 * 21 Eylul'den itibaren 13:48-18:26 UTC. ABD acilisi 13:30 UTC oldugundan is
 * her gun "acilis gecmis" diye atlayip BASARILI bitti; oylama 18 Eylul'den
 * sonra hic paylasilmadi ve hata da gorunmedi. Diger uc akis ayni sorunla
 * zincire tasinmisti.
 *
 * Paylasimdan sonuca ~3.5 saat suruyor ve bu sure tek isin icinde kalmali:
 * acilis fiyati tam acilis aninda alinmali. Bu yuzden bir halka oylamayi
 * ancak sonuc saati kendi suresi icindeyse yurutur. Degilse oylamayi tam
 * kapsayabilecek ilk ana kadar bekleyip cikar; yeni halka tam sureyle baslar.
 */
async function zincirHalkasi(client, botKullanici, hedefler) {
  const bitis = Date.now() + HALKA_DK * 60_000;
  const simdi = new Date();
  const bugun = trTarih(simdi);
  const plan = gununPlani(simdi);

  if (!haftaIciMi(simdi) || bugunIslendiMi(bugun)) {
    console.log(`Bugun (${bugun}) yapilacak oylama yok.`);
    await bekle(new Date(bitis), 'Halka sonu');
    return;
  }

  // Zincir koptuysa ve acilistan sonra uyandiysak gunu kurtarmak mumkun degil.
  // Eskiden bu durum sessizce gecildigi icin haftalarca fark edilmedi: artik
  // gecmise yaziliyor (ayni gun tekrar raporlanmasin) ve calistirma hatali biter.
  const kalanMs = plan.acilisAni.getTime() - Date.now();
  if (kalanMs < 5 * 60_000) {
    kayitEkle({ tarih: bugun, kacirildi: true, uyanis: simdi.toISOString() });
    throw new Error(
      `Bugunun oylamasi kacirildi: zincir ABD acilisindan (${trSaat(plan.acilisAni)} TR) ` +
        `sonra, ${trSaat(simdi)} TR'de uyandi. Zincir bir sure kopmus olmali.`,
    );
  }

  if (plan.sonucAni.getTime() <= bitis) {
    await gunlukAkis(client, botKullanici, hedefler, plan);
    return;
  }

  const devir = new Date(Math.min(bitis, plan.sonucAni.getTime() - HALKA_DK * 60_000));
  console.log(`Oylama bu halkaya sigmiyor; ${trSaat(devir)} TR'de yeni halkaya devredilecek.`);
  await bekle(devir, 'Devir');
}

/** Bir gunun oylamasini bastan sona yurutur: paylas, acilisi yakala, sonuclandir. */
async function gunlukAkis(client, botKullanici, hedefler, { paylasAni, acilisAni, sonucAni }) {
  // 1) Oylamayi paylas
  await bekle(paylasAni, 'Oylama saati');
  const { fiyat: baslangicFiyat, kaynak } = await altinFiyati();
  console.log(`Baslangic fiyati: $${fiyatYaz(baslangicFiyat)} (${kaynak})`);

  const kart = await kartHazirla(
    client,
    (yol) => oylamaKarti(oylamaKartVerisi(baslangicFiyat, { paylasAni, acilisAni, sonucAni }), yol),
    'oylama.png',
    'Günün Tahmini oylama kartı',
  );

  const mesajlar = [];
  for (const kanal of hedefler) {
    try {
      mesajlar.push({ kanal, ts: await oylamaPaylas(client, kanal, acilisAni, sonucAni, baslangicFiyat, kart) });
    } catch (err) {
      console.error(`  ${kanal}: oylama paylasilamadi -> ${err?.data?.error || err.message}`);
    }
  }
  if (mesajlar.length === 0) throw new Error('Hicbir kanala oylama paylasilamadi.');

  // Durumu diske yaz: is bu noktadan sonra coker veya kesilirse oylama
  // "--settle" ile sonradan sonuclandirilabilsin.
  aktifYaz({ mesajlar, baslangicFiyat, paylasildi: new Date().toISOString() });

  // 2) Acilis fiyatini yakala
  await bekle(acilisAni, 'ABD acilisi');
  const { fiyat: acilisFiyat } = await altinFiyati();
  console.log(`Acilis fiyati: $${fiyatYaz(acilisFiyat)}`);
  aktifYaz({ mesajlar, baslangicFiyat, acilisFiyat, paylasildi: new Date().toISOString() });

  // 3) Bir saat sonra sonucu hesapla ve acikla
  await bekle(sonucAni, 'Sonuc saati');
  const { fiyat: kapanisFiyat } = await altinFiyati();
  await sonuclandir(client, botKullanici, mesajlar, acilisFiyat, kapanisFiyat);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('HATA:', err?.message || err);
    process.exit(1);
  });
