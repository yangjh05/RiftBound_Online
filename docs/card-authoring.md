# 카드 추가 가이드

이 문서는 Riftbound 카드를 새로 추가할 때 따라야 하는 기준입니다.
목표는 카드 데이터, 효과 구현, UI 선택, 테스트가 서로 어긋나지 않게 만드는 것입니다.

## 1. 카드 파일 생성

카드는 항상 `src/cards/<lowerCamelCase>.mjs` 파일 하나로 관리합니다.
한두 장만 추가할 때는 `new:card`를 쓰고, 여러 장을 한꺼번에 추가할 때는 [bulk-card-import.md](bulk-card-import.md)의 `import:cards` 파이프라인을 사용합니다.

```powershell
npm run new:card -- --name "Example Spell" --number "OGN-001/298" --type spell --set Origins --rarity Common --domain Calm --energy 1 --power Any:1 --image "https://..." --text "Exact card text" --timing spell --kind moveUnit
```

생성기는 다음 작업을 자동으로 수행합니다.

- `src/cards/<key>.mjs` 생성
- `src/cards.mjs` import 추가
- `cards` registry에 key 추가

생성 후에는 반드시 아래 명령을 실행합니다.

```powershell
npm run check
```

## 2. 필수 데이터

모든 실제 카드는 다음 필드를 가져야 합니다.

- `id`: 카드 번호 앞부분. 예: `OGN-043`
- `collectorNumber`: 실제 오프라인 카드 번호. 예: `OGN-043/298`
- `cardNumber`: 내부 유니크 카드 번호. 보통 `collectorNumber`와 같습니다.
- `name`: 실제 카드명
- `type`: `unit`, `spell`, `gear`, `battlefield`, `legend`, `rune`
- `set`: 실제 세트명
- `rarity`: 실제 레어도
- `domains`: `DOMAINS.CALM` 같은 도메인 배열
- `tags`: subtype, `Reaction`, `Action`, `Equipment` 등
- `keywords`: `Hidden`, `Ambush`, `Deflect` 같은 키워드
- `power`: `{ domain: DOMAINS.ANY, amount: 1 }` 형태
- `image`: 카드 일러스트 URL. 룬이 아닌 카드는 반드시 필요합니다.
- `text`: 실제 카드 텍스트 원문
- `effects`: 엔진이 처리할 효과 명세 배열

추가 기준:

- `unit`, `spell`, `gear`는 `energy`가 필요합니다.
- `unit`은 `might`가 필요합니다. 0 Might도 숫자 `0`으로 명시합니다.
- `battlefield`, `legend`는 보통 `energy`를 쓰지 않습니다.
- 덱리스트는 카드 이름이 아니라 `cardNumber`/`collectorNumber`를 사용합니다.

## 3. 효과 명세 기준

`effects`는 카드 텍스트와 엔진 구현 사이의 계약입니다.

```js
effects: [
  {
    timing: "spell",
    kind: "moveUnit",
    target: "enemyUnit"
  }
]
```

원칙:

- 실제 텍스트에 없는 임시 효과를 넣지 않습니다.
- `gain 1 point` 같은 placeholder 효과는 금지합니다.
- 대상 지정이 필요한 효과는 체인에 올릴 때 target/choice 정보를 확정할 수 있어야 합니다.
- `may` 효과도 체인에 올릴 때 사용 여부와 legal target을 정합니다.
- Move 효과는 이동할 카드와 목적지를 발동 시점에 정합니다.
- 해결 시점에는 선언된 대상이 여전히 legal target인지 재검증합니다.

새 `timing:kind` 조합이 필요하면 먼저 다음을 추가합니다.

1. `src/effects/registry.mjs`에 timing/kind, source type, target provider를 등록합니다.
2. `src/engine.mjs`의 적절한 resolver map에 실제 처리를 추가합니다.
3. 대상 선택이 필요하면 발동 시점 target declaration 또는 choice resolver를 추가합니다.
4. 테스트를 추가합니다.
5. `npm run check`를 통과시킵니다.

## 4. 현재 지원되는 timing

- `activated`
- `attackOrDefend`
- `battlefieldControl`
- `combatStatic`
- `conquerHere`
- `death`
- `defendHere`
- `firstBeginning`
- `hold`
- `keyword`
- `levelStatic`
- `onMove`
- `onPlay`
- `opponentPlaysUnit`
- `replacement`
- `score`
- `secondDrawEachTurn`
- `showdownBeginsHere`
- `spell`
- `spellPlayed`
- `static`

## 5. 덱 규칙

덱 구성 규칙은 `src/decks/rules.mjs`가 기준입니다.

- 메인 덱: 최소 40장
- 룬 덱: 정확히 12장
- 전장: 정확히 3장
- 동일 카드: 메인 덱에 카드 번호 기준 최대 3장
- 시작 챔피언 선택을 위해 메인 덱 안에 챔피언 카드가 최소 1종 있어야 합니다.

덱 편집 UI와 검증 스크립트는 같은 규칙 모듈을 사용합니다.

## 6. 테스트 기준

새 카드를 추가하면 최소한 해당되는 테스트를 추가합니다.

- 플레이 가능 조건: 코스트, 타이밍, 대상 범위
- 발동 시점: 대상과 목적지가 해결 시점이 아니라 발동 시점에 확정되는지
- 해결 시점: 대상이 불법이 되면 올바르게 실패하거나 가능한 부분만 처리하는지
- 쇼다운 카드: Focus, Reaction 가능 여부, 체인 처리
- `may`: 선택/거절이 모두 정상 처리되는지
- 추가 비용: 유저가 직접 지불할 수 있는지
- UI: 선택지가 카드 이미지와 효과 설명을 보여주는지

## 7. 검증 명령

```powershell
npm run validate:cards
npm run validate:engine
npm test
```

일반적으로는 아래 한 줄이면 됩니다.

```powershell
npm run check
```

`validate:cards`는 카드 데이터, 카드 번호, 덱리스트, 효과 registry 등록을 검증합니다.
`validate:engine`은 registry에 등록된 주요 효과가 실제 resolver에 연결되어 있는지 검증합니다.

## 8. 새 카드 추가 체크리스트

- [ ] 공식 텍스트와 카드 번호를 확인했습니다.
- [ ] 카드 이미지를 등록했습니다.
- [ ] `npm run new:card`로 파일을 만들었습니다.
- [ ] `effects`가 실제 텍스트와 1:1로 대응합니다.
- [ ] 새 effect kind가 필요하면 registry, resolver, choice UI, 테스트를 먼저 추가했습니다.
- [ ] `npm run check`가 통과합니다.
- [ ] 게임 화면에서 비용 지불, 대상 지정, 해결 UI를 확인했습니다.
