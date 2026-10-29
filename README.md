# Vestaprime Slack Otomasyonları

Bu repo üç bağımsız otomasyon barındırır. Üçü de aynı Slack app'ini (`Vestaprime Son Dakika`)
ve aynı bot token'ını kullanır, ancak ayrı workflow'lar olarak çalışır.

| Otomasyon | Ne yapar | Sıklık | Kanal secret'ı |
|---|---|---|---|
| **Market Poster** | Canlı piyasa posterini yakalar, PNG olarak gönderir | TR 11:00, 14:00, 16:00, 16:50, 17:00, 18:00 | `SLACK_CHANNEL_ID` |
| **Son Dakika** | Önemli global finansal haberleri filtreleyip gönderir | 10 dk (ABD seansı) / 30 dk | `NEWS_CHANNEL_ID` |
| **FinancialJuice** | Telegram ham piyasa akışını Türkçeye çevirip aktarır | 5 dakikada bir | `TELEGRAM_CHANNEL_ID` |

---

# 1) Market Poster → Slack

[vestaprimes.com/en/market-poster](https://vestaprimes.com/en/market-poster) sayfasındaki canlı piyasa posterini
otomatik olarak yakalayıp Slack kanalına gönderir. Elle "Download PNG" tıklamaya gerek kalmaz.

**Çıktı:** 1080×1350 PNG (sayfadaki indirme butonuyla birebir aynı ölçü).
**Zamanlama:** Her gün TR 11:00, 14:00, 16:00, 16:50, 17:00 ve 18:00 — başka hiçbir saatte gönderilmez.

---

## Nasıl çalışıyor?

Poster sunucuda duran hazır bir dosya değil — sayfa açıldığında tarayıcıda canlı fiyatlarla çiziliyor
(fiyatlar Binance / CoinGecko / open.er-api'den geliyor). Bu yüzden otomasyon gerçek bir tarayıcı çalıştırıyor:

1. Headless Chromium ile `/en/market-poster` sayfası açılır.
2. Fiyatlar gelip durum rozeti **LIVE** olana kadar beklenir (fiyat alanlarındaki `·····` kaybolana kadar).
   Ardından kartlardaki mini grafikler beklenir: sayfa açıldıktan sonra en fazla 50 sn, altı grafik
   daha erken gelirse hemen çekilir. Grafikler gelmezse poster yine gider.
   Grafik verisini sayfa Binance'ten ve Yahoo'dan (vekil üzerinden) çekiyor; bunlar GitHub'ın
   ABD makinelerinden erişilemediği için istekler yolda yakalanıp Binance'in veri adresi, Kraken
   ve doğrudan Yahoo'dan karşılanıyor (`src/poster-veri.js`).
3. Sayfanın kartı ekrana sığdırmak için uyguladığı küçültme (`--s` CSS değişkeni) iptal edilir, kart tam 1080×1350 boyutunda ekran görüntüsü olarak alınır.
4. PNG, Slack Web API ile kanala dosya olarak yüklenir.

```
src/capture.js       → Playwright ile poster yakalama
src/poster-veri.js   → grafik verisini sağlar (sitenin kaynakları GitHub'ın ABD makinelerinden erişilemiyor)
src/slack.js         → Slack'e dosya yükleme (kanal başına ayrı yükleme)
src/index.js         → akışı yöneten giriş noktası
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
Yakalama ~1 dk sürdüğü için mesaj hedef saatten yaklaşık bir dakika sonra düşer.

### Diğer

`.env` veya workflow `env:` bloğu üzerinden:

- `SLACK_CHANNEL_ID` — tek kanal (`C123...`) veya virgülle ayrılmış birden çok kanal (`C123...,C456...`)
- `POSTER_URL` — farklı bir dil/sayfa kullanmak için (varsayılan `https://vestaprimes.com/en/market-poster`)
- `TZ_NAME` — saat damgası ve dosya adı için zaman dilimi (varsayılan `Europe/Istanbul`)
- `LIVE_TIMEOUT_MS` — fiyatların gelmesi için beklenecek süre (varsayılan 60000)
- `GRAFIK_BEKLEME_SN` — sayfa açıldıktan sonra grafikler için en fazla kaç saniye beklenecek (varsayılan 50;
  workflow'da `POSTER_GRAFIK_BEKLEME_SN` repo değişkeniyle değiştirilir)

Poster canlı fiyatlara geçemeden yakalanırsa iş yine de tamamlanır, ancak Slack mesajının altına
"fiyatlar canlı akışa geçmeden yakalandı" notu düşülür.

---

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| `not_in_channel` | Bot kanala davet edilmemiş → `/invite @Vestaprime Market Poster` |
| `missing_scope` | `files:write` scope'u eklenmemiş → scope'u ekleyip app'i **yeniden install** et |
| `invalid_auth` | Token yanlış/süresi dolmuş → secret'ı güncelle |
| Poster boş veya fiyatlar `·····` | Fiyat API'leri yavaş → `LIVE_TIMEOUT_MS` değerini artır |
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
