# Riftbound Online 작업 지침

- 사용자에게는 항상 존댓말을 사용합니다.
- 비슷한 카드 효과는 기존 카드의 `timing:kind`와 공용 resolver를 재사용합니다.
- 카드 이름을 검사하는 개별 분기로 공통 효과를 구현하지 않습니다. 같은 효과의 수정은 공용 resolver 한 곳에서 모든 카드에 적용되어야 합니다.
- 기존 효과와 규칙상 다른 동작만 새로운 effect `kind`로 등록합니다. 새 `kind`는 레지스트리, 공용 resolver 테이블, 검증 및 집중 테스트를 함께 추가합니다.
- 새 카드는 가능하면 `npm run new:card -- --reference ...`를 사용하고, 대량 import 시 자동 생성되는 `implementationReferences`를 유지합니다.
- 선택, 지불, 반응 체인 또는 트리거 큐를 여는 resolver는 원래 처리의 continuation을 명시적으로 소유하고 다음 단계로 전달해야 합니다.
- 이동 중 선택을 여는 `onMove` 효과는 `flow: "choice"`, `continuation: "afterMove"` 계약과 `ON_MOVE_EFFECT_RESOLVERS`의 공용 resolver를 반드시 사용합니다.
- 카드 추가나 효과 변경 후에는 `npm run check`를 실행합니다. 이 명령에는 정적 카드/엔진 검증, 회귀 테스트, 상호작용 조합, 고정 시드 퍼즈 및 생성 시나리오가 포함됩니다.
