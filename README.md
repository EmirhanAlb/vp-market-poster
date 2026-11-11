# Vestaprime Slack Otomasyonları

Bu repo dört bağımsız otomasyon barındırır. Hepsi aynı Slack app'ini (`Vestaprime Son Dakika`)
ve aynı bot token'ını kullanır, ancak ayrı workflow'lar olarak çalışır.

| Otomasyon | Ne yapar | Sıklık | Kanal secret'ı |
|---|---|---|---|
| **Market Poster** | Canlı piyasa posterini yakalar, PNG olarak gönderir | TR 11:00, 14:00, 16:00, 16:50, 17:00, 18:00 | `SLACK_CHANNEL_ID` |
| **Son Dakika** | Önemli global finansal haberleri filtreleyip gönderir | 10 dk (ABD seansı) / 30 dk | `NEWS_CHANNEL_ID` |
| **FinancialJuice** | Telegram ham piyasa akışını Türkçeye çevirip aktarır | 5 dakikada bir | `TELEGRAM_CHANNEL_ID` |
| **Günün Tahmini** | Altın oylaması: ABD açılışından sonraki 1 saatin yönü | Hafta içi TR 14:00 | workflow'daki `POLL_CHANNEL_ID` |

---

# 1) Market Poster → Slack

[vestaprimes.com/en/market-poster](https://vestaprimes.com/en/market-poster) sayfasındaki canlı piyasa posterini
otomatik olarak yakalayıp Slack kanalına gönderir. Elle "Download PNG" tıklamaya gerek kalmaz.

**Çıktı:** 1080×1350 PNG (sayfadaki indirme butonuyla aynı ölçü ve tasarım). Fiyatlar ise sayfadan
değil bu otomasyonun kendi kaynaklarından gelir; sayfadaki "Download PNG" hâlâ sayfanın kendi
(aşağıda anlatılan hatalı) değerlerini verir.
**Zamanlama:** Her gün TR 11:00, 14:00, 16:00, 16:50, 17:00 ve 18:00 — başka hiçbir saatte gönderilmez.

---

## Nasıl çalışıyor?

Poster sunucuda duran hazır bir dosya değil — sayfa açıldığında tarayıcıda çiziliyor. Bu yüzden
otomasyon gerçek bir tarayıcı çalıştırıyor. **Fiyatları ve grafikleri ise sayfa değil otomasyon sağlıyor:**
sayfanın kendi kaynakları yanlış ya da bayat (aşağıda "Sayfanın kendi verisi neden kullanılmıyor"
başlığına bakın), bu yüzden veri istekleri yolda
yakalanıp doğru kaynaklardan yanıtlanıyor; sayfa yalnızca çiziyor.

1. Altı enstrümanın o anki fiyatı, günlük değişimi ve grafik serisi okunur (`src/piyasa.js`).
2. Headless Chromium ile `/en/market-poster` sayfası açılır; sayfanın veri istekleri bu veriyle
   yanıtlanır (`src/poster-veri.js`).
3. Fiyatlar ve grafikler çizilene kadar beklenir (birkaç saniye). Ardından kartlarda yazan değerler
   verilen değerlerle karşılaştırılır; tutmayan kart olursa Slack mesajına not düşülür.
4. Sayfanın kartı ekrana sığdırmak için uyguladığı küçültme (`--s` CSS değişkeni) iptal edilir, kart tam 1080×1350 boyutunda ekran görüntüsü olarak alınır.
5. PNG, Slack Web API ile kanala dosya olarak yüklenir.

### Fiyatlar nereden geliyor?

Hepsi anahtarsız, herkese açık kaynaklar; 11.11.2026'da GitHub'ın sunucularından tek tek sınandı.
Hiçbiri hizmet garantisi vermiyor (gold-api.com dışında belgeli de değiller); bu yüzden her
enstrümanın yedeği var. İstekler tarayıcı taklidi yapılmadan, `market-poster/1.0` istemci adıyla
gider. Kalıcı ve platformla birebir aynı fiyat için doğru kaynak kurumun kendi fiyat akışıdır.

| Enstrüman | Fiyat (öncelik sırasıyla) | Tazelik | Değişim yüzdesi |
|---|---|---|---|
| XAU/USD | Swissquote spot → CNBC `XAU=` → gold-api.com | saniyeler | önceki kapanışa göre (New York 17:00) |
| EUR/USD | Swissquote spot → CNBC `EUR=` (ikisi de bayatsa ya da birbirini tutmuyorsa, piyasa açıkken Kraken) | saniyeler | önceki kapanışa göre (New York 17:00) |
| DXY | Swissquote'un altı kurundan ICE formülü → CNBC `.DXY` | saniyeler | önceki ICE kapanışına göre |
| BRENT | CNBC 1 dakikalık bar (ICE Brent vadeli: ön ay `@LCO.1`, vadeye 5 iş günü kala ikinci ay `@LCO.2`) → CNBC kotasyonu (10 dk gecikmeli) → sitenin kendi kaynağı | 1–2 dk | önceki ICE uzlaşı fiyatına göre |
| BTC/USD, ETH/USD | Coinbase; yanıt vermezse ya da son işlemi bayatsa Kraken, Bitstamp, Binance veri aynası, CoinGecko | saniyeler | son 24 saat |

**Yüzdeler.** Altın ve EUR/USD'de önceki kapanış New York 17:00 seviyesidir; işlem platformlarının
günlük mumuyla aynı kural. DXY'de endeksin New York 15:00 değeri, Brent'te ICE uzlaşı fiyatıdır
(Londra 19:30); yüzdeyi bir önceki seansın son işleminden ölçen platformlarda Brent yüzdesi farklı
görünebilir. Önceki kapanış CNBC kotasyonundan, o gelmezse barlardan okunur. BTC ve ETH'de referans
tam 24 saat önceki fiyattır.

**Brent hangi kontrat.** Posterdeki Brent, ICE Brent vadeli kontratıdır (nakit/spot Brent değil; ikisi
arasında 1–2 $ fark olabilir). Ön ay kontratının son işlem gününe 5 iş günü kala ikinci aya geçilir:
işlem hacmi ve aracı kurumların kontratları o günlerde sonraki aya geçer, iki kontrat arasında birkaç
dolar fark olur. Eşik `BRENT_ROLL_IS_GUNU` ortam değişkeniyle değiştirilir (`-1` geçişi kapatır);
hangi kontratın okunduğu Actions günlüğünde yazar (`LCOF7` gibi).

**Grafikler.** Altın, EUR/USD, DXY ve Brent kartlarında grafik son New York 17:00'sinden bu yana
15 dakikalık kapanışlarla çizilir ve kartta "1D" yazar: çizginin yönü ile yüzdenin işareti aynı şeyi
anlatır. (Altın ve EUR/USD kartlarında site etiketi sabit "24H" yazıyor; çekimden önce "1D"ye
çevrilir.) BTC ve ETH'de son 24 saat çizilir. Seriler CNBC'nin 1 dakikalık barlarından (kriptoda borsa
mumlarından) gelir. CNBC'nin altın barlarındaki boşluklar COMEX vadeli barlarından, iki seri arasındaki
fark kadar kaydırılarak doldurulur. CNBC'nin grafik servisi hiç yanıt vermezse altın kartında PAXG
mumlarının yalnızca şekli (spot düzeyine taşınmış, "24H" etiketiyle), EUR/USD'de Kraken mumları
kullanılır. **Yüzde hiçbir durumda token'dan türetilmez:** önceki kapanış bilinmiyorsa rozet boş (—)
kalır ve mesaja not düşer.

**Kaynak denetimi.** Altında üç kaynak da tazeyken diğer ikisinden %0,25'ten fazla ayrışan kaynak
elenir. EUR/USD ve DXY'de iki kaynak birbirini tutmazsa son 1 dakikalık bar (EUR/USD'de ayrıca Kraken)
hakem olur; o da çözmezse öncelikli kaynak yayımlanır ve mesaja "kaynakları birbirini tutmuyor" notu
düşer. Brent ve kriptoda kaynaklar birbiriyle karşılaştırılmaz.

**Sessiz kalmayan durumlar.** Aşağıdakiler Slack/Telegram mesajına tek satırlık `Not:` olarak düşer ve
Actions günlüğüne yazılır:

- piyasa açıkken en taze veri 2 dakikadan (Brent'te 4 dakikadan) eskiyse: "BRENT verisi 10 dk öncesine ait";
- hafta sonu: "Döviz ve emtia piyasaları kapalı; DXY, BRENT, EUR/USD, XAU/USD son kapanış fiyatını gösteriyor";
- bir kartın verisi hiç alınamazsa, günlük değişimi hesaplanamazsa ya da Brent sitenin kendi kaynağına
  bırakıldıysa;
- kartta yazan değer verilen değerle aynı değilse (site veri mantığını değiştirmiş demektir).

Resmî tatiller ayrıca tanımlı değil: o günlerde saatlerce eski veri "(piyasa kapalı olabilir)" notuyla
gönderilir.

**Sayfanın kendi verisi neden kullanılmıyor** (11.11.2026 ölçümü):

- "XAU/USD — Gold (Spot)" kartı spot altın değil **PAXG token'ının** fiyatını gösteriyordu: spot 4.044 $
  iken 4.032 $ (token o hafta spotun 31 $ altı ile 22 $ üstü arasında gezdi). Yüzde de token'ın son
  24 saatteki değişimiydi (−%0,75); spot o gün önceki kapanışa göre artıdaydı.
- Posterde EUR/USD ve DXY `open.er-api.com`'dan geliyordu; ücretsiz katmanı **günde bir kez**
  güncelleniyor: 1,1187 gösterilirken gerçek 1,1135'ti (52 pip), DXY 102,07 gösterilirken gerçek
  102,53'tü. (Sayfanın birincil EUR/USD kaynağı Binance; GitHub'ın ABD sunucularından erişilemiyor.)
  Bu iki kartın yüzdesi de ikinci veri yoklamasından sonra hep "%0,00" görünüyordu.
- Brent doğru enstrümandı ama 10 dakika gecikmeliydi.
- Grafik kaynakları (Binance, vekil üzerinden Yahoo) GitHub'ın ABD sunucularından erişilemiyor.

Aynı sorunlar sitenin kendisinde (ziyaretçilerin gördüğü sayfalarda) sürüyor; kalıcı çözüm sitenin veri
katmanında (`src/lib/marketData.js`). Bu repo yalnızca Slack'e giden posteri düzeltiyor. Bu yüzden
mesajdaki bağlantıya tıklayan kişi sayfada posterdekinden farklı değerler görebilir.

**Bu düzen sitenin iç yapısına bağlı.** Yakalama, sayfanın hangi adreslerden veri istediğine
dayanıyor. Site değişirse kartlar yeniden sayfanın kendi verisini gösterebilir; doğrulama adımı bunu
yakalar ve mesaja not düşer. Site güncellendikten sonra `npm run poster:sozlesme` ile sınayın.

```
src/piyasa.js        → fiyat, günlük değişim ve grafik serileri (kaynak seçimi, tazelik denetimi)
src/poster-veri.js   → sayfanın veri isteklerini bu veriyle yanıtlar, kartları doğrular
src/capture.js       → Playwright ile poster yakalama
src/slack.js         → Slack'e dosya yükleme (kanal başına ayrı yükleme)
src/index.js         → akışı yöneten giriş noktası
scripts/fiyat-kontrol.mjs   → o anki fiyatlar, kaynakları ve yaşları (npm run fiyat)
scripts/fiyat-test.mjs      → kaynak seçimi senaryo testleri, ağsız (npm run fiyat:test)
scripts/poster-sozlesme.mjs → gerçek sayfada yakalama testi (npm run poster:sozlesme)
scripts/make-icons.mjs → Slack app ikonu varyantlarını üretir (assets/ altına)
.github/workflows/market-poster.yml → gönderim saatlerini bekleyen, kendini yeniden tetikleyen iş
```

---

## Kurulum

### 1. Slack app'i oluştur ve token'ı al

> Bu adım için Slack workspace'inde app kurma yetkin olması gerekiyor. Yetkin yoksa
> workspace admin'inden bu adımları yapmasını veya sana "app oluşturma" izni vermesini isteyebilirsin.

1. https://api.slack.com/apps → **Create New App** → **From scratch**
2. İsim: `Vestaprime Market Poster`, workspace'i seç → **Create App**
3. Sol menüden **OAuth & Permissions** → **Scopes → Bot Token Scopes** altına şunları ekle:
   - `files:write` → dosya (poster) yükleyebilmek için
   - `chat:write` → mesaj/açıklama yazabilmek için
4. Sayfanın üstünde **Install to Workspace** → izinleri onayla.
5. Karşına çıkan **Bot User OAuth Token**'ı kopyala — `xoxb-` ile başlar. Bu değer gizlidir, kimseyle paylaşma.
6. Slack'te poster'ın gideceği kanala git ve botu davet et:
   ```
   /invite @Vestaprime Market Poster
   ```
7. **Kanal ID'sini al:** kanal adına tıkla → açılan pencerede en altta **Channel ID** (`C` ile başlar) yazar. Kopyala.

### 2. GitHub reposunu hazırla

Bu klasörü private bir GitHub reposuna yükle:

```bash
cd "slack otomasyonu"
git init
git add .
git commit -m "Market poster Slack otomasyonu"
gh repo create vestaprime-market-poster --private --source=. --push
```

> `gh` kurulu değilse GitHub'da elle boş bir **private** repo açıp
> `git remote add origin <repo-url> && git push -u origin main` yapabilirsin.

### 3. Secret'ları ekle

GitHub repo sayfasında **Settings → Secrets and variables → Actions → New repository secret**:

| Secret adı | Değer |
|---|---|
| `SLACK_BOT_TOKEN` | 1. adımdaki `xoxb-...` token |
| `SLACK_CHANNEL_ID` | 1. adımdaki `C...` kanal ID'si |

**Birden fazla kanal:** `SLACK_CHANNEL_ID` değerini virgülle ayırarak birden çok kanal verebilirsin —
`C0AAAAAAAAA,C0BBBBBBBBB` gibi. Poster her kanala ayrı ayrı yüklenir ve **bot her kanala `/invite`
ile davet edilmiş olmalıdır**; edilmemişse o kanal için `not_in_channel` hatası alınır (diğer kanallara
gönderim yine de yapılır, ancak çalıştırma hatalı olarak işaretlenir).

### 4. Test et

Repo → **Actions** sekmesi → **Market Poster -> Slack** → **Run workflow**.
İş bir sonraki gönderim saatini bekler (anında poster göndermez). Bundan sonrası otomatik.

---

## Lokalde çalıştırma / test

```bash
npm install
npx playwright install chromium

# Sadece PNG üret, Slack'e gönderme (out/ klasörüne yazar):
npm run capture

# Fiyatlar şu an nereden geliyor, ne kadar taze? (hiçbir şey göndermez)
npm run fiyat

# Kaynak seçimi testleri (ağ kullanmaz) ve gerçek sayfada yakalama testi:
npm run fiyat:test
npm run poster:sozlesme

# Slack'e de gönder (önce .env dosyasını doldur):
cp .env.example .env
npm start
```

---

## Ayarlar

### Gönderim sıklığı

Gönderim saatleri **Türkiye saatiyle** `POSTER_SAATLERI` repo değişkeninden okunur; koda dokunmaya
gerek yok: GitHub repo → **Settings → Secrets and variables → Actions → Variables → New repository
variable** → ad `POSTER_SAATLERI`, değer örneğin `11:00,14:00,16:00`. Değişken yoksa varsayılan
`11:00,14:00,16:00,16:50,17:00,18:00` kullanılır. Yeni değer bir sonraki halkada (en geç ~5 saat) devreye girer.

Neden cron değil: GitHub'ın zamanlayıcısı bu repoda cron'ları saatlerce geç çalıştırıyor ya da hiç
çalıştırmıyor. İş bu yüzden saatleri kendisi bekliyor ve ~5 saatte bir kendini yeniden tetikliyor.
Yakalama birkaç saniye sürer; mesaj hedef saatten yarım dakika içinde düşer.

### Diğer

`.env` veya workflow `env:` bloğu üzerinden:

- `SLACK_CHANNEL_ID` — tek kanal (`C123...`) veya virgülle ayrılmış birden çok kanal (`C123...,C456...`)
- `POSTER_URL` — farklı bir dil/sayfa kullanmak için (varsayılan `https://vestaprimes.com/en/market-poster`)
- `TZ_NAME` — saat damgası ve dosya adı için zaman dilimi (varsayılan `Europe/Istanbul`)
- `LIVE_TIMEOUT_MS` — fiyatların çizilmesi için beklenecek süre (varsayılan 60000)
- `BRENT_ROLL_IS_GUNU` — Brent'te ikinci ay kontratına vadeye kaç iş günü kala geçileceği (varsayılan 5)
- `GRAFIK_BEKLEME_SN` — grafiklerin çizilmesi için üst sınır (varsayılan 50; workflow'da
  `POSTER_GRAFIK_BEKLEME_SN` repo değişkeniyle değiştirilir). Veri hazır geldiği için normalde birkaç
  saniye sürer; serisi hiç alınamamış bir kart için beklenmez.

Poster eksik ya da bayat veriyle yakalanırsa iş yine de tamamlanır, ancak Slack mesajının altına ne
olduğunu söyleyen bir `Not:` satırı düşülür (örneğin "BRENT verisi 10 dk öncesine ait",
"XAU/USD için canlı veri alınamadı"). Bir gönderim hiç yapılamazsa (hiçbir kaynak yanıt vermedi, Slack
hatası) o halka Actions'ta hatalı (kırmızı) biter; zincir yine de devam eder.

---

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| `not_in_channel` | Bot kanala davet edilmemiş → `/invite @Vestaprime Market Poster` |
| `missing_scope` | `files:write` scope'u eklenmemiş → scope'u ekleyip app'i **yeniden install** et |
| `invalid_auth` | Token yanlış/süresi dolmuş → secret'ı güncelle |
| Bir kartta `·····` | O enstrümanın hiçbir kaynağı yanıt vermedi; Actions günlüğündeki "Piyasa verisi" bölümü hangi kaynağın neden düştüğünü yazar |
| Mesajda "… kaynakla uyuşmuyor" ya da "Posterdeki değerler kaynakla doğrulanamadı" notu | Site veri mantığını ya da tasarımını değiştirmiş, yakalama devre dışı kalmış → `npm run poster:sozlesme` ile bak; `src/poster-veri.js` sitenin yeni isteklerine göre güncellenmeli |
| Mesajda "… kaynakları birbirini tutmuyor" notu | İki kaynak farklı fiyat veriyor ve hangisinin doğru olduğu belirlenemedi → `npm run fiyat` ile kaynakları yan yana gör |
| Actions çalışmıyor | Repo 60 gün hareketsiz kalırsa GitHub zamanlanmış işleri durdurur → repoya bir commit at veya Actions'tan yeniden etkinleştir |

Hata durumunda workflow, ürettiği PNG'yi 3 gün boyunca **Artifacts** altında saklar — çalıştırma sayfasından indirip bakabilirsin.

---

# 2) Son Dakika Finansal Haber → Slack

Türkçe yayın yapan finansal RSS kaynaklarını tarar, önem skoruna göre filtreler ve geçenleri
**SON DAKİKA** başlığıyla Slack'e gönderir.

**Tarama sıklığı:** ABD piyasası açıkken (hafta içi TR 16:00–24:00) 10 dakikada bir,
diğer tüm saatlerde 30 dakikada bir.

## Kaynaklar

Canlı test sonucu seçilenler — hepsi Türkçe, global finansal gelişmeleri dakikalık tazelikte veriyor:

14 kaynak, ~260 benzersiz haber/tur. Tam liste ve ağırlıklar: [src/news/sources.js](src/news/sources.js)

| Kaynak | Kategori | Not |
|---|---|---|
| `investing.com` news_14 | Ekonomi | Merkez bankaları, makro |
| `investing.com` news_95 | Ekonomi | Ekonomi göstergeleri — ABD seansının ana damarı |
| `investing.com` news_11 | Emtia | Petrol, altın, tahıl |
| `investing.com` news_1 | Döviz | |
| `investing.com` news_285 | Kripto | |
| `investing.com` news_25 | Borsa | Düşük ağırlık — tekil hisse gürültüsü yoğun |
| Anadolu Ajansı | Ekonomi | |
| CNN Türk | Ekonomi | |
| Habertürk | Ekonomi | |
| Milliyet | Ekonomi | |
| Sözcü | Ekonomi | Düşük ağırlık |
| Ekonomim | Ekonomi | Düşük ağırlık |
| CoinTurk | Kripto | 7/24 akış — gece saatlerini besler |
| UzmanCoin | Kripto | |

**Elenenler ve sebepleri (canlı test edildi):** `bloomberght.com` (feed günlerdir güncellenmiyor),
`investing.com/central_banks` (son içerik 2022), `gazeteduvar` (1.4 yıldır güncellenmiyor),
`paraanaliz` / `bigpara` / `ntv` (feed ölü veya boş), `cumhuriyet` (ekonomi feed'i genel gündem
döndürüyor), `cointelegraph.tr` (410 Gone), `dunya.com` (ağırlıkla yerel gündem),
`financialjuice` (her ekonomik verinin ham akışı — Slack için fazla).

## Filtre nasıl çalışıyor?

"SON DAKİKA" etiketinin güvenilir kalması için sistem bilerek muhafazakâr: emin olmadığını göndermez.

1. **Veto** — tekil hisse açıklamaları (*"X hissesi bugün neden yükseldi?"*), analist notları,
   eğitim/promosyon içerikleri ve konu dışı yerel gündem doğrudan elenir.
2. **Konu puanı** — merkez bankası/para politikası (6), makro veri (5), jeopolitik (5), kriz (5),
   ana varlıklar (3), genel piyasa (2).
3. **Olay sinyali** — *konunun önemli olması yetmez, ortada gerçekleşmiş bir olay olmalı.*
   "açıkladı", "istifa etti", "beklentileri aştı", "%6 düştü" gibi kalıplar aranır. Olay sinyali
   yoksa puan 0.45 ile çarpılır. Bu olmadan günlük piyasa köşeleri (*"Altın Fed odağında ilerliyor"*)
   sırf "Fed" geçtiği için eşiği geçiyordu.
4. **Rutin cezası** — *"Sterlin bugün:"*, *"... öncesi düştü"*, *"gölgesinde"*, *"haftalık görünüm"*
   gibi köşe yazısı dili puan düşürür.
5. **Eşik** — kaynak ağırlığıyla çarpılan puan `NEWS_MIN_SCORE`'u (varsayılan 6) geçmeli.

Filtreyi canlı veriyle görmek ve ayarlamak için:

```bash
npm run news:tune        # varsayılan eşikle
npm run news:tune 6      # daha gevşek eşik dene
```

Bu komut hiçbir şey göndermez; her haberin puanını, hangi kuraldan kaç puan aldığını ve
eşiği geçip geçmediğini listeler.

## Tekrar gönderim koruması

İki katman:

- **Kimlik** — her haberin linkinden üretilen hash `state/seen-news.json` içinde tutulur.
- **Benzerlik** — aynı olayın farklı kaynaklardaki versiyonları elenir. Karşılaştırma **4-gram
  Jaccard** ile yapılır; Türkçe sondan eklemeli olduğu için kelime bazlı karşılaştırma
  ("gerilimi" / "geriliminin" / "gerilimin") aynı haberin iki versiyonunu yakalayamıyor.
  Karşılaştırma sadece aynı tur içinde değil, son 24 saatte gönderilmiş başlıklara karşı da yapılır.

Geçmiş dosyası her çalıştırmada repoya commit'lenir (`[skip ci]` ile, sonsuz döngü olmaz).
Actions cache yerine commit tercih edildi: cache silinebilir, commit denetlenebilir.

## Ayarlar

`.env` veya workflow `env:` üzerinden:

| Değişken | Varsayılan | Ne yapar |
|---|---|---|
| `NEWS_CHANNEL_ID` | — | Hedef kanal(lar). Virgülle çoklu kanal verilebilir. |
| `NEWS_MIN_SCORE` | `6` | Gönderim eşiği. Düşürmek daha çok haber gönderir. |
| `NEWS_MAX_AGE_HOURS` | `3` | Bundan eski haber "son dakika" sayılmaz. |
| `NEWS_MAX_PER_RUN` | `3` | Tek turda gönderilecek azami haber (ani akında kanalı boğmaz). |

Sıklık: [.github/workflows/breaking-news.yml](.github/workflows/breaking-news.yml) içindeki `cron` satırları.
Üç ayrı zamanlama var: ABD seansı (yoğun), hafta içi diğer saatler, hafta sonu.

## Elle test

Actions → **Son Dakika -> Slack** → **Run workflow**. İki parametre sunar:

- `max_age_hours` — geniş pencereyle test etmek için (örn. `48`)
- `dry_run` — işaretlenirse Slack'e hiçbir şey gönderilmez, sadece ne gideceği loglanır

Lokalde:

```bash
npm run news:dry    # sadece göster
npm run news        # gerçekten gönder
```

---

# 3) FinancialJuice (Telegram) → Slack

[t.me/Financial_Juice_News](https://t.me/Financial_Juice_News) kanalındaki ham piyasa akışını
Türkçeye çevirip Slack'e aktarır. Filtre yoktur — kanaldaki her başlık gider.

**Hacim:** ölçüldü, günde **~1.300 başlık**. Bu, dakikada yaklaşık bir mesaj demektir.

## Nasıl okunuyor?

Telegram Bot API bir kanalı ancak bot orada admin ise okuyabiliyor; bu kanal bize ait olmadığı için
herkese açık web önizlemesi (`t.me/s/<kanal>`) ayrıştırılıyor. Kimlik doğrulama gerekmiyor.

**Kritik ayrıntı:** önizleme ardışık mesajları **tek blokta birleştiriyor**. Bir blok `<br>` ile
ayrılmış ortalama **3,3 bağımsız başlık** taşıyor:

```
EU plans to sanction record 1,600 firms for helping Russia
Effective Fed Funds Rate 3.63% July 27 vs 3.63% July 24
US CASESHILLER 20 YOY ACTUAL 1.63% (FORECAST 1.3%, PREVIOUS 1.1%)
```

Bunlar tek Slack mesajında birleşik görünmesin diye bloklar satırlarına ayrılıp her başlık ayrı
mesaj yapılıyor. Blok sayısını başlık sayısı sanmak hacmi 3,5 kat düşük tahmin etmeye yol açar.

## Çeviri — ücretsiz

Varsayılan olarak **API anahtarı ve maliyet gerektirmez**. Canlı test edilen sağlayıcılar:

| Sağlayıcı | Durum | Hız | Rol |
|---|---|---|---|
| Google (gtx) | ✅ | 70-300ms | Birincil |
| MyMemory | ✅ | 350-700ms | Yedek |
| Lingva | ❌ HTTP 500 | | Kullanılmıyor |
| LibreTranslate | ❌ Anahtar istiyor | | Kullanılmıyor |

Google resmi bir API değil ve datacenter IP'lerinden hız sınırına takılabilir — bu yüzden MyMemory
yedeği opsiyonel değil, zorunlu. İkisi de başarısız olursa başlık İngilizce gider ve mesaja
"_çeviri yapılamadı_" notu düşer.

Çeviri sonrası iki düzeltme uygulanır: kaynaktaki `$MACRO` gibi semboller geri konur (çevirmen
`$ MAKRO` yapıyordu) ve veri açıklama kalıpları finans diline oturtulur (`ACTUAL` → `GERÇEKLEŞEN`).

**Claude'a geçmek istersen:** repo → Settings → Variables → `TRANSLATOR` = `claude`, ayrıca
`ANTHROPIC_API_KEY` secret'ı. Tahmini maliyet: Haiku 4.5 ile ~$16/ay, Opus 5 ile ~$80/ay.

## Tekrar koruması — iki katman

1. **İçerik hash'i** — harf ve rakam dışındaki her şey atılarak hesaplanır. Kanal aynı başlığı sık
   sık bir `🔴` önekiyle tekrar atıyor; ham hash bunu yakalayamıyordu.
2. **Benzerlik** — kanal aynı hikâyeyi farklı kelimelerle tekrarlıyor. Ölçülen bir örnekte tek bir
   Moonshot/Nvidia haberi **5 varyantla** gelmişti. 4-gram Jaccard eşiği gerçek veriyle belirlendi:
   aynı hikâye varyantları 0,33-0,93, bağımsız başlıklar ≤0,02 — eşik **0,30**.

Geçmiş repoya commit'lenmez, **Actions cache**'te tutulur: 5 dakikalık iş günde ~288 commit demek olurdu.

## Ayarlar

| Değişken | Varsayılan | Ne yapar |
|---|---|---|
| `TELEGRAM_CHANNEL_ID` | — | Hedef kanal(lar), virgülle çoklu |
| `TRANSLATOR` | `free` | `claude` seçilirse `ANTHROPIC_API_KEY` gerekir |
| `TELEGRAM_MAX_PER_RUN` | `15` | Tek turda azami başlık |
| `TELEGRAM_FIRST_RUN` | `3` | İlk çalıştırmada alınacak başlık |
| `TELEGRAM_SIMILARITY` | `0.3` | Tekrar eleme eşiği |
| `TELEGRAM_CHANNEL` | `Financial_Juice_News` | Kaynak Telegram kanalı |

## Bilinen sınırlama

Ücretsiz çevirmen bazı finans kısaltmalarını yanlış çeviriyor (`MOC IMBALANCE` → `MOO DENGESİZLİK`).
Her mesajda kaynak linki olduğu için doğrulanabilir. Rahatsız ederse `TRANSLATOR=claude` bunu çözer.

## Elle test

```bash
npm run juice:dry    # sadece göster
npm run juice        # gerçekten gönder
```

Actions → **FinancialJuice -> Slack** → **Run workflow** (varsayılan `dry_run: true`).

---

# 4) Günün Tahmini (altın oylaması) → Slack

Hafta içi her gün TR 14:00'te kanala bir oylama düşer: "Altın, ABD açılışından sonraki 1 saatte nasıl
seyreder?" (Yukarı / Aşağı / Durağan). Açılış fiyatı 09:30 New York'ta, kapanış bir saat sonra okunur;
değişim ±%0,15'in içindeyse "Durağan" sayılır. Sonuç ve doğru bilenler kanala yazılır.

**Fiyat:** gerçek spot altın (`src/poll/price.js` → `src/piyasa.js`): Swissquote → CNBC → gold-api.com. Açılış ve kapanış **aynı kaynaktan** eşleştirilir; kaynağın adı `state/poll-history.json`
kaydına yazılır. 11.11.2026'ya kadar fiyat PAXG token'ından (ya da vadeli kontrattan) okunuyordu ve
hangisinin okunduğu kaydedilmiyordu; o tarihten önceki kayıtlarda `kaynak` alanı yoktur.

- Her okuma, taze fiyat gelene kadar 3 dakika boyunca 15 saniyede bir yeniden denenir.
- **Tatil:** 14:00'te spot piyasa kapalı görünüyorsa (Swissquote ve CNBC'de son işlem 30 dakikadan
  eski: 25 Aralık, 1 Ocak, Kutsal Cuma) o gün oylama açılmaz. ABD borsasının kapalı ama altının
  açık olduğu günlerde (Şükran Günü gibi) oylama yine yapılır.
- Açılış ya da kapanış fiyatı güncel değilse sonuç **ilan edilmez**; oylama kanalda açık kalır ve
  halka Actions'ta hatalı biter. Elle sonuçlandırmak için:

```bash
npm run poll:settle -- --acilis 4046.50 --kapanis 4050.10   # 09:30 ve 10:30 New York spot fiyatları
npm run poll:settle -- --dry-run                             # ne ilan edileceğini göster, gönderme
```

`poll:settle` kayıtlı açılışı kullanır; sonuç saati 10 dakikadan fazla geçtiyse `--kapanis` ister
(o anki fiyat "1 saat sonraki fiyat" değildir). Bir kanala gönderim başarısız olduysa hesaplanan sonuç
saklanır ve `poll:settle` aynı sonucu kalan kanala gönderir.

---

# Telegram çıkışı — Slack'e gidenlerin kopyası

Slack'e giden içerik aynı anda bir Telegram kanalına da gönderilebilir.

> **İsim karışıklığına dikkat:** `src/telegram/` klasörü Telegram'dan **okur**
> (FinancialJuice kanalının web önizlemesini ayrıştırır). `src/telegram-out/` ise
> Telegram'a **yazar**. İkisi ayrı işler, bilerek ayrı klasörlerde.

## Kurulum

### 1. Bot oluştur

Telegram'da [@BotFather](https://t.me/BotFather) ile konuş:

```
/newbot
→ Bot adı:      Vestaprime Haber
→ Kullanıcı adı: vestaprime_haber_bot   (sonu "bot" ile bitmeli, benzersiz olmalı)
```

BotFather sana `123456789:AAH...` biçiminde bir **token** verir. Bu değer gizlidir.

### 2. Botu kanala admin yap

Telegram kanalın → **Yönet** → **Yöneticiler** → **Yönetici Ekle** → botun kullanıcı
adını ara → ekle. **"Mesaj Gönder" yetkisi açık olmalı**, diğerleri kapalı kalabilir.

> Bot kanala sadece üye olarak eklenirse mesaj atamaz — **admin** olması şart.

### 3. Kanal kimliğini bul

Herkese açık kanalda `@kanaladi` doğrudan kullanılabilir. Özel kanalda `-100...`
biçiminde bir kimlik gerekir. Botu admin yaptıktan sonra kanala bir mesaj at, sonra:

```bash
npm run tg:bul
```

Bot'un gördüğü sohbetleri kimlikleriyle listeler.

### 4. Hangi akış nereye gitsin

`.env` (lokal) veya GitHub repo secret'ları:

| Değişken | Ne gönderilir |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot anahtarı (ortak, zorunlu) |
| `TELEGRAM_OUT_NEWS` | Son Dakika haberleri |
| `TELEGRAM_OUT_JUICE` | FinancialJuice ham akışı |
| `TELEGRAM_OUT_POSTER` | Piyasa posteri (görsel) |
| `TELEGRAM_OUT_POLL` | Günün tahmini sonucu |

**Boş bırakılan gönderilmez.** Yani Telegram'ı akış akış devreye alabilirsin;
tanımlamadığın sürece mevcut Slack davranışı hiç değişmez.

### 5. Doğrula

```bash
npm run tg:check    # token geçerli mi, hangi akış nereye gidiyor
npm run tg:test     # her tanımlı kanala bir test mesajı at
```

## Tasarım notu

Telegram gönderimi **Slack akışını asla durdurmaz**. Her gönderim kendi içinde
yakalanır; Telegram tarafındaki bir hata (token yanlış, bot kanaldan atılmış,
hız sınırı) yalnızca uyarı olarak loglanır ve Slack gönderimi normal devam eder.

Hız sınırı: Telegram kanal başına dakikada ~20 mesaja izin veriyor. FinancialJuice
tur başına 15 mesaja kadar gönderebildiği için mesajlar arasında 3 saniye aralık
bırakılıyor (`TELEGRAM_OUT_DELAY_MS`). `429` yanıtında Telegram'ın bildirdiği
süre kadar beklenip bir kez yeniden denenir.

## Marka kuralı — Telegram kanalı

Telegram kanalı **ayrı bir markadır**. Buradan çıkan hiçbir mesajda kurum adı,
alan adı veya başka bir marka izi bulunmaz.

Bu yalnızca bir kural değil, kodda zorlanıyor: `src/telegram-out/client.js`
içindeki koruma, gönderilecek metinde marka izi bulursa **mesajı göndermez** ve
hata loglar. Şablona yanlışlıkla marka eklenirse sessizce sızmak yerine görünür
şekilde durur.

> ⚠️ **Poster istisnası:** piyasa posterinin **görselinin içinde** logo ve
> `vestaprimes.com` yazısı var; bu metin filtresiyle temizlenemez. Bu yüzden
> `TELEGRAM_OUT_POSTER` markasız bir kanal için **boş bırakılmalıdır**.
