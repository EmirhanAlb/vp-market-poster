// Gunun Tahmini kartlarinin ornek ciktilarini out/kart/ altina uretir.
// Slack'e hicbir sey gonderilmez. Kullanim: npm run kart:onizle
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { oylamaKarti, sonucKarti } from '../src/poll/kart.js';

const cikti = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out/kart');
const bugun = new Date();
const saat = (s, d) => new Date(Date.UTC(bugun.getUTCFullYear(), bugun.getUTCMonth(), bugun.getUTCDate(), s - 3, d));

const ornekler = [
  ['oylama.png', () =>
    oylamaKarti(
      { tarih: bugun, fiyat: 4148.65, paylasAni: saat(14, 0), acilisAni: saat(16, 30), sonucAni: saat(17, 30), bant: 0.15 },
      path.join(cikti, 'oylama.png'),
    )],
  ['sonuc-kazanan-yukari.gif', () =>
    sonucKarti(
      { tur: 'kazanan', tarih: bugun, yon: 'yukari', degisim: 0.42, acilisFiyat: 4148.65, kapanisFiyat: 4166.07,
        kazananSayisi: 3, oySayisi: 8, sert: false, sonrakiGun: 'Yarın', sonrakiSaat: '14:00' },
      path.join(cikti, 'sonuc-kazanan-yukari.gif'),
    )],
  ['sonuc-kazanan-sert-asagi.gif', () =>
    sonucKarti(
      { tur: 'kazanan', tarih: bugun, yon: 'asagi', degisim: -0.83, acilisFiyat: 4148.65, kapanisFiyat: 4114.22,
        kazananSayisi: 1, oySayisi: 6, sert: true, sonrakiGun: 'Yarın', sonrakiSaat: '14:00' },
      path.join(cikti, 'sonuc-kazanan-sert-asagi.gif'),
    )],
  ['sonuc-kimse-duragan.gif', () =>
    sonucKarti(
      { tur: 'kimse', tarih: bugun, yon: 'duragan', degisim: 0.06, acilisFiyat: 4148.65, kapanisFiyat: 4151.14,
        kazananSayisi: 0, oySayisi: 5, sert: false, sonrakiGun: 'Pazartesi', sonrakiSaat: '14:00' },
      path.join(cikti, 'sonuc-kimse-duragan.gif'),
    )],
  ['sonuc-oysuz-asagi.gif', () =>
    sonucKarti(
      { tur: 'oysuz', tarih: bugun, yon: 'asagi', degisim: -0.21, acilisFiyat: 4148.65, kapanisFiyat: 4139.94,
        kazananSayisi: 0, oySayisi: 0, sert: false, sonrakiGun: 'Yarın', sonrakiSaat: '14:00' },
      path.join(cikti, 'sonuc-oysuz-asagi.gif'),
    )],
];

for (const [ad, uret] of ornekler) {
  const basla = Date.now();
  const yol = await uret();
  const { size } = await import('node:fs').then((fs) => fs.statSync(yol));
  console.log(`${ad.padEnd(30)} ${(size / 1024).toFixed(0).padStart(5)} KB  ${((Date.now() - basla) / 1000).toFixed(1)} sn`);
}
console.log(`\nCiktilar: ${cikti}`);
