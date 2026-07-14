# 대량 카드 Import 가이드

대량 카드 추가는 외부 카드 DB를 이 프로젝트의 표준 JSON으로 변환한 뒤 `npm run import:cards`로 넣습니다.

## 권장 소스 우선순위

1. Riot 공식 API/자산
2. Piltover Archive 같은 카드 DB를 공식 데이터와 대조한 export
3. Scrydex 같은 API 결과를 공식 텍스트/번호와 대조한 export

Riot 정책상 카드 텍스트와 자산은 공식 API에서 제공되는 값을 우선해야 합니다.

## 표준 JSON

```json
{
  "cards": [
    {
      "id": "OGN-043",
      "collectorNumber": "OGN-043/298",
      "cardNumber": "OGN-043/298",
      "name": "Charm",
      "type": "spell",
      "set": "Origins",
      "rarity": "Common",
      "domains": ["Calm"],
      "tags": [],
      "keywords": [],
      "energy": 1,
      "power": [],
      "might": null,
      "isChampion": false,
      "image": "https://...",
      "text": "Move an enemy unit.",
      "effects": [
        {
          "timing": "spell",
          "kind": "moveUnit",
          "target": "enemyUnit"
        }
      ]
    }
  ]
}
```

필드 기준:

- `collectorNumber`: 실제 오프라인 카드 번호입니다.
- `cardNumber`: 내부 유니크 키입니다. 같은 효과/이름이어도 일러스트나 번호가 다르면 다른 카드로 취급합니다.
- `type`: `unit`, `spell`, `gear`, `battlefield`, `legend`, `rune`
- `domains`: `Body`, `Calm`, `Chaos`, `Fury`, `Mind`, `Order`, `Any`
- `power`: 배열 또는 `"Calm:1,Any:1"` 문자열을 사용할 수 있습니다.
- `effects`: registry에 등록된 effect spec이어야 합니다. 미구현 효과는 기본적으로 import가 실패합니다.

## 명령

현재 카드 데이터를 표준 JSON으로 export:

```powershell
npm run export:cards -- --output tmp/card-export.json
```

import 전 dry-run:

```powershell
npm run import:cards -- --input data/cards.json --dry-run
```

새 카드만 추가:

```powershell
npm run import:cards -- --input data/cards.json
```

기존 카드도 갱신:

```powershell
npm run import:cards -- --input data/cards.json --update-existing
```

효과 분류 리포트 생성:

```powershell
npm run audit:effects -- --output tmp/effect-audit.json
```

최종 검증:

```powershell
npm run check
```

## Import 순서

1. 외부 DB를 표준 JSON으로 변환합니다.
2. `npm run import:cards -- --input ... --dry-run`으로 생성/갱신/스킵 목록을 확인합니다.
3. 미지원 effect 오류가 있으면 `src/effects/registry.mjs`와 `src/engine.mjs`에 효과를 먼저 구현합니다.
4. import를 실행합니다.
5. `npm run audit:effects -- --output tmp/effect-audit.json`으로 효과군을 확인합니다.
6. `npm run check`를 통과시킵니다.
