<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [繁體中文](README_zh-TW.md) · [日本語](README_ja.md) · **한국어** · [Türkçe](README_tr.md) · [Русский](README_ru.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · [Deutsch](README_de.md) · [Español](README_es.md) · [Français](README_fr.md) · [Українська](README_uk.md) · [Polski](README_pl.md) · [Português (Brasil)](README_pt-BR.md) · [العربية](README_ar.md) · [فارسی](README_fa.md) · [Bahasa Indonesia](README_id.md) · [Italiano](README_it.md) · [Ελληνικά](README_el.md) · [മലയാളം](README_ml.md) · [Roman Urdu](README_ur-Latn.md) · [Română](README_ro.md)

<br />

<img src="../../packages/dsh-rsi/icon.svg" alt="DSHRSI" width="88" />

# DSHRSI: DeepSeek Harness를 위한 Recursive Self-Improvement(재귀적 자기 개선)

### **관찰 → 개선 → 그 위에 쌓기 → 다시. 쓸수록 점점 더 내 것이 되어 가는 하네스.**

<a href="https://qybaihe.github.io/dshrsi/trace.html">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/rsi-trace.dark.gif" />
    <img src="../../assets/rsi-trace.gif" alt="실제 실행을 재생한 애니메이션: 기본 하네스에서는 세션 30개 중 12개가 똑같은 실패 호출을 했고, DSHRSI를 쓰면 세 번째에 하네스가 스스로를 개선해 이후 22개 세션에서는 한 번만 발생했습니다" width="960" />
  </picture>
</a>

**RSI는 Recursive Self-Improvement, 즉 재귀적 자기 개선을 뜻하며, DSHRSI는 이를 DeepSeek Harness에서 현실로 만드는 오픈소스 플러그인입니다. 하네스가 자신의 실행을 지켜보고, 발견한 문제에 대해 그 세션의 모델이 직접 하네스 코드를 작성하게 하고, 그 코드를 5단계 게이트에서 검증한 다음, 턴이 끝나기 전에 마운트합니다. 그러면 개선된 하네스가 다음 세션을 실행하고, 또 한 번 개선됩니다. 파인튜닝은 없습니다. 프롬프트 더미도 없습니다. 측정되고, 유지되고, 다시 쓰이거나 버려지는 코드가 있을 뿐입니다.**

[![RSI](https://img.shields.io/badge/RSI-Recursive_Self--Improvement-4d6bfe?style=for-the-badge)](#rsi)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-0.2.2--rc.3_plugin-7c5cff?style=for-the-badge)](https://github.com/deepseek-ai/deepseek-harness)
[![Validation](https://img.shields.io/badge/Validation-5--Stage_Gate-0ea5e9?style=for-the-badge)](#how-it-works)
[![Benchmarks](https://img.shields.io/badge/Benchmarks-4_Suites_%C2%B7_2_Models-2563eb?style=for-the-badge)](#benchmarks)
[![MIT License](https://img.shields.io/badge/License-MIT-38bdf8?style=for-the-badge)](../../LICENSE)

**[🌐 웹사이트](https://qybaihe.github.io/dshrsi/) · [📖 플러그인 레퍼런스](../../packages/dsh-rsi/README.md) · [🐛 이슈](https://github.com/qybaihe/dshrsi/issues)**

[RSI의 의미](#rsi) · [빠른 시작](#quick-start) · [동작 원리](#how-it-works) · [실측 결과](#measured) · [벤치마크](#benchmarks) · [감지기와 기능](#coverage) · [프로젝트 하네스](#project-harness) · [안전 기본값](#security) · [자주 묻는 질문](#faq)

</div>

---

> [!IMPORTANT]
> **개발자 프리뷰:** DSHRSI는 DeepSeek Harness `0.2.2-rc.3`을 기준으로 만들어졌으며, 이 버전 자체가 개발자 프리뷰입니다. **호환성을 깨는 변경이 있을 것입니다.**
> 어댑테이션은 모델이 작성해서 여러분의 하네스 안에서 실행되는 코드입니다. 그 격리 장치는 실수를 막기 위한 것이지, **악성 코드를 막기 위한 것이 아닙니다**. 실행하기 전에 [검증 게이트](../../packages/dsh-rsi/README.md#the-validation-gate)에 관한 설명을 읽어 보세요.

<div align="center">
<img src="../../assets/ui-evolving.png" alt="DeepSeek Harness 세션: 도구 호출 두 번이 exit code 127로 실패한 뒤, 하네스가 스스로를 개선하면서 RSI 배지와 입력창 아래의 상태 pill이 켜지는 모습" width="1200" />
</div>

<br />

<table>
<tr>
<td width="33%" valign="top">

### 🔴 DSHRSI가 없을 때
세션마다 같은 사실을 처음부터 다시 알아내야 합니다. 이 머신에는 `python`이 없고, 이 저장소에는 이미 말해 둔 규칙이 있으며, 이 수정은 한 번도 검증된 적이 없다는 사실입니다. 대조 실행에서는 **세션 5개 중 5개**가 똑같은 실패 호출을 했고, 사용자가 말해 둔 규칙은 한 세션 뒤에 또 깨졌습니다.

</td>
<td width="33%" valign="top">

### 🧬 DSHRSI가 있을 때
문제가 다시 나타나면 모델이 하네스 코드를 한 조각 작성하고, 그 코드가 게이트를 통과해 **바로 그 턴 안에** 적용됩니다. 실제 모델을 대상으로 한 3번의 실행에서, 어댑테이션 이후의 **세션 7개 중 7개**에는 실패한 호출이 없었습니다. 그리고 다음 개선은 거기서부터 시작합니다.

</td>
<td width="33%" valign="top">

### 🔒 조이기만 가능한 설계
어댑테이션은 정보를 덧붙이거나, 호출을 거부하거나, 먼저 사용자에게 묻거나, 검증을 요구할 수 있습니다. **어떤 기능도 하네스가 거부했을 일을 허용할 수는 없습니다.** 결과 재작성, 도구 추가, 명령 실행은 사용자의 승인을 기다립니다.

</td>
</tr>
</table>

---

<a id="rsi"></a>

## 🔁 RSI = Recursive Self-Improvement, 재귀적 자기 개선

"rewrite itself"(스스로 다시 쓰기)가 아닙니다. **재귀적 자기 개선**: 시스템이 자신의 능력으로 스스로를 개선하고, 개선된 시스템이 다음 라운드를 수행합니다. 단어는 세 개이고, DSHRSI는 그 하나하나의 이름값을 해야 합니다:

| | 필요한 조건 | DSHRSI가 해내는 방식 |
| :--- | :--- | :--- |
| **자기 (Self)** | 행동하는 쪽과 바뀌는 쪽이 같은 시스템입니다 | 하네스가 하네스를 바꿉니다. 어댑테이션은 문제를 겪은 바로 그 세션의 모델이 작성합니다. 밖에서 누가 튜닝해 주지 않습니다 |
| **개선 (Improvement)** | "더 낫다"는 것을 확인할 수 있어야 합니다 | 모든 어댑테이션은 마운트되기 전에 5단계 게이트를 통과하고, 이후의 세션들이 그 어댑테이션을 계속 시험합니다. 효과가 있으면 승격되고, 예외를 던지면 격리됩니다 |
| **재귀적 (Recursive)** | 한 라운드의 결과물이 다음 라운드의 출발점입니다 | 다음 세션은 개선된 하네스 위에서 실행되고, 그 하네스와 함께 관찰됩니다. 문제를 막아 내지 못한 어댑테이션은 증거를 바탕으로 더 엄격하게 다시 작성됩니다. 두 번째 워크스페이스에서도 필요해진 어댑테이션은 머신 전체로 확장되고, 프로젝트의 규칙은 모든 팀원의 하네스로 전해집니다 |

**네 개의 루프, 하나가 다음 루프 안에 들어 있습니다:** 턴 안에서 → 세션에서 세션으로 → 개선 자체가 개선되고 → 프로젝트에서 머신으로, 그리고 팀으로.

의도적으로 재귀하지 **않는** 부분도 있습니다. 모델의 가중치는 절대 바뀌지 않으며, 감지기와 트리거 정책, 검증 게이트는 어떤 어댑테이션도 건드릴 수 없는 고정된 코드입니다. 스스로를 수정하는 부분은, 그것이 수정할 수 없는 부분이 검사합니다.

---

<a id="quick-start"></a>

## ⚡ 30초 빠른 시작

### 1. 이미 작업하고 있는 곳에 설치하기
DeepSeek Harness 데스크톱 앱이나 Web UI에서 **Plugins → Add plugin → Install a third-party plugin**을 열고, 아래 릴리스 패키지 주소를 붙여 넣은 다음 **Install**, 이어서 **Enable now**를 선택합니다:

```text
https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
```

명령줄에서도 설치할 수 있습니다. 프로필마다 플러그인을 따로 관리하며, `dsh plugin add`가 호출하는 `pnpm`이 `PATH`에 있어야 합니다:

```bash
dsh plugin --profile web add https://github.com/qybaihe/dshrsi/releases/download/v0.1.3/dsh-rsi-0.1.3.tgz
dsh web
```

### 2. 평소처럼 작업하기
설정할 것은 없습니다. 같은 문제가 다시 나타나기 전까지 DSHRSI는 모습을 드러내지 않습니다. 문제가 다시 나타나면 **RSI** 배지가 켜지고, 입력창 아래의 상태 pill이 하네스가 방금 스스로를 바꿨음을 알려 주며, 다음 세션은 이미 개선된 상태로 시작합니다:

<div align="center">
<img src="../../assets/ui-panel-dark.png" alt="다음 세션: 상태 pill이 펼쳐져, 작동 중인 어댑테이션과 그것이 실행 전에 거부한 호출을 보여 주는 모습" width="1200" />
</div>

어느 세션에서든 `/rsi`를 입력하면 무엇이 마운트되어 있는지, 어느 레이어에 속하는지, 무엇이 승인을 기다리고 있는지 볼 수 있습니다.

`desktop`과 `headless` 프로필, 플러그인 인덱스, 로컬 tarball, 단일 실행에만 로드하는 방법은 [플러그인 레퍼런스](../../packages/dsh-rsi/README.md#install)에서 다룹니다.

---

<a id="how-it-works"></a>

## 🧠 DSHRSI의 동작 원리: 하네스 안에서 돌고 또 도는 닫힌 루프

<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/pit-stop.dark.svg" />
  <img src="../../assets/pit-stop.svg" alt="DSHRSI의 동작을 피트 스톱으로 그린 그림: 차는 하네스, 드라이버는 모델, 새 부품은 턴 도중에 작성된 하네스 코드" width="960" />
</picture>
</div>

스킬, 메모리 파일, 더 긴 시스템 프롬프트는 모두 컨텍스트 수준에서 작동합니다. 텍스트를 덧붙이고 모델이 따라 주기를 바랄 뿐입니다. 모델이 따르지 않으면 다음 세션에서 똑같은 실패 호출이 또 나옵니다.

**DSHRSI는 하네스 수준에서 작동합니다. 배운 것은 하네스 자체의 확장 포인트에 올라가는 코드가 됩니다:**

| 단계 | 메커니즘 | 효과 |
| :--- | :--- | :--- |
| **1. 관찰** | 16개의 감지기가 정규화된 세션 이벤트를 읽습니다. 다시 실패하는 호출, 계속 되돌아오는 실패 원인, 갈팡질팡하는 시도, 사용자의 정정, 아무것도 검증하지 않은 채 끝나는 턴을 찾습니다. | 문제에 세션이 바뀌어도 변하지 않는 시그니처가 붙습니다. |
| **2. 재작성** | 세션의 모델이 직접, 10가지 기능으로 이루어진 API에 맞춰 JavaScript 어댑테이션을 작성합니다. 반려된 코드는 사유와 함께 되돌아가며, 최대 두 번까지 그렇게 한 뒤에는 내장 템플릿이 넘겨받습니다. | 해결책은 프롬프트에 붙는 문단 하나가 아니라 하네스 코드입니다. |
| **3. 검증** | 정적 검사 → 로드 → 리플레이 → 회귀 → 권한. 어댑테이션은 자신을 촉발한 호출에는 반드시 개입해야 하고, 이 세션에서 성공한 호출은 하나도 건드려서는 안 됩니다. | 아무 일도 하지 않는 코드, 이미 잘 되던 것을 망가뜨리는 코드는 절대 마운트되지 않습니다. |
| **4. 마운트** | 어댑테이션은 자신만의 격리된 컨텍스트에서 실행되고, 모든 호출에 타임아웃이 걸려 있으며, 다음 모델 요청 전에 효력이 생깁니다. | 문제를 겪은 바로 그 턴이 가장 먼저 혜택을 봅니다. |
| **5. 보관과 공유** | 머신마다 어댑테이션 라이브러리가 하나씩 있습니다. 효과가 있으면 승격되고, 예외를 던지면 격리되고, 문제를 막아 내지 못하면 더 엄격하게 다시 작성되며, 프로젝트 규칙은 저장소에 기록됩니다. | 다음 세션은 이미 적응된 상태로 시작하고, 팀원은 수락하고 나면 프로젝트의 규칙을 받습니다. |
| **↻ 다시** | 다음 세션은 5번 단계가 남긴 하네스 위에서 실행되고, 1번 단계는 모든 어댑테이션이 적용된 상태에서 그 세션을 관찰합니다. | 개선 위에 개선이 쌓입니다. 이것이 재귀입니다. |

---

<a id="measured"></a>

## 🔬 실제 모델로 측정한 결과

이 수치는 실제 모델 `mimo-v2.6-pro`를 실제 `dsh` 세션에서 돌려 얻은 것입니다(`npm run test:live`). 이 표에 시뮬레이션된 값은 하나도 없습니다.

> **읽는 법:** 표본이 작습니다. 모델 하나, 시나리오 세 개, 시나리오마다 세션 몇 개입니다. 이 결과는 루프가 처음부터 끝까지 작동한다는 것을 보여 줍니다. 성공률에 대한 통계적 진술은 **아니며**, 빨라진 것도 없습니다. 어댑테이션을 작성하는 동안 모델을 30–60초 기다려야 합니다. 더 큰 규모의 실행은 [벤치마크](#benchmarks)에 있습니다.

| 시나리오 | DSHRSI 없음 | DSHRSI 있음 | 하네스가 작성한 것 |
| :--- | :--- | :--- | :--- |
| **없는 명령**: 안내문에는 `python`이라고 적혀 있는데 머신에는 `python3`만 있습니다 | ❌ **5 / 5** 세션이 실패 호출을 했습니다 | ✅ 어댑테이션 이후 **0 / 7** 세션 (그 전에는 9 / 9) | `deny` + `prompt`. 모델이 작성했고, 첫 시도에 게이트를 통과했습니다 |
| **사용자가 한 번 말한 규칙**: 어떤 파일은 절대 수정하지 말고, 대신 그 파일의 초안에 쓸 것 | ❌ 다음 세션이 그 파일을 수정했습니다 | ✅ 다음 세션이 시키지 않아도 초안에 썼습니다 | `deny` + `prompt`. 정정 직후에 모델이 작성했습니다 |
| **아무도 검증하라고 하지 않은 수정** | 실행하지 않음 | ⚪ 작성된 것 없음: 모델이 3 / 3 세션에서 스스로 수정을 검증했으므로 배울 것이 없었습니다 | 없음 |

---

<a id="benchmarks"></a>

## 📊 벤치마크: 네 개의 스위트, 두 개의 모델, 태스크 하나하나

순정 DeepSeek Harness와 DeepSeek Harness + DSHRSI를 3,390개의 실제 `dsh` 세션에서 맞붙였습니다. 같은 모델, 같은 프롬프트, 같은 샌드박스, 같은 태스크입니다. 플러그인은 기본 설정으로 실행되며, 모든 스위트를 빈 라이브러리에서 시작합니다. 끝까지 실행된 세 스위트에서 해결한 태스크 수는 다음과 같습니다:

<!-- bench:table:start -->
| 벤치마크 | 태스크 수 | `mimo-v2.6-pro` 순정 | `mimo-v2.6-pro` + DSHRSI | `mimo-v2.6-flash` 순정 | `mimo-v2.6-flash` + DSHRSI |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Aider Polyglot**, 첫 시도 | 225 | 224 (99.6%) | 224 (99.6%) | 220 (97.8%) | 223 (99.1%) |
| **Aider Polyglot**, 두 번 이내 | 225 | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) | 225 (100.0%) |
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

> **읽는 법:** 해결한 태스크 수로는 두 하네스를 **구분할 수 없습니다**. 가장 큰 증가는 +7(`mimo-v2.6-flash`의 MBPP+), 가장 큰 감소는 −3(`mimo-v2.6-pro`의 MBPP)이며, 같은 태스크에 대한 정확 McNemar 검정에서 버텨 내는 차이는 하나도 없습니다(가장 작은 p = 0.17). 에이전트가 자기 코드를 직접 실행할 수 있으면 이 스위트들은 두 모델 모두에서 천장에 가깝고, 태스크마다 새로 만든 깨끗한 디렉터리에서 시작하기 때문에 하네스가 배울 만큼 되풀이되는 것이 거의 없습니다.

**DSHRSI가 실제로 한 일은, 힌트 하나 없이 스스로를 바꾼 것입니다.** 여덟 번의 실행에 걸쳐 모델들은 **56개의 어댑테이션**을 작성했습니다. 그중 15개가 실제로 개입했고, 그 가운데 10개는 머신 전체로 확장되었습니다. 이 10개 각각에 대해, 해당 어댑테이션이 생긴 뒤에 시작된 태스크를 골라 순정 DSH에서의 바로 그 태스크들과 비교했습니다:

| 하네스가 스스로 피하는 법을 배운 실패 | 순정 DSH | DSH + DSHRSI | p |
| :--- | ---: | ---: | ---: |
| 첫 번째로 실패한 assertion에서 죽어 버리는 테스트 실행 (MBPP, `mimo-v2.6-pro`) | 태스크 310개 중 16개 | **310개 중 3개** | 0.002 |
| 존재하지 않는 경로에서 파일을 읽으려는 시도 (Polyglot, `mimo-v2.6-flash`) | 태스크 151개 중 7개 | **151개 중 1개** | 0.07 |
| 나머지 어댑테이션 8개 | 측정 가능한 변화 없음 | | |

둘 중 어느 것도 통과하는 태스크 수를 늘리지는 못했고, 플러그인은 에이전트 시간과 입력 토큰을 약 8–9% 더 썼습니다. 열 개 전부는 [벤치마크 문서](../../bench/README.md#did-those-adaptations-work)에 정리되어 있습니다.

**LiveCodeBench v6는 중간에 끊겼습니다:** 도중에 모델 계정의 잔액이 바닥났습니다. 그때까지 양쪽이 모두 끝낸 태스크만 보면, `mimo-v2.6-pro`에서는 105개 중 순정 DSH가 94개, DSHRSI가 96개를 해결했고, `mimo-v2.6-flash`에서는 51개 중 42개 대 42개였습니다. 같은 이유로 두 번째 패스, 즉 첫 번째 패스가 남긴 라이브러리 위에서 같은 태스크를 다시 돌리는 실행은 아직 하지 못했습니다.

프로토콜, 비용 표와 실패 표, 한계, 그리고 이 모든 것을 재현하는 명령은 [벤치마크 문서](../../bench/README.md)에 있습니다.

---

<a id="coverage"></a>

## 🛡️ 감지기와 기능

하네스가 언제 바뀌어야 하는지는 **16개의 감지기**가 판단합니다. [전체 목록](../../packages/dsh-rsi/README.md#detectors)은 플러그인 레퍼런스에 있습니다.

어댑테이션이 할 수 있는 일은 **10가지 기능**이 전부입니다. 어댑테이션은 오직 이 기능들을 통해서만 하네스에 닿습니다:

| 기능 | 하는 일 | 등급 |
| :--- | :--- | :---: |
| `annotate` | 도구 결과에 메모를 덧붙입니다 | ✅ 자동 |
| `steer` | 다음 모델 요청 앞에 메모를 추가합니다 | ✅ 자동 |
| `deny` | 도구 호출을 거부하고 이유를 알려 줍니다 | ✅ 자동 |
| `ask` | 호출에 사용자의 승인을 요구합니다 | ✅ 자동 |
| `block` | 도구 결과를 교정 내용이 담긴 오류로 바꿉니다 | ✅ 자동 |
| `verify` | 조건이 충족되지 않은 동안에는 턴이 끝나지 못하게 합니다 | ✅ 자동 |
| `prompt` | 시스템 프롬프트에 상시 섹션을 추가합니다 | ✅ 자동 |
| `rewrite` | 도구 결과의 텍스트를 교체합니다 | 🔐 승인 필요 |
| `tool` | 모델이 쓸 새 도구를 등록합니다 | 🔐 승인 필요 |
| `exec` | 하네스의 셸 도구를 통해 명령을 실행하며, 같은 샌드박스와 승인 규칙을 따릅니다 | 🔐 승인 필요 |

다음은 위의 첫 번째 시나리오에서 모델이 작성한 어댑테이션입니다:

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

## 🧩 세 개의 레이어, 그리고 프로젝트마다 하나의 하네스

모든 어댑테이션은 세 레이어 중 하나에 속합니다. 레이어는 각각 따로 끌 수 있습니다:

| 레이어 | 담는 내용 | 예시 | 적용 범위 |
| :--- | :--- | :--- | :--- |
| **`machine`** | 이 컴퓨터에 관한 사실 | `python`이 없다, 포트가 이미 사용 중이다, 내부 호스트가 해석되지 않는다 | 배운 워크스페이스. 두 번째 워크스페이스에서도 같은 문제를 만나면 머신 전체 |
| **`user`** | 사용자가 어떻게 대해 주기를 바라는지 | "너무 길다"는 이유와 함께 나쁨으로 표시된 응답 | 머신 전체 |
| **`project`** | 한 저장소의 규칙과 습관 | "이 저장소는 언제나 pnpm을 쓴다" | 워크스페이스, 그리고 저장소 자체: 규칙이 코드와 함께 커밋됩니다 |

**프로젝트 레이어는 코드와 함께 이동합니다:**

- **커밋하면 공유, 삭제하면 해제.** 파일 하나가 어댑테이션 하나입니다.
- **클론했다는 이유만으로 실행되는 것은 없습니다.** 각 머신은 `dsh-rsi trust`로 파일의 정확한 내용을 수락하고, 파일이 바뀌면 다시 수락합니다.
- **프로젝트는 하네스를 더 보수적으로만 만들 수 있고**, 덜 보수적으로 만들 수는 없습니다. `autonomy` 같은 설정은 프로젝트의 손이 닿지 않습니다.
- **저장소 밖으로도 가져갈 수 있습니다.** `dsh-rsi export`와 `dsh-rsi import`는 머신 레이어와 사용자 레이어를 파일 하나로 다른 컴퓨터에 옮겨 줍니다.

---

<a id="security"></a>

## 🔒 안전 및 설정 기본값

- **자동 등급은 조이기만 가능** — 사용자의 승인 없이 어댑테이션이 할 수 있는 일은 정보 추가, 거부, 질문, 검증 요구뿐입니다. 어댑테이션의 `deny`와 `ask`는 다른 정책들이 내린 판정을 더 엄격하게 만들 수 있을 뿐입니다.
- **강력한 기능은 승인 필요 (`autonomy: tighten`)** — 결과를 재작성하거나, 도구를 추가하거나, 명령을 실행하는 어댑테이션은 `proposed` 상태로 저장되어 `dsh-rsi approve <id>`를 기다립니다.
- **필요할 때까지 보이지 않음** — 마찰이 없고 마운트된 것도 없으면 시스템 프롬프트, 도구 목록, 메시지는 바이트 하나까지 그대로입니다. 엔드투엔드 테스트가 이를 지킵니다.
- **실패는 번지지 않음** — 핸들러가 예외를 던져도, 그 핸들러가 붙어 있는 도구 호출에는 절대 영향을 주지 않습니다. 오류가 세 번 나면 그 어댑테이션은 격리됩니다.
- **모든 것이 기록으로 남음** — 모든 결정과 마찰, 마운트, 개입이 로그에 남습니다. `dsh-rsi disable`, `retire`, `rollback`으로 어댑테이션을 빼거나 이전으로 되돌립니다.
- **세 가지 모드** — `adapt`는 바로 마운트하고(기본값), `propose`는 생성한 뒤 사용자를 기다리며, `observe`는 기록만 합니다.

---

<a id="faq"></a>

## ❓ 자주 묻는 질문

<details>
<summary><strong>DSHRSI는 모델을 파인튜닝하거나 변경하나요?</strong></summary>

아니요. 모델의 가중치는 건드리지 않으며, 학습시키는 것도 없습니다. 바뀌는 것은 하네스, 즉 모델의 프롬프트와 도구 호출을 둘러싸고 실행되는 코드입니다. 여기서 RSI는 하네스 수준의 재귀적 자기 개선입니다. 하네스가 자신의 실행으로부터 스스로를 개선하고, 매 라운드는 직전 라운드가 남긴 하네스에서 출발합니다.
</details>

<details>
<summary><strong>이것은 정말 "재귀적"인가요, 아니면 그냥 규칙을 배우는 하네스인가요?</strong></summary>

재귀는 구체적이며, 코드 안에 있습니다. 새 세션은 라이브러리에 있는 것을 모두 마운트하므로, 감지기는 이미 바뀐 하네스를 관찰합니다. 어댑테이션이 마운트되어 있던 세션들에서 같은 문제가 두 번 발생하면, 모델은 현재 소스와 증거를 받아 더 엄격한 버전을 작성합니다. 이전 버전은 롤백을 위해 보관됩니다. 두 번째 워크스페이스에서 같은 문제를 만나면 어댑테이션은 머신 전체로 확장됩니다. 재귀하지 않는 것은 심판입니다. 감지기, 트리거 정책, 검증 게이트는 어떤 어댑테이션으로도 바꿀 수 없습니다.
</details>

<details>
<summary><strong>스킬, 메모리 파일, 더 긴 시스템 프롬프트와는 무엇이 다른가요?</strong></summary>

그것들은 모델이 따를 수도, 따르지 않을 수도 있는 텍스트를 덧붙입니다. 어댑테이션은 하네스의 확장 포인트에 올라가는 코드입니다. 도구 호출을 실행 전에 거부할 수 있고, 사용자의 승인을 요구할 수 있으며, 아무것도 검증되지 않은 동안에는 턴이 끝나지 못하게 할 수 있습니다. 실측에서 모델은 하지 말라는 말을 들은 뒤에도 3개 세션에서 여전히 `python`을 시도했고, 그 호출은 실행 전에 거부되었습니다.
</details>

<details>
<summary><strong>세션이 느려지나요?</strong></summary>

어댑테이션을 작성하려면 모델의 온전한 응답 한 번을 기다려야 합니다. `mimo-v2.6-pro`에서는 30–60초이며, 그동안 해당 스텝은 멈춰 있습니다. 마운트된 어댑테이션은 프로세스 안에서 타임아웃을 두고 실행됩니다. 속도 향상은 측정되지 않았고, 그렇다고 주장하지도 않습니다.
</details>

<details>
<summary><strong>모델이 작성한 어댑테이션이 위험한 일을 할 수 있나요?</strong></summary>

자동 등급은 하네스가 거부했을 일을 무엇 하나 허용할 수 없고, 강력한 기능은 사용자의 승인을 기다립니다. 코드는 JSON 브리지 뒤의 독립된 `node:vm` 컨텍스트에서 실행됩니다. 이는 실수와 가벼운 오용을 막아 줍니다. 악성 코드에 대한 보안 경계는 **아니므로**, `dsh-rsi trust`를 실행하기 전에 프로젝트의 `.dsh-rsi/` 파일을 읽어 보세요.
</details>

<details>
<summary><strong>어떤 모델에서 동작하나요?</strong></summary>

어댑테이션은 세션의 현재 모델이 작성하거나, `provider`와 `model`로 지정한 모델이 작성합니다. 모델이 게이트를 통과하는 코드를 내놓지 못하면 내장 템플릿이 넘겨받습니다. 지금까지의 실행에는 같은 계열의 두 모델, `mimo-v2.6-pro`와 `mimo-v2.6-flash`를 사용했습니다.
</details>

<details>
<summary><strong>DeepSeek Harness 데스크톱 앱에서도 동작하나요?</strong></summary>

플러그인 페이지가 읽는 메타데이터를 갖춘 평범한 서드파티 플러그인으로 배포되며, 앱이 감싸고 있는 `web` 프로필에 설치됩니다. 실제 데스크톱 앱 안에서는 아직 검증하지 못했습니다.
</details>

<details>
<summary><strong>개선이 잘못된 것으로 드러나면 어떻게 되나요?</strong></summary>

언제든지 되돌릴 수 있습니다. 하네스 자체의 코드는 절대 건드리지 않으며, 어댑테이션의 어떤 버전도 삭제되지 않습니다. 어댑테이션이 계속 실패하거나, 어댑테이션이 거부한 호출이 실제로는 성공하는 것으로 드러나면 하네스가 스스로 되돌립니다. 사용자가 직접 되돌릴 수도 있습니다. `/rsi undo`는 마지막 변경을 취소하고, `dsh-rsi restore`는 하네스 전체를 이전 시점으로 되돌리며, `/rsi off`는 순정 하네스를 실행합니다. 이 모든 것은 이미 실행 중인 세션에 적용됩니다. [되돌리기가 동작하는 방식](../../packages/dsh-rsi/README.md#going-back).
</details>

<details>
<summary><strong>배운 내용을 확인하거나, 되돌리거나, 끄려면 어떻게 하나요?</strong></summary>

세션에서는 `/rsi`, 터미널에서는 `dsh-rsi status`를 사용합니다. `dsh-rsi show <id>`는 어댑테이션의 소스와 검증 보고서를 출력하고, `disable`, `retire`, `rollback`은 어댑테이션을 빼거나 이전으로 되돌립니다. 아무것도 바꾸지 않고 기록만 하려면 `mode: observe`로 설정하세요.
</details>

---

<a id="docs"></a>

## 📚 문서 및 링크

- [📖 플러그인 레퍼런스](../../packages/dsh-rsi/README.md) — 모든 감지기, 기능, 명령, 설정
- [🚀 설치 소스와 프로필](../../packages/dsh-rsi/README.md#install)
- [🧩 레이어와 프로젝트 하네스](../../packages/dsh-rsi/README.md#layers-and-the-project-harness)
- [🔬 검증 게이트](../../packages/dsh-rsi/README.md#the-validation-gate)
- [🛠️ `dsh-rsi` 명령줄](../../packages/dsh-rsi/README.md#command-line) · [⚙️ 설정](../../packages/dsh-rsi/README.md#configuration)
- [⚠️ 알려진 한계](../../packages/dsh-rsi/README.md#known-limits)
- [📊 벤치마크 프로토콜과 결과](../../bench/README.md)
- [🧱 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 이 플러그인이 꽂히는 하네스

<a id="contributing"></a>

## 🤝 기여와 커뮤니티

이슈와 PR은 [qybaihe/dshrsi](https://github.com/qybaihe/dshrsi)에서 환영합니다. PR을 제출하기 전에:

```bash
npm install && npm test    # 단위 테스트 130개, 이어서 엔드투엔드 테스트 29개. 키는 필요 없습니다
```

엔드투엔드 테스트는 모델 엔드포인트를 시뮬레이션된 것으로 바꿉니다. 나머지는 모두 실제입니다. `dsh` 프로세스, 도구 실행, 세션 로그, 플러그인 설치까지 전부 그렇습니다.

## 📄 라이선스

[MIT](../../LICENSE)

---

Created in [T3 Code](https://t3.codes).
