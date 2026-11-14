<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · **Türkçe** · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

<br />

<img src="../../packages/dsh-rsi/icon.svg" alt="DSHRSI" width="88" />

# DSHRSI: DeepSeek Harness için Özyinelemeli Kendini Geliştirme (Recursive Self-Improvement)

### **Gözlemle → Geliştir → Üzerine İnşa Et → Yeniden. Giderek daha çok sizin olan bir harness.**

<a href="https://qybaihe.github.io/dshrsi/trace.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/rsi-trace.dark.gif" />
    <img src="../../assets/rsi-trace.gif" alt="Gerçek bir çalıştırmanın animasyonlu izi: standart harness'te 30 oturumun 12'si aynı başarısız çağrıyı yapıyor; DSHRSI ile harness üçüncü seferde kendini geliştiriyor ve sonraki 22 oturumda bu yalnızca bir kez yaşanıyor" width="960" />
  </picture>
</a>

**RSI, Recursive Self-Improvement, yani Özyinelemeli Kendini Geliştirme demek; DSHRSI de bunu DeepSeek Harness için gerçeğe dönüştüren açık kaynaklı plugin. Harness kendi çalışmasını izler, bulduğu sorunlar için oturumun kendi modeline harness kodu yazdırır, bu kodun işe yaradığını 5 aşamalı bir kapıda kanıtlar ve tur bitmeden mount eder. Ardından kendini geliştirmiş harness bir sonraki oturumu yürütür ve bir kez daha gelişir. Fine-tuning yok. Prompt yığını yok. Ölçülen, saklanan, yeniden yazılan ya da çöpe atılan kod var.**

[![RSI](https://img.shields.io/badge/RSI-Recursive_Self--Improvement-4d6bfe?style=for-the-badge)](#rsi)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-0.2.2--rc.3_plugin-7c5cff?style=for-the-badge)](https://github.com/deepseek-ai/deepseek-harness)
[![Validation](https://img.shields.io/badge/Validation-5--Stage_Gate-0ea5e9?style=for-the-badge)](#how-it-works)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-4_Suites_%C2%B7_2_Models-2563eb?style=for-the-badge)](#benchmarks)
[![MIT License](https://img.shields.io/badge/License-MIT-38bdf8?style=for-the-badge)](../../LICENSE)

**[🌐 Web Sitesi](https://qybaihe.github.io/dshrsi/) · [📖 Plugin Referansı](../../packages/dsh-rsi/README.md) · [🐛 Issue'lar](https://github.com/qybaihe/dshrsi/issues)**

[RSI Ne Demek](#rsi) · [Hızlı Başlangıç](#quick-start) · [Nasıl Çalışır](#how-it-works) · [Ölçülen Sonuçlar](#measured) · [Benchmark'lar](#benchmarks) · [Dedektörler ve Yetenekler](#coverage) · [Proje Harness'i](#project-harness) · [Güvenlik Varsayılanları](#security) · [SSS](#faq)

</div>

---

> [!IMPORTANT]
> **Geliştirici Önizlemesi:** DSHRSI, DeepSeek Harness `0.2.2-rc.3` sürümüne göre geliştirildi; o sürümün kendisi de bir geliştirici önizlemesi. **Uyumluluğu bozan değişiklikler olacak.**
> Bir adaptasyon, bir modelin yazdığı ve harness'inizin içinde çalışan koddur. İzolasyonu hatalara karşı korur, **kötü niyetli koda karşı korumaz**. Çalıştırmadan önce [doğrulama kapısı](../../packages/dsh-rsi/README.md#the-validation-gate) bölümünü okuyun.

<div align="center">
<img src="../../assets/ui-evolving.png" alt="Bir DeepSeek Harness oturumu: iki araç çağrısı 127 çıkış koduyla başarısız oluyor, ardından harness kendini geliştirirken RSI rozeti ve mesaj kutusunun altındaki durum etiketi yanıyor" width="1200" />
</div>

<br />

<table>
<tr>
<td width="33%" valign="top">

### 🔴 DSHRSI Olmadan
Her oturum aynı gerçekleri yeniden keşfeder: bu makinede `python` yok, bu repoda zaten söylediğiniz bir kural var, bu düzeltme hiç doğrulanmadı. Kontrol çalıştırmasında **5 oturumun 5'i** aynı başarısız çağrıyı yaptı; kullanıcının söylediği bir kural da bir oturum sonra yeniden çiğnendi.

</td>
<td width="33%" valign="top">

### 🧬 DSHRSI ile
Sorun yeniden ortaya çıktığında model bir parça harness kodu yazar, kod kapıdan geçer ve **aynı turda** devreye girer. Gerçek bir modelle yapılan 3 çalıştırmada, adaptasyondan sonraki **7 oturumun 7'sinde** hiç başarısız çağrı olmadı. Bir sonraki geliştirme de buradan başlar.

</td>
<td width="33%" valign="top">

### 🔒 Tasarım Gereği Yalnızca Sıkılaştırır
Bir adaptasyon bilgi ekleyebilir, bir çağrıyı reddedebilir, önce size sorabilir ya da doğrulama talep edebilir. **Hiçbir yetenek, harness'in reddedeceği bir şeye izin veremez.** Sonuçları yeniden yazmak, araç eklemek ve komut çalıştırmak ise onayınızı bekler.

</td>
</tr>
</table>

---

<a id="rsi"></a>

## 🔁 RSI = Recursive Self-Improvement, Özyinelemeli Kendini Geliştirme

"Kendini yeniden yazma" değil. **Özyinelemeli Kendini Geliştirme**: bir sistem kendini geliştirmek için kendi yeteneklerini kullanır, bir sonraki döngüyü de kendini geliştirmiş sistem yürütür. Üç kelime; DSHRSI her birini hak etmek zorunda:

| | Ne Gerektirir | DSHRSI Bunu Nasıl Yapar |
| :--- | :--- | :--- |
| **Kendini (Self)** | Harekete geçen de değiştirilen de aynı sistemdir | Harness'i değiştiren, harness'in kendisidir. Adaptasyonu, sorunla karşılaşan oturumun kendi modeli yazar. Kimse dışarıdan ayar yapmaz |
| **Geliştirme (Improvement)** | "Daha iyi" sınanabilir olmalıdır | Her adaptasyon mount edilmeden önce 5 aşamalı bir kapıdan geçer, sonraki oturumlarda da sınanmaya devam eder: işe yarayan terfi eder, hata fırlatan karantinaya alınır |
| **Özyinelemeli (Recursive)** | Bir döngünün çıktısı bir sonrakini başlatır | Bir sonraki oturum, kendini geliştirmiş harness üzerinde çalışır ve onunla birlikte gözlemlenir. Yetersiz kalan bir adaptasyon, kanıtlara dayanılarak daha katı biçimde yeniden yazılır. İkinci bir çalışma alanında da gerek duyulan adaptasyon tüm makineye genişler; bir projenin kuralları da her ekip arkadaşının harness'ine taşınır |

**İç içe dört döngü:** tek bir turun içinde → oturumdan oturuma → geliştirmenin kendisi de geliştirilir → projeden makineye, oradan ekibe.

Bilerek özyinelemeli **olmayan** kısım: modelin ağırlıkları asla değişmez; dedektörler, tetikleme politikası ve doğrulama kapısı ise hiçbir adaptasyonun dokunamayacağı sabit koddur. Kendini değiştiren kısmı, onun değiştiremediği bir kısım denetler.

---

<a id="quick-start"></a>

## ⚡ 30 Saniyede Hızlı Başlangıç

### 1. Zaten Çalıştığınız Yere Kurun
DeepSeek Harness masaüstü uygulamasında ya da Web arayüzünde **Plugins → Add plugin → Install a third-party plugin** yolunu izleyin, sürüm paketinin adresini yapıştırın, önce **Install**'ı, ardından **Enable now**'ı seçin:

```text
https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
```

Ya da komut satırından. Her profil kendi plugin'lerini ayrı tutar; `dsh plugin add` ise `pnpm`'i çağırır, onun da `PATH` üzerinde olması gerekir:

```bash
dsh plugin --profile web add https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
dsh web
```

### 2. Her Zamanki Gibi Çalışın
Yapılandırılacak hiçbir şey yok. Aynı sorun yeniden ortaya çıkana kadar DSHRSI ortalıkta görünmez. Çıktığında **RSI** rozeti yanar, mesaj kutusunun altındaki durum etiketi harness'in az önce kendini değiştirdiğini bildirir ve bir sonraki oturum kendini geliştirmiş bir harness'le başlar:

<div align="center">
<img src="../../assets/ui-panel-dark.png" alt="Bir sonraki oturum: durum etiketi açık; iş başındaki adaptasyonu ve bu adaptasyonun daha çalışmadan reddettiği çağrıyı listeliyor" width="1200" />
</div>

Neyin mount edildiğini, hangi katmana ait olduğunu ve neyin onayınızı beklediğini görmek için herhangi bir oturumda `/rsi` yazın.

`desktop` ve `headless` profilleri, plugin index'leri, yerel tarball'lar ve yalnızca tek bir çalıştırma için yükleme [plugin referansında](../../packages/dsh-rsi/README.md#install) anlatılıyor.

---

<a id="how-it-works"></a>

## 🧠 DSHRSI Nasıl Çalışır: Harness'in İçinde Tekrar Tekrar Dönen Kapalı Bir Döngü

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/pit-stop.dark.svg" />
  <img src="../../assets/pit-stop.svg" alt="DSHRSI'nin çalışma şekli bir pit stop olarak çizildi: araba harness, pilot model, yeni parça ise turun ortasında yazılan harness kodu" width="960" />
</picture>
</div>

Skill'ler, bellek dosyaları ve daha uzun sistem prompt'ları bağlam düzeyinde çalışır: metin eklerler ve modelin buna uymasını umarlar. Model uymadığında, aynı başarısız çağrı bir sonraki oturumda yeniden yapılır.

**DSHRSI ise harness düzeyinde çalışır. Öğrendiği şey, harness'in kendi genişletme noktalarına oturan koda dönüşür:**

| Aşama | Mekanizma | Etki |
| :--- | :--- | :--- |
| **1. Gözlemle** | 16 dedektör normalize edilmiş oturum olaylarını okur: yeniden başarısız olan çağrılar, tekrar tekrar ortaya çıkan başarısızlık nedenleri, bocalama, kullanıcı düzeltmeleri, hiçbir şey doğrulanmadan biten turlar. | Sorun, bir oturumdan diğerine aynı kalan bir imza kazanır. |
| **2. Yeniden Yaz** | Oturumun kendi modeli, 10 yetenek sunan bir API'yi kullanarak JavaScript ile bir adaptasyon yazar. Reddedilen kod gerekçeleriyle birlikte geri gönderilir; bu en fazla iki kez olur, sonra yerleşik bir şablon devreye girer. | Çözüm, prompt'a eklenen bir paragraf daha değil, harness kodudur. |
| **3. Doğrula** | Statik → yükleme → tekrar oynatma → regresyon → izin. Adaptasyon, kendisini tetikleyen çağrılarda eyleme geçmek ve bu oturumda başarılı olmuş hiçbir çağrıya dokunmamak zorundadır. | Hiçbir şey yapmayan ya da zaten çalışan bir şeyi bozan kod asla mount edilmez. |
| **4. Mount Et** | Adaptasyon, kendi izole bağlamında, her çağrısı zaman aşımına tabi olarak çalışır ve bir sonraki model isteğinden önce etkinleşir. | Bundan ilk yararlanan, sorunla karşılaşan turun kendisidir. |
| **5. Sakla ve Paylaş** | Her makine bir adaptasyon kütüphanesi tutar. İşe yarayan terfi eder, hata fırlatan karantinaya alınır, yetersiz kalan daha katı biçimde yeniden yazılır, proje kuralları da reponun içine yazılır. | Bir sonraki oturum adapte olmuş hâlde başlar; ekip arkadaşları da kabul ettiklerinde projenin kurallarını alır. |
| **↻ Yeniden** | Bir sonraki oturum, 5. aşamanın geride bıraktığı harness üzerinde çalışır; 1. aşama da onu tüm adaptasyonlar yerindeyken gözlemler. | Gelişme, gelişmenin üzerine kurulur. Özyineleme işte budur. |

---

<a id="measured"></a>

## 🔬 Gerçek Bir Modelle Ölçüldü

Bu sayılar, gerçek bir modelin (`mimo-v2.6-pro`) gerçek `dsh` oturumlarında çalıştırılmasıyla elde edildi (`npm run test:live`). Bu tablodaki hiçbir şey simülasyon değil.

> **Nasıl okunmalı:** örneklem küçük. Tek model, üç senaryo, her birinde bir avuç oturum. Döngünün uçtan uca çalıştığını gösterir. Başarı oranları hakkında istatistiksel bir iddia **değildir** ve hiçbir şey hızlanmadı: bir adaptasyon yazmak, modeli 30–60 saniye beklemek demek. Daha büyük çalıştırmalar [Benchmark'lar](#benchmarks) bölümünde.

| Senaryo | DSHRSI Olmadan | DSHRSI ile | Harness Ne Yazdı |
| :--- | :--- | :--- | :--- |
| **Eksik komut**: talimatlar `python` diyor, makinede yalnızca `python3` var | ❌ **5 / 5** oturum başarısız çağrıyı yaptı | ✅ Adaptasyondan sonra **0 / 7** oturum (öncesinde 9 / 9) | `deny` + `prompt`; model yazdı, kapıdan ilk denemede geçti |
| **Kullanıcının bir kez söylediği kural**: belirli bir dosyayı asla değiştirme, bunun yerine o dosyanın taslağına yaz | ❌ Bir sonraki oturum dosyayı düzenledi | ✅ Bir sonraki oturum, hatırlatılmadan taslağa yazdı | `deny` + `prompt`; model, düzeltmenin hemen ardından yazdı |
| **Kimsenin doğrulanmasını istemediği bir düzeltme** | çalıştırılmadı | ⚪ Hiçbir şey yazılmadı: model düzeltmesini 3 / 3 oturumda kendisi doğruladı, yani öğrenilecek bir şey yoktu | yok |

---

<a id="benchmarks"></a>

## 📊 Benchmark'lar: Dört Set, İki Model, Görev Görev

3,390 gerçek `dsh` oturumunda stok DeepSeek Harness ile DeepSeek Harness + DSHRSI karşı karşıya: aynı model, aynı prompt'lar, aynı sandbox, aynı görevler. Plugin varsayılan ayarlarıyla çalışır ve her sete boş bir kütüphaneyle başlar. Sonuna kadar çalışan üç sette çözülen görevler:

<!-- bench:table:start -->
| Benchmark | Görev | `mimo-v2.6-pro` Stok | `mimo-v2.6-pro` + DSHRSI | `mimo-v2.6-flash` Stok | `mimo-v2.6-flash` + DSHRSI |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Aider Polyglot**, ilk denemede | 225 | 224 (99.6%) | 224 (99.6%) | 220 (97.8%) | 223 (99.1%) |
| **Aider Polyglot**, iki deneme içinde | 225 | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) |
| **HumanEval** | 164 | 163 (99.4%) | 162 (98.8%) | 162 (98.8%) | 162 (98.8%) |
| **HumanEval+** | 164 | 156 (95.1%) | 157 (95.7%) | 153 (93.3%) | 153 (93.3%) |
| **MBPP** | 378 | 374 (98.9%) | 371 (98.1%) | 368 (97.4%) | 369 (97.6%) |
| **MBPP+** | 378 | 320 (84.7%) | 319 (84.4%) | 308 (81.5%) | 315 (83.3%) |
<!-- bench:table:end -->

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/bench-flash.dark.png" />
  <img src="../../assets/bench-flash.png" alt="mimo-v2.6-flash, DSH → DSH + DSHRSI: Aider Polyglot 220 → 223 / 225 (+3), HumanEval 162 → 162 / 164, HumanEval+ 153 → 153 / 164, MBPP 368 → 369 / 378 (+1), MBPP+ 308 → 315 / 378 (+7). Rust lib.rs: 12 / 30 → 5 / 30, 7 / 22 → 1 / 22" width="960" />
</picture>
</div>

> **Nasıl okunmalı:** çözülen görev sayısı bakımından iki harness **birbirinden ayırt edilemiyor**. En büyük kazanç +7 (`mimo-v2.6-flash` ile MBPP+), en büyük kayıp −3 (`mimo-v2.6-pro` ile MBPP); aynı görevler üzerinde yapılan kesin McNemar testinde hiçbir fark ayakta kalmıyor (en küçük p = 0.17). Ajan kendi kodunu çalıştırabildiğinde bu setler her iki model için de tavana yakın; üstelik her görev yepyeni, temiz bir dizin: harness'in ders çıkarabileceği, tekrar eden çok az şey var.

**DSHRSI ise şunu gerçekten yaptı: tek bir ipucu bile verilmeden kendini değiştirdi.** Sekiz çalıştırma boyunca modeller **56 adaptasyon** yazdı; bunların 15'i eyleme geçti, onların da 10'u tüm makineye genişletilmişti. Bu 10 adaptasyonun her biri için, ondan sonra başlayan görevleri alıp stok DSH altındaki birebir aynı görevlerle karşılaştırdık:

| Harness'in Kendi Kendine Kaçınmayı Öğrendiği Hata | Stok DSH | DSH + DSHRSI | p |
| :--- | ---: | ---: | ---: |
| İlk başarısız assertion'da ölen bir test çalıştırması (MBPP, `mimo-v2.6-pro`) | 310 görevin 16'sı | **310 görevin 3'ü** | 0.002 |
| Bir dosyayı var olmayan bir yoldan okumak (Polyglot, `mimo-v2.6-flash`) | 151 görevin 7'si | **151 görevin 1'i** | 0.07 |
| Diğer 8 adaptasyon | ölçülebilir bir değişiklik yok | | |

Bu ikisinin hiçbiri daha fazla görevin geçmesini sağlamadı; plugin'in maliyeti ise yaklaşık 8–9% daha fazla ajan süresi ve girdi token'ı oldu. On adaptasyonun tamamı [benchmark notlarında](../../bench/README.md#did-those-adaptations-work) listeleniyor.

**LiveCodeBench v6 yarıda kesildi:** model hesabının bakiyesi yolun ortasında tükendi. O ana kadar iki tarafın da bitirmiş olduğu görevlerde, `mimo-v2.6-pro` ile 105 görevin 94'ünü stok DSH, 96'sını DSHRSI çözdü; `mimo-v2.6-flash` ile 51 görevde durum 42'ye 42. Aynı nedenle ikinci geçiş, yani aynı görevlerin ilk geçişin bıraktığı kütüphaneyle bir kez daha çalıştırılması, henüz yapılmadı.

Protokol, maliyet ve hata tabloları, sınırlar ve bunların hepsini yeniden üretmeye yarayan komutlar [benchmark notlarında](../../bench/README.md) yer alıyor.

---

<a id="coverage"></a>

## 🛡️ Dedektörler ve Yetenekler

Harness'in ne zaman değişmesi gerektiğine **16 dedektör** karar verir. [Tam liste](../../packages/dsh-rsi/README.md#detectors) plugin referansında yer alıyor.

**10 yetenek**, bir adaptasyonun yapabileceği her şeydir. Harness'e yalnızca bunlar üzerinden ulaşır:

| Yetenek | Ne Yapar | Kademe |
| :--- | :--- | :---: |
| `annotate` | Bir araç sonucunun sonuna not ekler | ✅ otomatik |
| `steer` | Bir sonraki model isteğinden önce bir not ekler | ✅ otomatik |
| `deny` | Bir araç çağrısını reddeder ve gerekçesini bildirir | ✅ otomatik |
| `ask` | Bir çağrı için kullanıcının onayını şart koşar | ✅ otomatik |
| `block` | Bir araç sonucunu, düzeltme taşıyan bir hataya çevirir | ✅ otomatik |
| `verify` | Bir koşul sağlanmadıkça turun bitmesine izin vermez | ✅ otomatik |
| `prompt` | Sistem prompt'una kalıcı bir bölüm ekler | ✅ otomatik |
| `rewrite` | Bir araç sonucunun metnini değiştirir | 🔐 onay gerekir |
| `tool` | Model için yeni bir araç kaydeder | 🔐 onay gerekir |
| `exec` | Harness'in shell aracı üzerinden, aynı sandbox ve onay kurallarına tabi olarak bir komut çalıştırır | 🔐 onay gerekir |

Yukarıdaki ilk senaryoda modelin yazdığı adaptasyon şu:

```js
define({
  title: 'Route python invocations to python3',
  description: '...',
  capabilities: ['deny', 'prompt'],
  setup(h) {
    h.promptSection('On this machine there is no `python` executable; use `python3`.')
    h.beforeTool({ tool: 'bash', command: /(^|[;&|(]\s*)python(\s|$)/ },
      () => h.deny('`python` is not installed on this machine. Use `python3` instead.'))
  },
})
```

---

<a id="project-harness"></a>

## 🧩 Üç Katman ve Proje Başına Bir Harness

Her adaptasyon üç katmandan birine aittir. Her katman tek başına kapatılabilir:

| Katman | Ne Tutar | Örnek | Nerede Geçerli |
| :--- | :--- | :--- | :--- |
| **`machine`** | Bu bilgisayara dair gerçekler | `python` yok; bir port dolu; dahili bir host çözümlenmiyor | Öğrenildiği çalışma alanı; ikinci bir çalışma alanı da aynı şeye takılınca tüm makine |
| **`user`** | Size nasıl davranılmasını istediğiniz | "Çok uzun" gerekçesiyle kötü olarak işaretlenen bir yanıt | Tüm makine |
| **`project`** | Tek bir reponun kuralları ve alışkanlıkları | "Bu repo her zaman pnpm kullanır" | Çalışma alanı ve reponun kendisi: kurallar kodla birlikte commit edilir |

**Proje katmanı kodla birlikte taşınır:**

- **Paylaşmak için commit'leyin, fişini çekmek için silin.** Bir dosya, bir adaptasyondur.
- **Hiçbir şey sırf klonlandı diye çalışmaz.** Her makine dosyaların birebir içeriğini `dsh-rsi trust` ile kabul eder; dosyalar değiştiğinde de yeniden kabul eder.
- **Bir proje harness'i yalnızca daha temkinli yapabilir**, asla daha serbest değil. `autonomy` gibi ayarlar bir projenin erişimi dışındadır.
- **Reponun dışına da taşınabilir.** `dsh-rsi export` ve `dsh-rsi import`, makine ve kullanıcı katmanlarını tek bir dosya olarak başka bir bilgisayara taşır.

---

<a id="security"></a>

## 🔒 Güvenlik ve Yapılandırma Varsayılanları

- **Yalnızca Sıkılaştıran Otomatik Kademe** — Onayınız olmadan bir adaptasyon yalnızca bilgi ekleyebilir, reddedebilir, sorabilir ya da doğrulama talep edebilir. `deny` ve `ask` yetenekleri, diğer politikaların verdiği kararı ancak daha katı hâle getirebilir.
- **Güç İçin Onay (`autonomy: tighten`)** — Sonuçları yeniden yazan, araç ekleyen ya da komut çalıştıran adaptasyonlar `proposed` olarak saklanır ve `dsh-rsi approve <id>` komutunu bekler.
- **Gerekene Kadar Görünmez** — Sürtünme yokken ve hiçbir şey mount edilmemişken sistem prompt'u, araç listesi ve mesajlar baytı baytına aynı kalır. Bunu bir uçtan uca test güvence altına alır.
- **Hatalar Yayılmaz** — Hata fırlatan bir handler, bağlı olduğu araç çağrısını asla etkilemez. Üç hatadan sonra adaptasyon karantinaya alınır.
- **Her Şey Kayıt Altında** — Her karar, sürtünme, mount ve eylem günlüğe kaydedilir. `dsh-rsi disable`, `retire` ve `rollback` bir adaptasyonu devreden çıkarır ya da geri alır.
- **Üç Mod** — `adapt` doğrudan mount eder (varsayılan), `propose` üretir ve sizi bekler, `observe` yalnızca kaydeder.

---

<a id="faq"></a>

## ❓ SSS

<details>
<summary><strong>DSHRSI modele fine-tuning yapar mı ya da modeli değiştirir mi?</strong></summary>

Hayır. Modelin ağırlıklarına dokunulmaz ve hiçbir şey eğitilmez. Değişen şey harness'tir: modelin prompt'ları ve araç çağrıları etrafında çalışan kod. Buradaki RSI, harness düzeyinde Özyinelemeli Kendini Geliştirme'dir: harness kendi çalışmalarından yola çıkarak kendini geliştirir ve her döngü, bir öncekinin geride bıraktığı harness'ten başlar.
</details>

<details>
<summary><strong>Bu gerçekten "özyinelemeli" mi, yoksa sadece kural öğrenen bir harness mi?</strong></summary>

Özyineleme somuttur ve kodun içindedir. Yeni bir oturum kütüphanedeki her şeyi mount eder; dolayısıyla dedektörler zaten değişmiş bir harness'i gözlemler. Aynı sorun, bir adaptasyonun mount edilmiş olduğu oturumlarda iki kez yaşanırsa model mevcut kaynak kodu ve kanıtları alır, daha katı bir sürüm yazar; eskisi geri alma için saklanır. İkinci bir çalışma alanında karşılaşılan sorun, adaptasyonu tüm makineye genişletir. Özyinelemeye girmeyen şey hakemdir: dedektörleri, tetikleme politikasını ve doğrulama kapısını hiçbir adaptasyon değiştiremez.
</details>

<details>
<summary><strong>Bunun skill'lerden, bellek dosyalarından ya da daha uzun bir sistem prompt'undan farkı ne?</strong></summary>

Onlar, modelin uyabileceği de uymayabileceği de bir metin ekler. Adaptasyon ise harness'in genişletme noktalarına oturan koddur: bir araç çağrısını daha çalışmadan reddedebilir, onayınızı şart koşabilir ya da hiçbir şey doğrulanmamışken bir turun bitmesini engelleyebilir. Ölçülen çalıştırmalarda model, yapmaması söylendikten sonra bile 3 oturumda `python`'ı denedi ve çağrı daha çalışmadan reddedildi.
</details>

<details>
<summary><strong>Oturumlarımı yavaşlatır mı?</strong></summary>

Bir adaptasyon yazmak, tam bir model yanıtını beklemek demektir: `mimo-v2.6-pro` üzerinde 30–60 saniye sürer ve bu sırada adım olduğu yerde bekler. Mount edilmiş adaptasyonlar süreç içinde, zaman aşımlarıyla çalışır. Herhangi bir hızlanma ölçülmedi, böyle bir iddia da yok.
</details>

<details>
<summary><strong>Modelin yazdığı bir adaptasyon tehlikeli bir şey yapabilir mi?</strong></summary>

Otomatik kademe, harness'in reddedeceği hiçbir şeye izin veremez; güçlü yetenekler ise onayınızı bekler. Kod, bir JSON köprüsünün ardında kendi `node:vm` bağlamında çalışır. Bu, hatalara ve dikkatsiz kötüye kullanıma karşı korur. Kötü niyetli koda karşı bir güvenlik sınırı **değildir**; bu yüzden `dsh-rsi trust` çalıştırmadan önce projenin `.dsh-rsi/` dosyalarını okuyun.
</details>

<details>
<summary><strong>Hangi modellerle çalışır?</strong></summary>

Adaptasyonları oturumun o anki modeli ya da `provider` ve `model` ile belirlediğiniz model yazar. Model kapıdan geçen bir kod üretemezse yerleşik şablonlar devreye girer. Şimdiye kadarki çalıştırmalarda tek bir ailenin iki modeli kullanıldı: `mimo-v2.6-pro` ve `mimo-v2.6-flash`.
</details>

<details>
<summary><strong>DeepSeek Harness masaüstü uygulamasında çalışır mı?</strong></summary>

Plugin sayfalarının okuduğu metadata'yı taşıyan sıradan bir üçüncü taraf plugin olarak gelir ve uygulamanın sarmaladığı `web` profiline kurulur. Gerçek masaüstü uygulamasının içinde henüz doğrulanmadı.
</details>

<details>
<summary><strong>Ya bir geliştirme yanlış çıkarsa?</strong></summary>

Her zaman geri alınabilir: harness'in kendi koduna hiçbir zaman dokunulmaz ve bir adaptasyonun hiçbir sürümü asla silinmez. Bir adaptasyon başarısız olmayı sürdürdüğünde ya da reddettiği bir çağrının çalıştığı ortaya çıktığında harness kendiliğinden geri adım atar. Bunu siz de yapabilirsiniz: `/rsi undo` son değişikliği geri alır, `dsh-rsi restore` harness'in tamamını daha önceki bir noktaya geri döndürür, `/rsi off` ise stok harness'i çalıştırır. Bunların hepsi zaten çalışmakta olan oturumda geçerli olur. [Geri alma nasıl çalışır](../../packages/dsh-rsi/README.md#going-back).
</details>

<details>
<summary><strong>Öğrendiklerini nasıl görür, geri alır ya da kapatırım?</strong></summary>

Bir oturumda `/rsi`, ya da terminalde `dsh-rsi status`. `dsh-rsi show <id>` bir adaptasyonun kaynak kodunu ve doğrulama raporunu yazdırır; `disable`, `retire` ve `rollback` onu devreden çıkarır ya da geri alır. Hiçbir şeyi değiştirmeden yalnızca kayıt tutmak için `mode: observe` ayarını yapın.
</details>

---

<a id="docs"></a>

## 📚 Dokümantasyon ve Bağlantılar

- [📖 Plugin Referansı](../../packages/dsh-rsi/README.md) — tüm dedektörler, yetenekler, komutlar ve ayarlar
- [🚀 Kurulum Kaynakları ve Profiller](../../packages/dsh-rsi/README.md#install)
- [🧩 Katmanlar ve Proje Harness'i](../../packages/dsh-rsi/README.md#layers-and-the-project-harness)
- [🔬 Doğrulama Kapısı](../../packages/dsh-rsi/README.md#the-validation-gate)
- [🛠️ `dsh-rsi` Komut Satırı](../../packages/dsh-rsi/README.md#command-line) · [⚙️ Yapılandırma](../../packages/dsh-rsi/README.md#configuration)
- [⚠️ Bilinen Sınırlar](../../packages/dsh-rsi/README.md#known-limits)
- [📊 Benchmark Protokolü ve Sonuçları](../../bench/README.md)
- [🧱 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — bu plugin'in takıldığı harness

<a id="contributing"></a>

## 🤝 Katkı ve Topluluk

Issue ve PR'larınızı [qybaihe/dshrsi](https://github.com/qybaihe/dshrsi) üzerinde memnuniyetle karşılıyoruz. PR göndermeden önce:

```bash
npm install && npm test    # 130 birim testi, ardından 29 uçtan uca test; anahtar gerekmez
```

Uçtan uca testler model endpoint'ini simüle edilmiş bir endpoint ile değiştirir. Geri kalan her şey gerçektir: `dsh` süreci, araç yürütme, oturum günlüğü ve plugin kurulumu.

## 📄 Lisans

[MIT](../../LICENSE)

---

Created in [T3 Code](https://t3.codes).
