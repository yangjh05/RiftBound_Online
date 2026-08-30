# Spiritforged 카드 구현 순서

## 결론

Spiritforged는 카드 번호순이나 도메인순으로 추가하지 않습니다. **공식 소스 고정 → 상태 기반 → 공용 기믹 → 대표 카드 → 동일 효과군 → 복합 카드** 순서로 추가합니다.

이 순서를 지키는 이유는 Spiritforged의 핵심이 개별 카드 효과보다 다음 세 가지 공용 시스템에 있기 때문입니다.

1. Equipment의 부착 상태, 비활성 Rules Text, 활성 Effect Text와 Might Bonus
2. Gold와 Repeat가 사용하는 결제·추가 비용·선택 선언
3. Quick-Draw와 Weaponmaster가 여는 플레이 효과와 continuation

카드 이름을 검사하는 분기는 사용하지 않습니다. 같은 효과는 기존 `timing:kind`와 공용 resolver를 재사용하고, 규칙상 다른 동작만 새 `kind`로 등록합니다.

## 현재 기준선

2026-08-29 공식 카드 갤러리 기준 Spiritforged 본세트는 221장입니다.

| 유형 | 장수 |
| --- | ---: |
| Unit | 107 |
| Spell | 45 |
| Gear | 42 |
| Battlefield | 15 |
| Legend | 12 |

현재 저장소에는 Spiritforged 본세트 221장이 모두 등록되어 있습니다. 다음 기반과 효과군도 공용 엔진에 구현되어 있습니다.

- `card.attachments`, `attachedToId`, Attach/Detach 이벤트와 이탈 시 분리
- `textSection: "rules" | "effect" | "mightBonus"`에 따른 활성/비활성 처리
- 단순 Equip과 Equipment Might Bonus
- Quick-Draw 및 Weaponmaster 키워드 공용 resolver
- Repeat의 Energy 추가 비용과 플레이 시 반복 대상 선언
- Gold, Mech, Sand Soldier 토큰 정의와 범용 `playToken`
- 부착 카드 UI와 AI 관측값

그러나 전체 세트를 넣기 전에 다음 기반을 보강해야 합니다.

- 로컬 Core Rules 스냅샷은 `2026-03-30`이지만 공식 Rules Hub의 현재 문서는 `2026-07-16`입니다. 먼저 규칙 스냅샷과 검증 원장을 갱신해야 합니다.
- 공식 갤러리 문구에는 최신 정오표가 모두 반영되지 않습니다. 갤러리 문구를 곧바로 카드 텍스트로 사용하면 안 됩니다.
- Repeat 데이터가 `repeatCostEnergy` 중심이라 Power-only, Energy+Power, 동적으로 부여된 Repeat와 비용 감소를 일반화해야 합니다.
- Equip 비용은 단순 Energy/Power 외에 `Kill a friendly unit`, `Recycle 2 cards from your trash`를 공용 비용 명세로 표현해야 합니다.
- Gold 생성은 여러 timing에서 같은 gear-token 생성 resolver를 사용해야 합니다.
- `When you attach...` 트리거, 임의 Attach/Detach, Equipment의 동적 Quick-Draw 부여를 공용 이벤트/정적 효과로 연결해야 합니다.
- Svellsongur의 인쇄 텍스트 복사처럼 일반 부착 효과보다 규칙상 다른 동작은 마지막 복합 단계에서 처리해야 합니다.

## 공식 소스 계약

카드 파일을 만들기 전에 다음 세 층을 하나의 유효 텍스트로 합칩니다.

1. [공식 카드 갤러리](https://playriftbound.com/en-us/card-gallery/): 번호, 유형, 비용, 인쇄 텍스트, 이미지
2. [공식 Rules Hub](https://playriftbound.com/en-us/rules-hub/): 현재 Core Rules
3. 누적 정오표: [Spiritforged 정오표](https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/), [Unleashed 시점 추가 정오표](https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/), [Vendetta 시점 추가 정오표](https://playriftbound.com/en-us/news/announcements/vendetta-errata-updates/)

각 카드의 수집 데이터에는 다음을 구분해 유지합니다.

- `printedText`: 카드 갤러리/실물 인쇄 문구
- `effectiveText`: 모든 정오표를 적용한 현재 문구
- `sourceUrls`: 갤러리와 적용한 정오표 URL
- `observedAt`: 소스를 확인한 날짜

엔진의 `text`와 `effects`는 `effectiveText`를 기준으로 작성합니다.

## 기믹 의존성

| 기믹 | 선행 기반 | 대표 경계 |
| --- | --- | --- |
| Gold | 범용 gear token, exhausted 입장, Add Power 결제 | 토큰 비용은 0, 보드 이탈 즉시 소멸, 결제 중 Reaction |
| Attach/Detach | 보드 위치, 소유자/조종자, attachment tree | 새 대상에 붙일 때 Detach가 먼저 발생, Top-Most 이탈 시 gear 유지 |
| Equip | Attach, activated ability 비용 명세 | 붙어 있는 동안 Rules Text가 비활성이라 Equip 사용 불가 |
| Quick-Draw | Equip/Attach, Reaction 권한, play-effect 큐 | hand에서 Reaction으로 플레이하며 Equip 비용 없이 부착 |
| Weaponmaster | Equip 비용 읽기, 선택/지불 continuation | 선택적 효과, 붙어 있는 Equipment도 선택, Any Power 1 감소 |
| Repeat | 추가 비용, 플레이 시 선택 선언, effect instruction sequence | 한 번만 지불, 카드 플레이는 한 번, 반복마다 다른 선택 가능 |
| 부착 트리거/복사 | attachment event, Effect Text append, 스냅샷 | 부착 직후 트리거, 인쇄 텍스트만 복사, 효과 인스턴스별 상태 |

## 정형화된 구현 순서

### 0. 인수 점검

다음 명령으로 공식 본세트, 현재 등록 카드, 기믹별 구현률과 Rules 스냅샷 최신성을 확인합니다.

```powershell
npm run audit:set -- --set SFD
npm run audit:set -- --set SFD --json --output tmp/spiritforged-intake.json
```

오버넘버와 `050a` 같은 변형은 본세트 221장 집계에서 제외합니다. 이 단계에서 나온 미등록 목록은 구현 순서가 아니라 인벤토리입니다.

### 1. 효과군 명세

전체 카드의 `effectiveText`를 다음 단위로 묶습니다.

- 기존 `timing:kind`를 그대로 재사용할 카드
- 기존 resolver에 파라미터만 추가하면 되는 카드
- 새 공용 `kind`가 필요한 카드
- 규칙 기반이나 상태 모델 변경이 먼저 필요한 카드

각 효과군에는 구현 기준 카드 하나를 정합니다. 이후 카드 생성 시 `npm run new:card -- --reference ...`를 사용하고, 대량 import의 `implementationReferences`를 유지합니다.

### 2. 상태 기반 완성

카드보다 먼저 다음 공용 계약을 테스트로 고정합니다.

- Attach → 필요하면 기존 대상에서 Detach → 새 Top-Most에 Attach
- Top-Most가 죽거나 손/덱/추방으로 이동할 때 Equipment의 목적지
- Recall처럼 보드 안에서 이동할 때 attachment tree 보존
- Rules Text, Effect Text, Might Bonus의 활성 상태
- Gold/Mech/Sand Soldier의 ready/exhausted 입장과 토큰 소멸
- 비용 명세 `{ energy, power, exhaust, kill, recycleTrash, discard }`
- 선택·지불을 여는 resolver의 continuation 소유권

### 3. Gold 수직 구현

1. `SFD-130/221 Treasure Hunter`: `onMove`에서 exhausted Gold 생성
2. `SFD-074/221 Pickpocket`: 비용 0인 Gold 선택·Kill 가능
3. `SFD-201/221 Chem-Baroness`: Gold의 Add 결과 변경
4. 나머지 Gold 생성 카드를 같은 token resolver에 연결

`onMove` 선택을 여는 효과가 생기면 반드시 `flow: "choice"`, `continuation: "afterMove"`, `ON_MOVE_EFFECT_RESOLVERS` 계약을 사용합니다. 동기 Gold 생성은 별도 카드 분기 없이 `flow: "sync"` 공용 resolver를 사용합니다.

### 4. Equipment 수직 구현

다음 순서로 비용과 상태 경계를 하나씩 넓힙니다.

1. `SFD-161/221 B.F. Sword`: Power-only Equip
2. `SFD-118/221 Boneshiver`: Energy+Power Equip
3. `SFD-178/221 Blade of the Ruined King`: friendly-unit Kill 비용
4. `SFD-150/221 Last Rites`: trash recycle 비용
5. `SFD-011/221 Angle Shot`: 임의 Attach/Detach와 카드 뽑기
6. Effect Text가 있는 Equipment와 부착 상태의 activated/triggered/static 효과

각 Equip 변형은 같은 `activated:equip` resolver와 공용 비용 파서에 데이터만 전달해야 합니다.

### 5. Quick-Draw와 Weaponmaster

1. `SFD-022/221 Long Sword`: Quick-Draw의 Reaction 플레이와 무료 부착
2. `SFD-002/221 Armed Assailant`: 기본 Weaponmaster
3. `SFD-054/221 Jax, Unmatched`: 모든 영역 Equipment에 Quick-Draw 부여
4. `SFD-119/221 Jax, Unrelenting`: attachment event가 여는 선택적 지불/뽑기

Quick-Draw와 Weaponmaster는 카드별 `onPlay` 분기로 만들지 않고 `src/rules/keywords.mjs`의 키워드 play-effect와 공용 resolver를 사용합니다.

### 6. Repeat

Repeat는 `repeatCostEnergy` 단일 필드 대신 일반 추가 비용 명세로 확장합니다.

```js
repeatCost: {
  energy: 1,
  power: [{ domain: DOMAINS.MIND, amount: 1 }]
}
```

검증 순서는 다음과 같습니다.

1. `SFD-034/221 Feral Strength`: Energy-only, 대상 하나
2. `SFD-122/221 Called Shot`: Power-only
3. `SFD-023/221 Piercing Light`: Energy+Power와 복수 instruction
4. `SFD-077/221 Rocket Barrage`: 반복마다 다른 모드/대상
5. `SFD-078/221 Temporal Portal`: 다음 주문에 인쇄 비용과 같은 Repeat 부여
6. `SFD-211/221 Marai Spire`: Repeat 비용 감소

Repeat 비용과 모든 대상/모드는 카드가 체인에 올라가기 전에 확정합니다. 해결 중에는 저장된 instruction sequence를 한 번 더 실행하며, spell-play 트리거는 한 번만 발생해야 합니다.

### 7. FAQ와 복합 카드

공용 기믹이 모두 안정된 뒤 다음 경계를 처리합니다.

- `SFD-020/221 Draven, Vanquisher`: combat win 이벤트와 Gold
- `SFD-059/221 Svellsongur`: 인쇄 텍스트 복사와 Effect Text
- `SFD-202/221 Hostile Takeover`: 조종권 변경 후 noncombat showdown
- `SFD-060/221 Tianna Crownguard`: battlefield score와 point gain 구분
- `SFD-116/221 Yone, Blademaster`: 정오표의 “was uncontrolled” 스냅샷
- 0 이하 Might, 토큰 비용 0, 토큰 recycle 후 소멸 경계

### 8. 효과군별 import

한 번에 221장을 등록하지 않습니다. 다음 묶음마다 dry-run, 집중 테스트, 전체 검증을 완료합니다.

1. 기존 resolver만 재사용하는 카드
2. Gold/Mech/Sand Soldier 토큰군
3. 단순 Equipment
4. Quick-Draw/Weaponmaster
5. Repeat
6. 부착 트리거와 복합 비용
7. FAQ/정오표 복합 카드
8. Legends와 Battlefields를 포함한 실제 덱 시나리오

```powershell
npm run import:cards -- --input data/cards/spiritforged-wave-01.json --dry-run
npm run import:cards -- --input data/cards/spiritforged-wave-01.json
npm run audit:effects -- --output tmp/spiritforged-wave-01-effects.json
npm run check:no-ai
```

## 효과군 완료 조건

각 효과군은 다음 조건을 모두 만족해야 다음 묶음으로 넘어갑니다.

- [ ] `effectiveText`와 `effects`가 1:1로 대응합니다.
- [ ] 새 `kind`라면 registry, 공용 resolver, 검증, 집중 테스트가 함께 있습니다.
- [ ] 대상과 선택은 플레이/발동 시점에 선언되고 해결 시점에 다시 적법성을 확인합니다.
- [ ] 비용 실패·선택 거절·대상 이탈 시 continuation이 한 번만 이어집니다.
- [ ] interactive와 non-interactive 실행 결과가 같습니다.
- [ ] 부착/토큰/결제 상태가 UI, snapshot, AI observation에 노출됩니다.
- [ ] 같은 효과를 쓰는 모든 카드가 `implementationReferences`를 가집니다.
- [ ] `npm run check:no-ai`가 통과합니다. 이 명령은 AI 학습·신경망·AI 의사결정 검증을 제외합니다.

## 세트 완료 조건

- 본세트 `SFD-001/221`부터 `SFD-221/221`까지 정확히 221장이 등록됨
- 오버넘버/대체 아트는 별도 카드 데이터가 필요한 경우에만 명시적으로 등록됨
- 누적 정오표가 모두 `effectiveText`에 반영됨
- 모든 기믹군에 최소 1개의 대표 정상·거절·불법·대상 이탈·연쇄 상호작용 테스트가 있음
- Spiritforged-era 덱으로 고정 시드 퍼즈와 생성 시나리오가 통과함
- 최종 `npm run audit:set -- --set SFD`가 221/221을 보고하고 `npm run check:no-ai`가 통과함
