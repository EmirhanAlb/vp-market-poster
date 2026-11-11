// O anki piyasa verisini ve hangi kaynaktan, ne kadar once geldigini yazar.
// "Fiyatlari nereden aliyoruz, guncel mi?" sorusunun cevabi. Slack'e hicbir
// sey gondermez. Kullanim: npm run fiyat
import { piyasaGoruntusu, goruntuOzeti, spotAltin, ENSTRUMANLAR } from '../src/piyasa.js';

const basla = Date.now();
const goruntu = await piyasaGoruntusu();
const saat = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  dateStyle: 'short',
  timeStyle: 'medium',
}).format(new Date(goruntu.an));

console.log(
  `Piyasa verisi - ${saat} TR (${Date.now() - basla} ms)${goruntu.kapali ? ' - doviz/emtia piyasalari kapali olabilir' : ''}\n`,
);
console.log(goruntuOzeti(goruntu));

if (goruntu.sorunlar.length) {
  console.log('\nSorunlar ("!" olanlar Slack mesajina not olarak duser):');
  for (const s of goruntu.sorunlar)
    console.log(`  ${s.not ? '!' : '-'} ${s.enstruman}: ${s.mesaj}${s.not ? `  ->  "${s.not}"` : ''}`);
}
// Ozet goruntunun kendisinden cikarilir: "sorun yok" demek icin her enstruman
// birincil kaynagindan ve taze gelmis olmali.
const BIRINCIL = { DXY: 'swissquote', BTCUSD: 'coinbase', ETHUSD: 'coinbase', BRENT: 'cnbc (1 dk bar)', EURUSD: 'swissquote', XAUUSD: 'swissquote' };
const durum = Object.entries(BIRINCIL).map(([anahtar, birincil]) => {
  const e = goruntu.enstrumanlar[anahtar];
  if (!e) return `${ENSTRUMANLAR[anahtar].ad}: veri yok`;
  if (!e.taze) return `${ENSTRUMANLAR[anahtar].ad}: taze degil (${e.kaynak})`;
  return e.kaynak.startsWith(birincil) ? null : `${ENSTRUMANLAR[anahtar].ad}: yedek kaynak (${e.kaynak})`;
});
const eksikler = durum.filter(Boolean);
console.log(
  eksikler.length
    ? `\nOzet: ${eksikler.join('; ')}.`
    : '\nOzet: alti enstruman da birincil kaynagindan ve taze.',
);

const altin = await spotAltin();
console.log('\nSpot altin kaynaklari (oylama da bunlari kullanir):');
for (const [kaynak, fiyat] of Object.entries(altin.adaylar)) {
  console.log(`  ${kaynak.padEnd(11)} ${fiyat.toFixed(2)}${kaynak === altin.kaynak ? '   <- secilen' : ''}`);
}
for (const hata of altin.hatalar) console.log(`  yanit vermedi: ${hata}`);
for (const not of altin.notlar) console.log(`  dikkat: ${not}`);
