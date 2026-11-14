<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · **Italiano** · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

<br />

<img src="../../packages/dsh-rsi/icon.svg" alt="DSHRSI" width="88" />

# DSHRSI: Recursive Self-Improvement (auto-miglioramento ricorsivo) per DeepSeek Harness

### **Osserva → Migliora → Costruiscici sopra → Da capo. Un harness che diventa sempre più tuo.**

<a href="https://dshr.si/trace.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/rsi-trace.dark.gif" />
    <img src="../../assets/rsi-trace.gif" alt="Animazione della traccia di un'esecuzione reale: con l'harness originale, 12 sessioni su 30 fanno la stessa chiamata fallita; con DSHRSI, alla terza volta l'harness migliora sé stesso e nelle 22 sessioni successive succede una volta sola" width="960" />
  </picture>
</a>

**RSI sta per Recursive Self-Improvement, auto-miglioramento ricorsivo, e DSHRSI è il plugin open source che lo rende reale per DeepSeek Harness. L'harness osserva le proprie esecuzioni, fa scrivere al modello stesso della sessione codice dell'harness per i problemi che trova, mette alla prova quel codice in un gate in 5 fasi e lo monta prima che il turno finisca. Poi è l'harness migliorato a eseguire la sessione successiva, e a migliorarsi di nuovo. Niente fine-tuning. Niente montagne di prompt. Codice che viene misurato, tenuto, riscritto o buttato via.**

[![RSI](https://img.shields.io/badge/RSI-Recursive_Self--Improvement-4d6bfe?style=for-the-badge)](#rsi)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-0.2.2--rc.3_plugin-7c5cff?style=for-the-badge)](https://github.com/deepseek-ai/deepseek-harness)
[![Validation](https://img.shields.io/badge/Validation-5--Stage_Gate-0ea5e9?style=for-the-badge)](#how-it-works)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-4_Suites_%C2%B7_2_Models-2563eb?style=for-the-badge)](#benchmarks)
[![MIT License](https://img.shields.io/badge/License-MIT-38bdf8?style=for-the-badge)](../../LICENSE)

**[🌐 Sito web](https://dshr.si/) · [📖 Riferimento del plugin](../../packages/dsh-rsi/README.md) · [🐛 Issue](https://github.com/qybaihe/dshrsi/issues)**

[Cosa significa RSI](#rsi) · [Avvio rapido](#quick-start) · [Come funziona](#how-it-works) · [Risultati misurati](#measured) · [Benchmark](#benchmarks) · [Rilevatori e capacità](#coverage) · [Harness di progetto](#project-harness) · [Default di sicurezza](#security) · [FAQ](#faq)

</div>

---

> [!IMPORTANT]
> **Anteprima per sviluppatori:** DSHRSI è sviluppato su DeepSeek Harness `0.2.2-rc.3`, che è a sua volta un'anteprima per sviluppatori. **Ci saranno modifiche che rompono la compatibilità.**
> Un adattamento è codice scritto da un modello ed eseguito dentro il tuo harness. Il suo isolamento protegge dagli errori, **non dal codice malevolo**. Prima di eseguirlo, leggi la sezione sul [gate di validazione](../../packages/dsh-rsi/README.md#the-validation-gate).

<div align="center">
<img src="../../assets/ui-evolving.png" alt="Una sessione di DeepSeek Harness: due chiamate ai tool falliscono con exit code 127, poi il badge RSI e la pillola sotto il campo di input si accendono mentre l'harness migliora se stesso" width="1200" />
</div>

<br />

<table>
<tr>
<td width="33%" valign="top">

### 🔴 Senza DSHRSI
Ogni sessione riscopre gli stessi fatti: su questa macchina non c'è `python`, questo repository ha una regola che avevi già dichiarato, questa correzione non è mai stata verificata. Nell'esecuzione di controllo, **5 sessioni su 5** hanno fatto la stessa chiamata fallita, e una regola dichiarata dall'utente è stata infranta di nuovo una sessione più tardi.

</td>
<td width="33%" valign="top">

### 🧬 Con DSHRSI
Quando il problema si ripresenta, il modello scrive un pezzo di codice dell'harness, quel codice supera il gate ed è attivo **in quello stesso turno**. In 3 esecuzioni con un modello reale, **7 sessioni su 7** dopo l'adattamento non hanno avuto nessuna chiamata fallita. E il miglioramento successivo parte da lì.

</td>
<td width="33%" valign="top">

### 🔒 Solo restrizioni, by design
Un adattamento può aggiungere informazioni, rifiutare una chiamata, chiedere prima a te o pretendere una verifica. **Nessuna capacità può consentire ciò che l'harness rifiuterebbe.** Riscrivere i risultati, aggiungere tool ed eseguire comandi restano in attesa della tua approvazione.

</td>
</tr>
</table>

---

<a id="rsi"></a>

## 🔁 RSI = Recursive Self-Improvement, auto-miglioramento ricorsivo

Non "riscrivere se stesso". **Auto-miglioramento ricorsivo**: un sistema usa le proprie abilità per migliorare se stesso, ed è il sistema migliorato a compiere il giro successivo. Tre parole, e DSHRSI deve meritarsele una per una:

| | Cosa richiede | Come lo fa DSHRSI |
| :--- | :--- | :--- |
| **Auto (Self)** | Chi agisce e chi viene modificato sono lo stesso sistema | L'harness modifica l'harness. L'adattamento lo scrive il modello della stessa sessione che ha incontrato il problema. Nessuno lo mette a punto dall'esterno |
| **Miglioramento (Improvement)** | "Migliore" deve essere verificabile | Ogni adattamento supera un gate in 5 fasi prima di essere montato, e viene poi giudicato sulle sessioni successive: ciò che funziona viene promosso, ciò che lancia eccezioni va in quarantena |
| **Ricorsivo (Recursive)** | Il risultato di un giro dà il via al successivo | La sessione successiva gira sull'harness migliorato e viene osservata con quello in funzione. Un adattamento che non ha retto viene riscritto in forma più restrittiva sulla base delle prove. Uno che serve in un secondo workspace si estende all'intera macchina, e le regole di un progetto arrivano nell'harness di ogni collega |

**Quattro cicli, ognuno dentro il successivo:** dentro un turno → da una sessione all'altra → il miglioramento stesso viene migliorato → da un progetto a una macchina a un team.

Ciò che volutamente **non** è ricorsivo: i pesi del modello non cambiano mai, e i rilevatori, la policy di attivazione e il gate di validazione sono codice fisso che nessun adattamento può toccare. La parte che modifica se stessa è controllata da una parte che non può modificare.

---

<a id="quick-start"></a>

## ⚡ Avvio rapido in 30 secondi

### 1. Installalo dove lavori già
Nell'app desktop di DeepSeek Harness o nella Web UI, apri **Plugins → Add plugin → Install a third-party plugin**, incolla l'URL del pacchetto di release, seleziona **Install** e poi **Enable now**:

```text
https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
```

Oppure dalla riga di comando. Ogni profilo ha i suoi plugin, e `dsh plugin add` chiama `pnpm`, che deve trovarsi nel `PATH`:

```bash
dsh plugin --profile web add https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
dsh web
```

### 2. Lavora e basta
Non c'è niente da configurare. DSHRSI non si fa vedere finché lo stesso problema non si ripresenta. A quel punto il badge **RSI** si accende, la pillola sotto il campo di input ti dice che l'harness ha appena modificato se stesso, e la sessione successiva parte già migliorata:

<div align="center">
<img src="../../assets/ui-panel-dark.png" alt="La sessione successiva: la pillola è aperta ed elenca l'adattamento al lavoro e la chiamata che ha rifiutato prima che venisse eseguita" width="1200" />
</div>

Scrivi `/rsi` in qualsiasi sessione per vedere cosa è montato, a quale layer appartiene e cosa aspetta la tua approvazione.

I profili `desktop` e `headless`, gli indici di plugin, i tarball locali e il caricamento per una singola esecuzione sono trattati nel [riferimento del plugin](../../packages/dsh-rsi/README.md#install).

---

<a id="how-it-works"></a>

## 🧠 Come funziona DSHRSI: un ciclo chiuso dentro l'harness, ripetuto ancora e ancora

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/pit-stop.dark.svg" />
  <img src="../../assets/pit-stop.svg" alt="Come funziona DSHRSI, disegnato come un pit stop: l'auto è l'harness, il pilota è il modello e il pezzo nuovo è codice dell'harness scritto a metà del turno" width="960" />
</picture>
</div>

Skill, file di memoria e prompt di sistema più lunghi lavorano tutti a livello di contesto: aggiungono testo e sperano che il modello lo segua. Quando non lo fa, la stessa chiamata fallita viene ripetuta nella sessione successiva.

**DSHRSI lavora a livello di harness. Ciò che impara diventa codice sui punti di estensione dell'harness stesso:**

| Fase | Meccanismo | Effetto |
| :--- | :--- | :--- |
| **1. Osserva** | 16 rilevatori leggono eventi di sessione normalizzati: chiamate che falliscono di nuovo, cause di fallimento che continuano a ripresentarsi, tentativi alla cieca, correzioni dell'utente, turni che finiscono senza aver verificato nulla. | Il problema riceve una firma che resta la stessa da una sessione all'altra. |
| **2. Riscrivi** | Il modello stesso della sessione scrive un adattamento in JavaScript usando un'API di 10 capacità. Il codice respinto torna indietro con le motivazioni, al massimo due volte, poi subentra un template integrato. | La correzione è codice dell'harness, non un altro paragrafo di prompt. |
| **3. Valida** | Analisi statica → caricamento → replay → regressione → permessi. L'adattamento deve agire sulle chiamate che l'hanno fatto scattare e deve lasciare in pace ogni chiamata riuscita in questa sessione. | Il codice che non fa nulla, o che rompe ciò che già funzionava, non viene mai montato. |
| **4. Monta** | L'adattamento gira in un proprio contesto isolato, con un timeout su ogni chiamata, e ha effetto prima della successiva richiesta al modello. | Il primo a beneficiarne è il turno che ha incontrato il problema. |
| **5. Conserva e condividi** | Ogni macchina conserva una libreria di adattamenti. Ciò che funziona viene promosso, ciò che lancia eccezioni va in quarantena, ciò che non ha retto viene riscritto in forma più restrittiva, e le regole di progetto vengono scritte nel repository. | La sessione successiva parte già adattata, e i colleghi ricevono le regole del progetto non appena le accettano. |
| **↻ Da capo** | La sessione successiva gira sull'harness lasciato dalla fase 5, e la fase 1 la osserva con tutti gli adattamenti al loro posto. | Il miglioramento si costruisce sul miglioramento. Questa è la ricorsione. |

---

<a id="measured"></a>

## 🔬 Misurato su un modello reale

Questi numeri vengono dall'esecuzione di un modello reale, `mimo-v2.6-pro`, in sessioni `dsh` reali (`npm run test:live`). In questa tabella non c'è niente di simulato.

> **Come leggerla:** il campione è piccolo. Un modello, tre scenari, una manciata di sessioni ciascuno. Dimostra che il ciclo funziona da un capo all'altro. **Non** è un'affermazione statistica sui tassi di successo, e niente è diventato più veloce: scrivere un adattamento significa aspettare il modello per 30–60 secondi. Le esecuzioni più ampie sono in [Benchmark](#benchmarks).

| Scenario | Senza DSHRSI | Con DSHRSI | Cosa ha scritto l'harness |
| :--- | :--- | :--- | :--- |
| **Comando mancante**: le istruzioni dicono `python`, la macchina ha solo `python3` | ❌ **5 / 5** sessioni hanno fatto la chiamata fallita | ✅ **0 / 7** sessioni dopo l'adattamento (9 / 9 prima) | `deny` + `prompt`, scritto dal modello, ha superato il gate al primo tentativo |
| **Una regola che l'utente ha dichiarato una sola volta**: non modificare mai un certo file, scrivere invece in una sua bozza | ❌ La sessione successiva ha modificato il file | ✅ La sessione successiva ha scritto nella bozza senza che nessuno glielo ricordasse | `deny` + `prompt`, scritto dal modello subito dopo la correzione |
| **Una correzione che nessuno ha chiesto di verificare** | non eseguito | ⚪ Niente di scritto: il modello ha verificato la sua correzione in 3 / 3 sessioni, quindi non c'era nulla da imparare | niente |

---

<a id="benchmarks"></a>

## 📊 Benchmark: quattro suite, due modelli, task per task

DeepSeek Harness di serie contro DeepSeek Harness + DSHRSI, in 3,390 sessioni `dsh` reali: lo stesso modello, gli stessi prompt, la stessa sandbox, gli stessi task. Il plugin gira con le impostazioni predefinite e inizia ogni suite con una libreria vuota. Task risolti nelle tre suite arrivate fino in fondo:

<!-- bench:table:start -->
| Benchmark | Task | `mimo-v2.6-pro` di serie | `mimo-v2.6-pro` + DSHRSI | `mimo-v2.6-flash` di serie | `mimo-v2.6-flash` + DSHRSI |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Aider Polyglot**, al primo tentativo | 225 | 224 (99.6%) | 224 (99.6%) | 220 (97.8%) | 223 (99.1%) |
| **Aider Polyglot**, entro due tentativi | 225 | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) |
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

> **Come leggerla:** sui task risolti, i due harness **sono indistinguibili**. Il guadagno più grande è +7 (MBPP+ con `mimo-v2.6-flash`), la perdita più grande è −3 (MBPP con `mimo-v2.6-pro`), e nessuna differenza regge a un test esatto di McNemar sugli stessi task (p minimo = 0.17). Quando l'agente può eseguire il proprio codice, queste suite sono vicine al tetto per entrambi i modelli, e ogni task è una directory nuova e pulita: c'è ben poco che si ripresenti e da cui un harness possa imparare.

**Quello che DSHRSI ha fatto davvero, senza un solo suggerimento, è modificare se stesso.** Nelle otto esecuzioni i modelli hanno scritto **56 adattamenti**; 15 di questi sono entrati in azione, e 10 di essi erano stati estesi all'intera macchina. Per ciascuno dei 10 abbiamo preso i task iniziati dopo la sua comparsa e li abbiamo confrontati con gli stessi identici task sotto DSH di serie:

| Fallimento che l'harness ha imparato da solo a evitare | DSH di serie | DSH + DSHRSI | p |
| :--- | ---: | ---: | ---: |
| Un'esecuzione dei test che muore alla prima asserzione fallita (MBPP, `mimo-v2.6-pro`) | 16 task su 310 | **3 su 310** | 0.002 |
| Leggere un file in un percorso che non esiste (Polyglot, `mimo-v2.6-flash`) | 7 task su 151 | **1 su 151** | 0.07 |
| Gli altri 8 adattamenti | nessuna variazione misurabile | | |

Nessuno dei due ha fatto passare più task, e il plugin è costato circa l'8–9% in più di tempo dell'agente e di token di input. Tutti e dieci sono elencati nelle [note sui benchmark](../../bench/README.md#did-those-adaptations-work).

**LiveCodeBench v6 è stato interrotto prima della fine:** l'account del modello ha esaurito il credito a metà percorso. Sui task che entrambe le configurazioni avevano completato fino a quel momento, DSH di serie ne ha risolti 94 e DSHRSI 96 su 105 con `mimo-v2.6-pro`, e 42 contro 42 su 51 con `mimo-v2.6-flash`. Per lo stesso motivo il secondo passaggio, cioè gli stessi task rieseguiti sulla libreria lasciata dal primo, non è ancora stato eseguito.

Il protocollo, le tabelle dei costi e dei fallimenti, i limiti e i comandi per riprodurre il tutto sono nelle [note sui benchmark](../../bench/README.md).

---

<a id="coverage"></a>

## 🛡️ Rilevatori e capacità

**16 rilevatori** decidono quando l'harness deve cambiare. L'[elenco completo](../../packages/dsh-rsi/README.md#detectors) è nel riferimento del plugin.

**10 capacità** sono tutto ciò che un adattamento può fare. Raggiunge l'harness solo attraverso di esse:

| Capacità | Cosa fa | Livello |
| :--- | :--- | :---: |
| `annotate` | Aggiunge una nota in coda al risultato di un tool | ✅ automatico |
| `steer` | Aggiunge una nota prima della successiva richiesta al modello | ✅ automatico |
| `deny` | Rifiuta una chiamata a un tool e ne dà il motivo | ✅ automatico |
| `ask` | Richiede l'approvazione dell'utente per una chiamata | ✅ automatico |
| `block` | Trasforma il risultato di un tool in un errore che porta con sé una correzione | ✅ automatico |
| `verify` | Impedisce al turno di finire finché una condizione non è soddisfatta | ✅ automatico |
| `prompt` | Aggiunge una sezione permanente al prompt di sistema | ✅ automatico |
| `rewrite` | Sostituisce il testo del risultato di un tool | 🔐 richiede approvazione |
| `tool` | Registra un nuovo tool per il modello | 🔐 richiede approvazione |
| `exec` | Esegue un comando tramite il tool shell dell'harness, con le stesse regole di sandbox e di approvazione | 🔐 richiede approvazione |

Questo è l'adattamento che il modello ha scritto nel primo scenario qui sopra:

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

## 🧩 Tre layer, e un harness per progetto

Ogni adattamento appartiene a uno di tre layer. Ogni layer si può disattivare per conto suo:

| Layer | Cosa contiene | Esempio | Dove si applica |
| :--- | :--- | :--- | :--- |
| **`machine`** | Fatti su questo computer | Manca `python`; una porta è occupata; un host interno non si risolve | Il workspace in cui è stato imparato, poi l'intera macchina non appena lo incontra un secondo workspace |
| **`user`** | Come vuoi essere trattato | Una risposta segnata come negativa con il motivo "troppo lunga" | L'intera macchina |
| **`project`** | Le regole e le abitudini di un repository | "Questo repository usa pnpm, sempre" | Il workspace, e il repository stesso: le regole vengono committate insieme al codice |

**Il layer di progetto viaggia insieme al codice:**

- **Fai commit per condividere, cancella per staccare.** Un file è un adattamento.
- **Niente viene eseguito solo perché è stato clonato.** Ogni macchina accetta il contenuto esatto dei file con `dsh-rsi trust`, e li accetta di nuovo quando cambiano.
- **Un progetto può solo rendere l'harness più prudente**, mai meno. Impostazioni come `autonomy` sono fuori dalla portata di un progetto.
- **Portabile anche oltre il repository.** `dsh-rsi export` e `dsh-rsi import` portano i layer macchina e utente su un altro computer in un unico file.

---

<a id="security"></a>

## 🔒 Sicurezza e configurazione predefinita

- **Livello automatico: solo restrizioni** — Senza la tua approvazione, un adattamento può solo aggiungere informazioni, rifiutare, chiedere o pretendere una verifica. I suoi `deny` e `ask` possono solo rendere più restrittivo il verdetto delle altre policy.
- **Approvazione per le capacità potenti (`autonomy: tighten`)** — Gli adattamenti che riscrivono risultati, aggiungono tool o eseguono comandi vengono salvati come `proposed` e aspettano `dsh-rsi approve <id>`.
- **Invisibile finché non serve** — Senza attrito e senza nulla di montato, il prompt di sistema, l'elenco dei tool e i messaggi restano invariati byte per byte. Un test end-to-end fa da guardia.
- **Errori contenuti** — Un handler che lancia un'eccezione non influisce mai sulla chiamata al tool a cui è agganciato. Dopo tre errori l'adattamento va in quarantena.
- **Tutto tracciato** — Ogni decisione, attrito, montaggio e azione finisce nel log. `dsh-rsi disable`, `retire` e `rollback` tolgono un adattamento o lo riportano indietro.
- **Tre modalità** — `adapt` monta direttamente (è il default), `propose` genera e aspetta te, `observe` si limita a registrare.

---

<a id="faq"></a>

## ❓ FAQ

<details>
<summary><strong>DSHRSI fa fine-tuning del modello o lo modifica?</strong></summary>

No. I pesi del modello restano intatti e non viene addestrato nulla. Ciò che cambia è l'harness: il codice che gira intorno ai prompt e alle chiamate ai tool del modello. Qui RSI è auto-miglioramento ricorsivo a livello di harness: l'harness si migliora a partire dalle proprie esecuzioni, e ogni giro parte dall'harness lasciato dal giro precedente.
</details>

<details>
<summary><strong>È davvero "ricorsivo", o è solo un harness che impara regole?</strong></summary>

La ricorsione è concreta ed è nel codice. Una nuova sessione monta tutto ciò che la libreria contiene, quindi i rilevatori osservano un harness che è già cambiato. Quando lo stesso problema si presenta due volte in sessioni che avevano un adattamento montato, il modello riceve il sorgente attuale e le prove, e scrive una versione più restrittiva; quella vecchia viene conservata per il rollback. Un problema incontrato in un secondo workspace estende un adattamento all'intera macchina. Ciò che non è ricorsivo è il giudice: rilevatori, policy di attivazione e gate di validazione non possono essere modificati da nessun adattamento.
</details>

<details>
<summary><strong>In cosa è diverso da skill, file di memoria o un prompt di sistema più lungo?</strong></summary>

Quelli aggiungono testo che il modello può seguire oppure no. Un adattamento è codice sui punti di estensione dell'harness: può rifiutare una chiamata a un tool prima che venga eseguita, richiedere la tua approvazione, o impedire a un turno di finire quando nulla è stato verificato. Nelle esecuzioni misurate, il modello ha comunque provato `python` in 3 sessioni dopo che gli era stato detto di non farlo, e la chiamata è stata rifiutata prima di essere eseguita.
</details>

<details>
<summary><strong>Rallenta le mie sessioni?</strong></summary>

Scrivere un adattamento significa aspettare un'intera risposta del modello: 30–60 secondi con `mimo-v2.6-pro`, durante i quali quel passo resta fermo. Gli adattamenti montati girano nello stesso processo, con timeout. Nessuna accelerazione è stata misurata, e nessuna viene dichiarata.
</details>

<details>
<summary><strong>Un adattamento scritto dal modello può fare qualcosa di pericoloso?</strong></summary>

Il livello automatico non può consentire nulla che l'harness rifiuterebbe, e le capacità potenti aspettano la tua approvazione. Il codice gira in un proprio contesto `node:vm` dietro un bridge JSON. Questo protegge dagli errori e dagli usi impropri fatti con leggerezza. **Non** è un confine di sicurezza contro il codice malevolo, quindi leggi i file `.dsh-rsi/` di un progetto prima di eseguire `dsh-rsi trust`.
</details>

<details>
<summary><strong>Con quali modelli funziona?</strong></summary>

Gli adattamenti li scrive il modello corrente della sessione, oppure quello che imposti con `provider` e `model`. Se il modello non riesce a produrre codice che superi il gate, subentrano i template integrati. Finora le esecuzioni hanno usato due modelli di una stessa famiglia, `mimo-v2.6-pro` e `mimo-v2.6-flash`.
</details>

<details>
<summary><strong>Funziona nell'app desktop di DeepSeek Harness?</strong></summary>

Viene distribuito come un normale plugin di terze parti, con i metadati che le pagine dei plugin leggono, e si installa nel profilo `web` che l'app incapsula. Dentro la vera app desktop non è ancora stato verificato.
</details>

<details>
<summary><strong>E se un miglioramento si rivela sbagliato?</strong></summary>

Si può sempre tornare indietro: il codice dell'harness stesso non viene mai toccato, e nessuna versione di un adattamento viene mai cancellata. L'harness fa marcia indietro da solo quando un adattamento continua a fallire, o quando si scopre che una chiamata che aveva rifiutato in realtà funziona. Puoi farlo anche tu: `/rsi undo` annulla l'ultima modifica, `dsh-rsi restore` riporta l'intero harness a un punto precedente, e `/rsi off` fa girare l'harness di serie. Tutto questo ha effetto nella sessione già in corso. [Come si torna indietro](../../packages/dsh-rsi/README.md#going-back).
</details>

<details>
<summary><strong>Come faccio a vedere, annullare o disattivare ciò che ha imparato?</strong></summary>

`/rsi` in una sessione, oppure `dsh-rsi status` in un terminale. `dsh-rsi show <id>` stampa il sorgente di un adattamento e il suo report di validazione; `disable`, `retire` e `rollback` lo tolgono o lo riportano indietro. Imposta `mode: observe` per registrare senza cambiare nulla.
</details>

---

<a id="docs"></a>

## 📚 Documentazione e link

- [📖 Riferimento del plugin](../../packages/dsh-rsi/README.md) — tutti i rilevatori, le capacità, i comandi e le impostazioni
- [🚀 Fonti di installazione e profili](../../packages/dsh-rsi/README.md#install)
- [🧩 I layer e l'harness di progetto](../../packages/dsh-rsi/README.md#layers-and-the-project-harness)
- [🔬 Il gate di validazione](../../packages/dsh-rsi/README.md#the-validation-gate)
- [🛠️ Riga di comando `dsh-rsi`](../../packages/dsh-rsi/README.md#command-line) · [⚙️ Configurazione](../../packages/dsh-rsi/README.md#configuration)
- [⚠️ Limiti noti](../../packages/dsh-rsi/README.md#known-limits)
- [📊 Protocollo e risultati dei benchmark](../../bench/README.md)
- [🧱 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — l'harness a cui questo plugin si aggancia

<a id="contributing"></a>

## 🤝 Contribuire e community

Issue e PR sono benvenute su [qybaihe/dshrsi](https://github.com/qybaihe/dshrsi). Prima di inviare una PR:

```bash
npm install && npm test    # 130 test unitari, poi 29 test end-to-end; non serve nessuna chiave
```

I test end-to-end sostituiscono l'endpoint del modello con uno simulato. Tutto il resto è reale: il processo `dsh`, l'esecuzione dei tool, il log di sessione e l'installazione del plugin.

## 📄 Licenza

[MIT](../../LICENSE)

---

Created in [T3 Code](https://t3.codes).
