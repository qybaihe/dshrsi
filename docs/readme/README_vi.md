<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · [Türkçe](README_tr.md) · [Русский](README_ru.md) · **Tiếng Việt** · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

<br />

<img src="../../packages/dsh-rsi/icon.svg" alt="DSHRSI" width="88" />

# DSHRSI: Recursive Self-Improvement (Tự cải tiến đệ quy) cho DeepSeek Harness

### **Quan sát → Cải tiến → Xây tiếp trên đó → Lặp lại. Một harness càng dùng càng là của riêng bạn.**

<a href="https://qybaihe.github.io/dshrsi/trace.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/rsi-trace.dark.gif" />
    <img src="../../assets/rsi-trace.gif" alt="Ảnh động ghi lại một lần chạy thật: với harness gốc, 12 trên 30 phiên thực hiện cùng một lệnh gọi thất bại; với DSHRSI, đến lần thứ ba harness tự cải tiến chính nó, và 22 phiên sau đó chỉ gặp lại một lần" width="960" />
  </picture>
</a>

**RSI là Recursive Self-Improvement, tức Tự cải tiến đệ quy, và DSHRSI là plugin mã nguồn mở biến điều đó thành hiện thực trên DeepSeek Harness. Harness tự quan sát các lần chạy của chính nó, để chính mô hình của phiên viết code harness cho những trục trặc mà nó phát hiện, kiểm chứng đoạn code đó qua một cổng kiểm định 5 giai đoạn, rồi gắn nó vào trước khi lượt kết thúc. Sau đó, harness đã được cải tiến chạy phiên tiếp theo, và lại cải tiến thêm lần nữa. Không fine-tune. Không chồng chất prompt. Chỉ có code: được đo lường, rồi được giữ lại, viết lại hoặc vứt bỏ.**

[![RSI](https://img.shields.io/badge/RSI-Recursive_Self--Improvement-4d6bfe?style=for-the-badge)](#rsi)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-0.2.2--rc.3_plugin-7c5cff?style=for-the-badge)](https://github.com/deepseek-ai/deepseek-harness)
[![Validation](https://img.shields.io/badge/Validation-5--Stage_Gate-0ea5e9?style=for-the-badge)](#how-it-works)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-4_Suites_%C2%B7_2_Models-2563eb?style=for-the-badge)](#benchmarks)
[![MIT License](https://img.shields.io/badge/License-MIT-38bdf8?style=for-the-badge)](../../LICENSE)

**[🌐 Trang web](https://qybaihe.github.io/dshrsi/) · [📖 Tài liệu tham khảo plugin](../../packages/dsh-rsi/README.md) · [🐛 Issues](https://github.com/qybaihe/dshrsi/issues)**

[RSI nghĩa là gì](#rsi) · [Bắt đầu nhanh](#quick-start) · [Cách hoạt động](#how-it-works) · [Kết quả đo thực tế](#measured) · [Benchmark](#benchmarks) · [Bộ phát hiện & năng lực](#coverage) · [Harness dự án](#project-harness) · [Mặc định an toàn](#security) · [Câu hỏi thường gặp](#faq)

</div>

---

> [!IMPORTANT]
> **Developer Preview:** DSHRSI được xây dựng trên DeepSeek Harness `0.2.2-rc.3`, mà bản thân nó cũng mới là một bản developer preview. **Sẽ có những thay đổi phá vỡ tính tương thích.**
> Một bản thích ứng là code do mô hình viết ra và chạy ngay bên trong harness của bạn. Lớp cô lập của nó chống được sai sót, **chứ không chống được code độc hại**. Hãy đọc về [cổng kiểm định](../../packages/dsh-rsi/README.md#the-validation-gate) trước khi chạy.

<div align="center">
<img src="../../assets/ui-evolving.png" alt="Một phiên DeepSeek Harness: hai lệnh gọi công cụ thất bại với exit code 127, sau đó badge RSI và pill bên dưới khung soạn tin sáng lên khi harness tự cải tiến" width="1200" />
</div>

<br />

<table>
<tr>
<td width="33%" valign="top">

### 🔴 Không có DSHRSI
Phiên nào cũng phải khám phá lại đúng những sự thật ấy: máy này không có `python`, repository này có một quy tắc bạn đã nói rồi, bản sửa này chưa hề được kiểm chứng. Trong lần chạy đối chứng, **5 trên 5 phiên** đều thực hiện cùng một lệnh gọi thất bại, và một quy tắc người dùng đã nêu lại bị phá vỡ chỉ một phiên sau đó.

</td>
<td width="33%" valign="top">

### 🧬 Có DSHRSI
Khi trục trặc quay lại, mô hình viết một đoạn code harness, đoạn code vượt qua cổng kiểm định và có hiệu lực **ngay trong chính lượt đó**. Trong 3 lần chạy với một mô hình thật, **7 trên 7 phiên** sau khi có bản thích ứng không còn lệnh gọi thất bại nào. Và lần cải tiến tiếp theo bắt đầu từ đó.

</td>
<td width="33%" valign="top">

### 🔒 Chỉ siết chặt, theo thiết kế
Một bản thích ứng có thể bổ sung thông tin, từ chối một lệnh gọi, hỏi bạn trước, hoặc đòi phải kiểm chứng. **Không năng lực nào có thể cho phép điều mà harness vốn sẽ từ chối.** Viết lại kết quả, thêm công cụ và chạy lệnh đều phải chờ bạn phê duyệt.

</td>
</tr>
</table>

---

<a id="rsi"></a>

## 🔁 RSI = Recursive Self-Improvement, Tự cải tiến đệ quy

Không phải "rewrite itself" (tự viết lại chính nó). **Tự cải tiến đệ quy**: một hệ thống dùng chính khả năng của mình để cải tiến bản thân, và hệ thống đã được cải tiến sẽ thực hiện vòng tiếp theo. Ba từ, và DSHRSI phải xứng đáng với từng từ một:

| | Điều kiện cần có | DSHRSI làm điều đó thế nào |
| :--- | :--- | :--- |
| **Tự (Self)** | Thứ hành động và thứ bị thay đổi là cùng một hệ thống | Harness thay đổi harness. Bản thích ứng được viết bởi mô hình của chính phiên đã gặp trục trặc. Không ai tinh chỉnh nó từ bên ngoài |
| **Cải tiến (Improvement)** | "Tốt hơn" phải kiểm chứng được | Mọi bản thích ứng đều phải qua cổng kiểm định 5 giai đoạn trước khi được gắn, và các phiên về sau còn tiếp tục thử thách nó: cái gì hiệu quả thì được thăng hạng, cái gì ném lỗi thì bị cách ly |
| **Đệ quy (Recursive)** | Đầu ra của vòng này là điểm khởi đầu của vòng sau | Phiên tiếp theo chạy trên harness đã được cải tiến và được quan sát cùng với nó. Bản thích ứng nào không trụ được thì được viết lại chặt hơn dựa trên bằng chứng. Bản nào được cần đến ở một workspace thứ hai thì mở rộng ra toàn máy, còn quy tắc của một dự án thì đi theo đến harness của từng đồng đội |

**Bốn vòng lặp, vòng nọ lồng trong vòng kia:** trong một lượt → từ phiên này sang phiên khác → chính sự cải tiến cũng được cải tiến → từ một dự án đến một máy rồi đến cả nhóm.

Phần được cố ý để **không** đệ quy: trọng số của mô hình không bao giờ thay đổi; còn các bộ phát hiện, chính sách kích hoạt và cổng kiểm định là code cố định mà không bản thích ứng nào chạm tới được. Phần tự sửa đổi chính mình được kiểm tra bởi một phần mà nó không thể sửa đổi.

---

<a id="quick-start"></a>

## ⚡ Bắt đầu nhanh trong 30 giây

### 1. Cài ngay tại nơi bạn vẫn làm việc
Trong ứng dụng desktop hoặc giao diện Web của DeepSeek Harness, mở **Plugins → Add plugin → Install a third-party plugin**, dán đường dẫn gói phát hành vào, chọn **Install**, rồi **Enable now**:

```text
https://github.com/qybaihe/dshrsi/releases/download/v0.1.2/dsh-rsi-0.1.2.tgz
```

Hoặc cài từ dòng lệnh. Mỗi profile giữ bộ plugin riêng của nó, và `dsh plugin add` gọi `pnpm`, công cụ này phải có trên `PATH`:

```bash
dsh plugin --profile web add https://github.com/qybaihe/dshrsi/releases/download/v0.1.2/dsh-rsi-0.1.2.tgz
dsh web
```

### 2. Cứ làm việc như thường
Không cần cấu hình gì cả. DSHRSI ẩn mình cho đến khi cùng một trục trặc quay lại. Khi đó badge **RSI** sáng lên, pill bên dưới khung soạn tin báo cho bạn biết harness vừa tự thay đổi, và phiên tiếp theo bắt đầu với harness đã được cải tiến sẵn:

<div align="center">
<img src="../../assets/ui-panel-dark.png" alt="Phiên tiếp theo: pill đang mở, liệt kê bản thích ứng đang hoạt động và lệnh gọi mà nó đã từ chối trước khi lệnh kịp chạy" width="1200" />
</div>

Gõ `/rsi` trong bất kỳ phiên nào để xem những gì đang được gắn, mỗi thứ thuộc tầng nào, và những gì đang chờ bạn phê duyệt.

Các profile `desktop` và `headless`, chỉ mục plugin, tarball cục bộ và cách nạp plugin cho riêng một lần chạy đều được trình bày trong [tài liệu tham khảo plugin](../../packages/dsh-rsi/README.md#install).

---

<a id="how-it-works"></a>

## 🧠 DSHRSI hoạt động thế nào: một vòng khép kín bên trong harness, chạy đi chạy lại

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/pit-stop.dark.svg" />
  <img src="../../assets/pit-stop.svg" alt="Cách DSHRSI hoạt động, vẽ như một lần vào pit: chiếc xe là harness, tay đua là mô hình, linh kiện mới là mã harness được viết ngay giữa lượt" width="960" />
</picture>
</div>

Skill, file memory và system prompt dài hơn đều hoạt động ở cấp độ ngữ cảnh: chúng thêm văn bản vào rồi hy vọng mô hình làm theo. Khi mô hình không làm theo, cùng lệnh gọi thất bại ấy lại được thực hiện ở phiên tiếp theo.

**DSHRSI hoạt động ở cấp độ harness. Những gì nó học được trở thành code gắn trên chính các điểm mở rộng của harness:**

| Giai đoạn | Cơ chế | Hiệu quả |
| :--- | :--- | :--- |
| **1. Quan sát** | 16 bộ phát hiện đọc các sự kiện của phiên đã được chuẩn hóa: những lệnh gọi thất bại lần nữa, nguyên nhân thất bại cứ quay lại, loay hoay thử lệnh, người dùng sửa sai, những lượt kết thúc mà chưa kiểm chứng gì. | Trục trặc có một chữ ký không đổi từ phiên này sang phiên khác. |
| **2. Viết lại** | Chính mô hình của phiên viết một bản thích ứng bằng JavaScript dựa trên một API gồm 10 năng lực. Code bị từ chối được trả về kèm lý do, tối đa hai lần, sau đó một template dựng sẵn sẽ thay thế. | Bản sửa là code harness, không phải thêm một đoạn prompt nữa. |
| **3. Kiểm định** | Tĩnh → nạp → phát lại → hồi quy → quyền hạn. Bản thích ứng phải tác động lên những lệnh gọi đã kích hoạt nó và không được đụng tới bất kỳ lệnh gọi nào đã thành công trong phiên này. | Code không làm gì cả, hoặc làm hỏng thứ vốn đang chạy tốt, sẽ không bao giờ được gắn. |
| **4. Gắn** | Bản thích ứng chạy trong ngữ cảnh cô lập riêng của nó, mọi lệnh gọi đều có timeout, và có hiệu lực trước request kế tiếp gửi tới mô hình. | Chính lượt đã gặp trục trặc là lượt đầu tiên được hưởng lợi. |
| **5. Lưu giữ và chia sẻ** | Mỗi máy giữ một thư viện các bản thích ứng. Cái gì hiệu quả thì được thăng hạng, cái gì ném lỗi thì bị cách ly, cái gì không trụ được thì được viết lại chặt hơn, còn quy tắc của dự án được ghi vào repository. | Phiên tiếp theo bắt đầu ở trạng thái đã thích ứng, và đồng đội nhận được quy tắc của dự án sau khi họ chấp nhận chúng. |
| **↻ Lặp lại** | Phiên tiếp theo chạy trên harness mà giai đoạn 5 để lại, và giai đoạn 1 quan sát nó cùng với mọi bản thích ứng đã gắn sẵn. | Cải tiến được xây trên cải tiến. Đó chính là đệ quy. |

---

<a id="measured"></a>

## 🔬 Đo thực tế với một mô hình thật

Các con số này đến từ việc chạy một mô hình thật, `mimo-v2.6-pro`, qua các phiên `dsh` thật (`npm run test:live`). Không có gì trong bảng này là mô phỏng.

> **Cách đọc bảng này:** cỡ mẫu nhỏ. Một mô hình, ba kịch bản, mỗi kịch bản vài phiên. Nó cho thấy vòng lặp hoạt động được từ đầu đến cuối. Đây **không** phải là một khẳng định thống kê về tỷ lệ thành công, và cũng không có gì nhanh hơn: viết một bản thích ứng phải chờ mô hình 30–60 giây. Các lần chạy quy mô lớn hơn nằm ở phần [Benchmark](#benchmarks).

| Kịch bản | Không có DSHRSI | Có DSHRSI | Harness đã viết gì |
| :--- | :--- | :--- | :--- |
| **Thiếu lệnh**: hướng dẫn ghi `python`, máy chỉ có `python3` | ❌ **5 / 5** phiên thực hiện lệnh gọi thất bại | ✅ **0 / 7** phiên sau khi có bản thích ứng (9 / 9 trước đó) | `deny` + `prompt`, do mô hình viết, qua cổng kiểm định ngay lần thử đầu tiên |
| **Một quy tắc người dùng chỉ nói một lần**: đừng bao giờ sửa một file nào đó, thay vào đó hãy ghi vào bản nháp của nó | ❌ Phiên tiếp theo đã sửa file đó | ✅ Phiên tiếp theo tự ghi vào bản nháp mà không cần nhắc | `deny` + `prompt`, do mô hình viết ngay sau khi bị sửa sai |
| **Một bản sửa không ai yêu cầu kiểm chứng** | không chạy | ⚪ Không viết gì: mô hình tự kiểm chứng bản sửa của mình trong 3 / 3 phiên, nên không có gì để học | không có |

---

<a id="benchmarks"></a>

## 📊 Benchmark: bốn bộ, hai mô hình, đối chiếu từng task

DeepSeek Harness nguyên bản so với DeepSeek Harness + DSHRSI, qua 3,390 phiên `dsh` thật: cùng mô hình, cùng prompt, cùng sandbox, cùng task. Plugin chạy với thiết lập mặc định và bắt đầu mỗi bộ benchmark với một thư viện trống. Số task giải được trên ba bộ đã chạy đến cùng:

<!-- bench:table:start -->
| Benchmark | Số task | `mimo-v2.6-pro` nguyên bản | `mimo-v2.6-pro` + DSHRSI | `mimo-v2.6-flash` nguyên bản | `mimo-v2.6-flash` + DSHRSI |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Aider Polyglot**, lần thử đầu | 225 | 224 (99.6%) | 224 (99.6%) | 220 (97.8%) | 223 (99.1%) |
| **Aider Polyglot**, trong hai lần thử | 225 | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) |
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

> **Cách đọc bảng này:** xét về số task giải được, hai harness **không thể phân biệt được với nhau**. Mức tăng lớn nhất là +7 (MBPP+ với `mimo-v2.6-flash`), mức giảm lớn nhất là −3 (MBPP với `mimo-v2.6-pro`), và không khác biệt nào đứng vững trong kiểm định McNemar chính xác trên cùng các task (p nhỏ nhất = 0.17). Khi agent có thể tự chạy code của mình, các bộ benchmark này đã gần chạm trần với cả hai mô hình, và mỗi task là một thư mục mới tinh, sạch sẽ: rất ít thứ lặp lại để một harness có thể học từ đó.

**Điều DSHRSI thực sự đã làm, không cần một gợi ý nào, là tự thay đổi chính nó.** Qua tám lần chạy, các mô hình đã viết **56 bản thích ứng**; 15 bản trong số đó đã thực sự hành động, và 10 bản trong số này đã được mở rộng ra toàn máy. Với từng bản trong 10 bản ấy, chúng tôi lấy các task bắt đầu sau khi nó xuất hiện và so sánh với chính những task đó dưới DSH nguyên bản:

| Lỗi mà harness đã tự học cách tránh | DSH nguyên bản | DSH + DSHRSI | p |
| :--- | ---: | ---: | ---: |
| Một lần chạy test chết ngay ở assertion thất bại đầu tiên (MBPP, `mimo-v2.6-pro`) | 16 trên 310 task | **3 trên 310** | 0.002 |
| Đọc một file tại một đường dẫn không tồn tại (Polyglot, `mimo-v2.6-flash`) | 7 trên 151 task | **1 trên 151** | 0.07 |
| 8 bản thích ứng còn lại | không có thay đổi đo được | | |

Không bản nào trong hai bản này làm cho số task pass tăng lên, và plugin tốn thêm khoảng 8–9% thời gian chạy agent và token đầu vào. Cả mười bản đều được liệt kê trong [ghi chú benchmark](../../bench/README.md#did-those-adaptations-work).

**LiveCodeBench v6 bị dừng giữa chừng:** tài khoản mô hình hết số dư khi đang chạy dở. Trên các task mà cả hai bên đã hoàn thành tính đến lúc đó, DSH nguyên bản giải được 94 và DSHRSI giải được 96 trên 105 với `mimo-v2.6-pro`, còn với `mimo-v2.6-flash` là 42 so với 42 trên 51. Cũng vì lý do đó, đợt chạy thứ hai (chạy lại cùng các task trên thư viện mà đợt đầu để lại) vẫn chưa được thực hiện.

Quy trình đánh giá, các bảng chi phí và lỗi, các giới hạn và các lệnh để chạy lại toàn bộ đều nằm trong [ghi chú benchmark](../../bench/README.md).

---

<a id="coverage"></a>

## 🛡️ Bộ phát hiện & năng lực

**16 bộ phát hiện** quyết định khi nào harness nên thay đổi. [Danh sách đầy đủ](../../packages/dsh-rsi/README.md#detectors) nằm trong tài liệu tham khảo plugin.

**10 năng lực** là tất cả những gì một bản thích ứng có thể làm. Nó chỉ chạm được tới harness thông qua chúng:

| Năng lực | Nó làm gì | Cấp |
| :--- | :--- | :---: |
| `annotate` | Nối thêm một ghi chú vào kết quả công cụ | ✅ tự động |
| `steer` | Thêm một ghi chú trước request kế tiếp gửi tới mô hình | ✅ tự động |
| `deny` | Từ chối một lệnh gọi công cụ và nêu lý do | ✅ tự động |
| `ask` | Yêu cầu người dùng phê duyệt một lệnh gọi | ✅ tự động |
| `block` | Biến một kết quả công cụ thành lỗi có kèm hướng sửa | ✅ tự động |
| `verify` | Không cho lượt kết thúc khi một điều kiện chưa được thỏa mãn | ✅ tự động |
| `prompt` | Thêm một mục cố định vào system prompt | ✅ tự động |
| `rewrite` | Thay thế văn bản của một kết quả công cụ | 🔐 cần phê duyệt |
| `tool` | Đăng ký một công cụ mới cho mô hình | 🔐 cần phê duyệt |
| `exec` | Chạy một lệnh qua công cụ shell của harness, theo cùng các quy tắc sandbox và phê duyệt | 🔐 cần phê duyệt |

Đây là bản thích ứng mà mô hình đã viết trong kịch bản đầu tiên ở trên:

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

## 🧩 Ba tầng, và mỗi dự án một harness

Mỗi bản thích ứng thuộc về một trong ba tầng. Từng tầng có thể được tắt riêng:

| Tầng | Nó chứa gì | Ví dụ | Phạm vi áp dụng |
| :--- | :--- | :--- | :--- |
| **`machine`** | Các sự thật về chiếc máy tính này | Không có `python`; một cổng đã bị chiếm; một host nội bộ không phân giải được | Workspace nơi nó được học, rồi toàn máy khi một workspace thứ hai gặp phải nó |
| **`user`** | Cách bạn muốn được đối xử | Một câu trả lời bị đánh dấu là tệ với lý do "quá dài" | Toàn máy |
| **`project`** | Quy tắc và thói quen của một repository | "Repository này luôn luôn dùng pnpm" | Workspace, và chính repository: các quy tắc được commit cùng với code |

**Tầng project đi cùng với code:**

- **Commit để chia sẻ, xóa để gỡ ra.** Một file là một bản thích ứng.
- **Không có gì chạy chỉ vì nó được clone về.** Mỗi máy chấp nhận đúng nội dung của các file bằng `dsh-rsi trust`, và phải chấp nhận lại khi chúng thay đổi.
- **Một dự án chỉ có thể làm cho harness thận trọng hơn**, không bao giờ ngược lại. Các thiết lập như `autonomy` nằm ngoài tầm với của dự án.
- **Mang đi được cả ngoài repository.** `dsh-rsi export` và `dsh-rsi import` mang tầng machine và tầng user sang một máy tính khác dưới dạng một file duy nhất.

---

<a id="security"></a>

## 🔒 An toàn & cấu hình mặc định

- **Cấp tự động chỉ được siết chặt** — Khi chưa có sự phê duyệt của bạn, một bản thích ứng chỉ có thể bổ sung thông tin, từ chối, hỏi, hoặc đòi phải kiểm chứng. `deny` và `ask` của nó chỉ có thể làm cho phán quyết của các chính sách khác nghiêm ngặt hơn.
- **Năng lực mạnh phải được phê duyệt (`autonomy: tighten`)** — Các bản thích ứng viết lại kết quả, thêm công cụ hoặc chạy lệnh được lưu ở trạng thái `proposed` và chờ `dsh-rsi approve <id>`.
- **Vô hình cho đến khi cần** — Khi không có ma sát và chưa gắn gì, system prompt, danh sách công cụ và các message giữ nguyên đến từng byte. Có một test end-to-end canh giữ điều này.
- **Lỗi được khoanh vùng** — Một handler ném lỗi không bao giờ ảnh hưởng tới lệnh gọi công cụ mà nó gắn vào. Sau ba lỗi, bản thích ứng bị cách ly.
- **Mọi thứ đều được ghi lại** — Mọi quyết định, ma sát, lần gắn và hành động đều được ghi vào nhật ký. `dsh-rsi disable`, `retire` và `rollback` gỡ một bản thích ứng ra hoặc đưa nó về bản trước.
- **Ba chế độ** — `adapt` gắn trực tiếp (mặc định), `propose` sinh ra rồi chờ bạn, `observe` chỉ ghi nhận.

---

<a id="faq"></a>

## ❓ Câu hỏi thường gặp

<details>
<summary><strong>DSHRSI có fine-tune hay thay đổi mô hình không?</strong></summary>

Không. Trọng số của mô hình không bị đụng tới và không có gì được huấn luyện. Thứ thay đổi là harness: phần code chạy bao quanh prompt và lệnh gọi công cụ của mô hình. RSI ở đây là Tự cải tiến đệ quy ở cấp độ harness: nó tự cải tiến từ chính các lần chạy của mình, và mỗi vòng bắt đầu từ harness mà vòng trước để lại.
</details>

<details>
<summary><strong>Đây có thật sự là "đệ quy" không, hay chỉ là một harness biết học quy tắc?</strong></summary>

Tính đệ quy ở đây là cụ thể, và nó nằm ngay trong code. Một phiên mới gắn mọi thứ mà thư viện đang giữ, nên các bộ phát hiện quan sát một harness đã thay đổi rồi. Khi cùng một trục trặc xảy ra hai lần trong những phiên đã gắn sẵn một bản thích ứng, mô hình nhận được mã nguồn hiện tại cùng bằng chứng, rồi viết một phiên bản chặt hơn; bản cũ được giữ lại để rollback. Trục trặc gặp phải ở một workspace thứ hai sẽ mở rộng bản thích ứng ra toàn máy. Thứ không đệ quy là trọng tài: bộ phát hiện, chính sách kích hoạt và cổng kiểm định không thể bị bất kỳ bản thích ứng nào thay đổi.
</details>

<details>
<summary><strong>Nó khác gì so với skill, file memory hay một system prompt dài hơn?</strong></summary>

Những thứ đó thêm văn bản mà mô hình có thể làm theo hoặc không. Một bản thích ứng là code trên các điểm mở rộng của harness: nó có thể từ chối một lệnh gọi công cụ trước khi lệnh chạy, yêu cầu bạn phê duyệt, hoặc không cho một lượt kết thúc khi chưa có gì được kiểm chứng. Trong các lần chạy đo thực tế, mô hình vẫn thử gọi `python` trong 3 phiên sau khi đã được bảo là đừng, và lệnh gọi bị từ chối trước khi nó kịp chạy.
</details>

<details>
<summary><strong>Nó có làm chậm các phiên của tôi không?</strong></summary>

Viết một bản thích ứng phải chờ một phản hồi đầy đủ của mô hình: 30–60 giây trên `mimo-v2.6-pro`, trong thời gian đó bước này đứng yên. Các bản thích ứng đã gắn chạy trong cùng tiến trình và có timeout. Không đo được mức tăng tốc nào, và chúng tôi cũng không tuyên bố là có.
</details>

<details>
<summary><strong>Một bản thích ứng do mô hình viết có thể làm điều gì nguy hiểm không?</strong></summary>

Cấp tự động không thể cho phép bất cứ điều gì mà harness vốn sẽ từ chối, còn các năng lực mạnh thì chờ bạn phê duyệt. Code chạy trong ngữ cảnh `node:vm` riêng của nó, phía sau một cầu nối JSON. Điều này chống được sai sót và kiểu dùng sai tùy tiện. Nó **không** phải là một ranh giới bảo mật trước code độc hại, vì vậy hãy đọc các file `.dsh-rsi/` của dự án trước khi chạy `dsh-rsi trust`.
</details>

<details>
<summary><strong>Nó hoạt động với những mô hình nào?</strong></summary>

Các bản thích ứng được viết bởi mô hình hiện tại của phiên, hoặc bởi mô hình bạn chỉ định qua `provider` và `model`. Nếu mô hình không viết ra được code vượt qua cổng kiểm định, các template dựng sẵn sẽ thay thế. Các lần chạy cho đến nay dùng hai mô hình thuộc cùng một dòng, `mimo-v2.6-pro` và `mimo-v2.6-flash`.
</details>

<details>
<summary><strong>Nó có chạy được trong ứng dụng desktop DeepSeek Harness không?</strong></summary>

Nó được phát hành như một plugin bên thứ ba thông thường, kèm metadata mà các trang plugin đọc, và được cài vào profile `web` mà ứng dụng bọc lại. Nó chưa được kiểm chứng bên trong ứng dụng desktop thật.
</details>

<details>
<summary><strong>Làm sao để xem, hoàn tác hoặc tắt những gì nó đã học?</strong></summary>

Gõ `/rsi` trong một phiên, hoặc `dsh-rsi status` trong terminal. `dsh-rsi show <id>` in ra mã nguồn và báo cáo kiểm định của một bản thích ứng; `disable`, `retire` và `rollback` gỡ nó ra hoặc đưa nó về bản trước. Đặt `mode: observe` để chỉ ghi nhận mà không thay đổi gì.
</details>

---

<a id="docs"></a>

## 📚 Tài liệu & liên kết

- [📖 Tài liệu tham khảo plugin](../../packages/dsh-rsi/README.md) — mọi bộ phát hiện, năng lực, lệnh và thiết lập
- [🚀 Nguồn cài đặt & profile](../../packages/dsh-rsi/README.md#install)
- [🧩 Các tầng & harness dự án](../../packages/dsh-rsi/README.md#layers-and-the-project-harness)
- [🔬 Cổng kiểm định](../../packages/dsh-rsi/README.md#the-validation-gate)
- [🛠️ Dòng lệnh `dsh-rsi`](../../packages/dsh-rsi/README.md#command-line) · [⚙️ Cấu hình](../../packages/dsh-rsi/README.md#configuration)
- [⚠️ Giới hạn đã biết](../../packages/dsh-rsi/README.md#known-limits)
- [📊 Quy trình & kết quả benchmark](../../bench/README.md)
- [🧱 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — harness mà plugin này cắm vào

<a id="contributing"></a>

## 🤝 Đóng góp & cộng đồng

Issue và PR luôn được chào đón tại [qybaihe/dshrsi](https://github.com/qybaihe/dshrsi). Trước khi gửi PR:

```bash
npm install && npm test    # 130 unit test, rồi 29 test end-to-end; không cần key
```

Các test end-to-end thay endpoint của mô hình bằng một endpoint mô phỏng. Mọi thứ khác đều là thật: tiến trình `dsh`, việc thực thi công cụ, log của phiên và việc cài đặt plugin.

## 📄 Giấy phép

[MIT](../../LICENSE)

---

Created in [T3 Code](https://t3.codes).
