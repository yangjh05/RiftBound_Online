import argparse
import json
import re
from pathlib import Path

from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    M2M100ForConditionalGeneration,
    M2M100Tokenizer,
)


ROOT = Path(__file__).resolve().parent.parent
MODEL = "facebook/nllb-200-distilled-600M"

DOMAIN_KO = {
    "Body": "신체",
    "Calm": "평정",
    "Chaos": "혼돈",
    "Fury": "격노",
    "Mind": "정신",
    "Order": "질서",
}

TAG_KO = {
    "Akshan": "아크샨", "Aphelios": "아펠리오스", "Ashe": "애쉬", "Azir": "아지르",
    "Bandle City": "밴들 시티", "Bard": "바드", "Bilgewater": "빌지워터", "Bird": "새",
    "Cat": "고양이", "Demacia": "데마시아", "Demon": "악마", "Diana": "다이애나", "Dog": "개",
    "Dragon": "용", "Draven": "드레이븐", "Elite": "정예", "Equipment": "장비",
    "Evelynn": "이블린", "Ezreal": "이즈리얼", "Fae": "요정", "Fiora": "피오라", "Fizz": "피즈",
    "Freljord": "프렐요드", "Galio": "갈리오", "Hwei": "흐웨이", "Icathia": "이케시아",
    "Ionia": "아이오니아", "Irelia": "이렐리아", "Ivern": "아이번", "Ixtal": "이쉬탈",
    "Janna": "잔나", "Jax": "잭스", "Jayce": "제이스", "Jhin": "진", "Katarina": "카타리나",
    "Kathkan": "카트칸", "Kha'Zix": "카직스", "LeBlanc": "르블랑", "Lillia": "릴리아",
    "Lucian": "루시안", "Master Yi": "마스터 이", "Mech": "기계", "Mount Targon": "타곤 산",
    "Nami": "나미", "Nidalee": "니달리", "Nilah": "닐라", "Noxus": "녹서스", "Ornn": "오른",
    "Piltover": "필트오버", "Pirate": "해적", "Poppy": "뽀삐", "Poro": "포로", "Pyke": "파이크",
    "Rek'Sai": "렉사이", "Rell": "렐", "Renata Glasc": "레나타 글라스크", "Rengar": "렝가",
    "Rumble": "럼블", "Sentinel": "감시자", "Shadow Isles": "그림자 군도", "Shurima": "슈리마",
    "Sivir": "시비르", "Soraka": "소라카", "Spider": "거미", "Spirit": "영혼", "Syndra": "신드라",
    "The Void": "공허", "Trifarian": "트리파르", "Vex": "벡스", "Vi": "바이", "Xerath": "제라스",
    "Xin Zhao": "신 짜오", "Yone": "요네", "Yordle": "요들", "Yuumi": "유미", "Zaun": "자운",
    "Zilean": "질리언",
}

PROTECTED = [
    ("Beginning Phase", "시작 단계"), ("Main Phase", "행동 단계"), ("Main Deck", "주 덱"),
    ("Rune Deck", "룬 덱"), ("Victory Score", "승리 점수"), ("Sand Soldier", "모래 병사"),
    ("Gold gear token", "골드 도구 토큰"), ("Reflection unit token", "분신 유닛 토큰"),
    ("Recruit unit token", "신병 유닛 토큰"), ("Sprite unit token", "요정 유닛 토큰"),
    ("Bird unit token", "새 유닛 토큰"), ("Mech unit token", "기계 유닛 토큰"),
    ("friendly unit", "아군 유닛"), ("friendly units", "아군 유닛들"),
    ("enemy unit", "적 유닛"), ("enemy units", "적 유닛들"),
    ("friendly gear", "아군 도구"), ("enemy gear", "적 도구"),
    ("Bonus Damage", "추가 피해"), ("Energy cost", "에너지 비용"), ("Power cost", "힘 비용"),
    ("additional cost", "추가 비용"), ("battlefields", "전장들"), ("battlefield", "전장"),
    ("Equipment", "장비"), ("controller", "조종자"), ("opponent", "상대"),
    ("Might", "위력"), ("Power", "힘"), ("Energy", "에너지"), ("XP", "XP"),
    ("showdowns", "결전들"), ("showdown", "결전"), ("unit", "유닛"), ("spell", "주문"),
    ("gear", "도구"), ("token", "토큰"), ("runes", "룬들"), ("rune", "룬"),
    ("trash", "폐기장"), ("hand", "손"), ("base", "기지"), ("turn", "턴"),
    ("cards", "카드들"), ("card", "카드"), ("damage", "피해"), ("cost", "비용"),
    ("owner", "소유자"), ("Gold", "골드"), ("Mech", "기계"), ("Sprite", "요정"),
    ("Bird", "새"), ("Cat", "고양이"), ("Dog", "개"), ("Poro", "포로"),
    ("Reflection", "분신"), ("Recruit", "신병"),
]

KEYWORD_KO = {
    "Accelerate": "가속", "Action": "행동", "Ambush": "기습", "Assault": "맹공",
    "Backline": "후방", "Deathknell": "죽음의 종소리", "Deflect": "굴절", "Equip": "장착",
    "Ganking": "개입", "Hidden": "숨겨짐", "Hunt": "추적", "Quick-Draw": "속사",
    "Reaction": "반응", "Repeat": "반복", "Shield": "보호막", "Tank": "탱커",
    "Temporary": "일시적", "Unique": "고유", "Vision": "통찰", "Weaponmaster": "무기의 달인",
    "Predict": "예측", "Level": "레벨", "Buff": "버프", "Stun": "기절", "Add": "추가",
    "Mighty": "강력", "Empower": "강화", "Empowered": "강화됨", "Flow": "흐름",
    "Disempower": "강화 해제", "Burn Out": "소진", "Burn": "소각", "Skip": "건너뛰기",
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--names", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--model", default=MODEL)
    return parser.parse_args()


def protect(text):
    replacements = []
    value = text
    for index, (english, korean) in enumerate(sorted(PROTECTED, key=lambda item: -len(item[0]))):
        token = f"ZTERM{index}Z"
        pattern = re.compile(rf"\b{re.escape(english)}\b", re.IGNORECASE)
        if pattern.search(value):
            value = pattern.sub(token, value)
            replacements.append((token, korean))
    for keyword, korean in KEYWORD_KO.items():
        token = f"ZKEY{len(replacements)}Z"
        pattern = re.compile(rf"\[{re.escape(keyword)}(?P<count>\s+\d+)?\]", re.IGNORECASE)
        while True:
            match = pattern.search(value)
            if not match:
                break
            translated = f"[{korean}{match.group('count') or ''}]"
            value = value[:match.start()] + token + value[match.end():]
            replacements.append((token, translated))
    return value, replacements


def restore(text, replacements):
    value = text
    for token, korean in replacements:
        value = value.replace(token, korean).replace(token.lower(), korean)
    return normalize(value)


def normalize(text):
    value = str(text)
    replacements = [
        (r"이 회전", "이번 턴"), (r"그 회전", "그 턴"), (r"회전이 끝날 때까지", "턴이 끝날 때까지"),
        (r"플레이합니다", "사용합니다"), (r"플레이할", "사용할"), (r"플레이 한", "사용한"),
        (r"연주합니다", "사용합니다"), (r"연주할", "사용할"), (r"연주한", "사용한"),
        (r"그립니다", "뽑습니다"), (r"그리기", "뽑기"), (r"그려", "뽑아"),
        (r"준비하십시오", "준비시킵니다"), (r"죽이십시오", "처치합니다"), (r"죽입니다", "처치합니다"),
        (r"활용합니다", "재활용합니다"), (r"추방하십시오", "추방합니다"),
        (r"공식 번역 미확인", "비공식 번역"), (r"\s+([,.])", r"\1"),
        (r"\s+\.", "."), (r"\.\.", "."), (r"\s{2,}", " "),
    ]
    for pattern, replacement in replacements:
        value = re.sub(pattern, replacement, value, flags=re.IGNORECASE)
    return value.strip()


def exact_line(line):
    stripped = line.strip()
    if stripped == "[Reaction] (Play any time, even before spells and abilities resolve.)":
        return "[반응] (주문 및 스킬이 처리되기 전을 포함해 시점에 관계없이 사용합니다.)"
    if stripped == "[Action] (Play on your turn or in showdowns.)":
        return "[행동] (내 턴 또는 결전 시 사용합니다.)"
    if re.fullmatch(r"\[Hidden\] \(Hide now for (?:Power|\[A\]) to react with later for (?:Energy )?(?:0|\[0\]) ?\.\)", stripped):
        return "[숨겨짐] (지금 힘을 지불해 뒷면으로 숨기고, 나중에 에너지 0으로 반응할 수 있습니다.)"
    if stripped == "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)":
        return "[기습] (자신의 유닛이 있는 전장에 [반응]으로 이 카드를 사용할 수 있습니다.)"
    accelerate = re.fullmatch(r"\[Accelerate\] \(You may pay Energy 1 (Body|Calm|Chaos|Fury|Mind|Order) Power as an additional cost to have me enter ready\.\)", stripped)
    if accelerate:
        return f"[가속] (추가 비용으로 에너지 1과 {DOMAIN_KO[accelerate.group(1)]} 힘 1을 지불하면 이 카드가 준비 상태로 진입합니다.)"
    assault = re.fullmatch(r"\[Assault(?: (\d+))?\] \(\+(\d+) Might while I'm an attacker\.\)", stripped)
    if assault:
        amount = assault.group(1) or assault.group(2)
        return f"[맹공 {amount}] (이 카드가 공격자인 동안 위력 +{amount}을 얻습니다.)"
    shield = re.fullmatch(r"\[Shield(?: (\d+))?\] \(\+(\d+) Might while I'm a defender\.\)", stripped)
    if shield:
        amount = shield.group(1) or shield.group(2)
        return f"[보호막 {amount}] (이 카드가 방어자인 동안 위력 +{amount}을 얻습니다.)"
    hunt = re.fullmatch(r"\[Hunt(?: (\d+))?\] \(When I conquer or hold, gain (\d+) XP\.\)", stripped)
    if hunt:
        amount = hunt.group(1) or hunt.group(2)
        return f"[추적 {amount}] (이 카드가 정복하거나 점거하면 XP {amount}을 획득합니다.)"
    if stripped == "[Tank] (I must be assigned combat damage first.)":
        return "[탱커] (이 카드는 전투 피해를 가장 먼저 배정받습니다.)"
    if stripped == "[Backline] (I must be assigned combat damage last.)":
        return "[후방] (전투 피해는 이 카드에 마지막으로 배정해야 합니다.)"
    if stripped == "[Ganking] (I can move from battlefield to battlefield.)" or stripped == "Ganking (I can move from battlefield to battlefield.)":
        return "[개입] (이 카드는 전장에서 전장으로 이동할 수 있습니다.)"
    deflect = re.fullmatch(r"\[Deflect(?: (\d+))?\] \(Opponents must pay (?:Power ?)+to choose me with a spell or (?:a|A)bility\.\)", stripped)
    if deflect:
        amount = deflect.group(1) or str(max(1, stripped.count("Power")))
        return f"[굴절 {amount}] (상대가 주문이나 스킬로 이 카드를 선택하려면 힘 {amount}을 지불해야 합니다.)"
    if stripped == "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)":
        return "[일시적] (조종자의 시작 단계가 시작될 때, 득점 전에 이 카드를 처치합니다.)"
    if stripped == "[Unique] (Your deck can have only 1 card with this name.)":
        return "[고유] (덱에 같은 이름의 카드를 1장만 넣을 수 있습니다.)"
    if stripped == "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)":
        return "[통찰] (이 카드를 사용하면, 내 주 덱 맨 위 카드를 확인합니다. 해당 카드를 재활용할 수 있습니다.)"
    if stripped == "I enter ready.":
        return "이 카드는 준비 상태로 진입합니다."
    if stripped == "Draw 1.":
        return "카드 1장을 뽑습니다."
    return None


def translate_lines(lines, batch_size, model_name):
    exact = {}
    pending = []
    protected = {}
    for line in lines:
        translated = exact_line(line)
        if translated is not None:
            exact[line] = translated
            continue
        prepared, replacements = protect(line)
        pending.append((line, prepared))
        protected[line] = replacements

    is_m2m = "m2m100" in model_name.lower()
    if is_m2m:
        tokenizer = M2M100Tokenizer.from_pretrained(model_name)
        model = M2M100ForConditionalGeneration.from_pretrained(model_name).float()
        tokenizer.src_lang = "en"
        target_language_id = tokenizer.get_lang_id("ko")
    else:
        tokenizer = AutoTokenizer.from_pretrained(model_name, src_lang="eng_Latn")
        model = AutoModelForSeq2SeqLM.from_pretrained(model_name).float()
        target_language_id = tokenizer.convert_tokens_to_ids("kor_Hang")
    result = dict(exact)
    for start in range(0, len(pending), batch_size):
        batch = pending[start:start + batch_size]
        inputs = tokenizer([entry[1] for entry in batch], return_tensors="pt", padding=True, truncation=True)
        generated = model.generate(
            **inputs,
            forced_bos_token_id=target_language_id,
            max_length=256,
            num_beams=1,
        )
        translations = tokenizer.batch_decode(generated, skip_special_tokens=True)
        for (original, _), translated in zip(batch, translations):
            result[original] = restore(translated, protected[original])
        print(f"translated {min(start + batch_size, len(pending))}/{len(pending)}")
    return result


def translate_type_line(card):
    card_type = {
        "unit": "챔피언 유닛" if card.get("isChampion") else "유닛",
        "spell": "주문", "gear": "도구", "legend": "전설", "battlefield": "전장",
    }.get(card.get("type"), "카드")
    return ", ".join([card_type, *[TAG_KO.get(tag, tag) for tag in card.get("tags", [])]])


def translate_header(card, ko_name):
    parts = [f"[{ko_name}]"]
    if card.get("energy"):
        parts.append(f"{card['energy']} 에너지")
    for cost in card.get("power", []):
        domains = card.get("domains", []) if cost.get("domain") == "Any" else [cost.get("domain")]
        label = "/".join(DOMAIN_KO.get(domain, "범용") for domain in domains)
        parts.append(f"{cost.get('amount', 0)} {label} 힘")
    if card.get("might") is not None:
        parts.append(f"{card['might']} 위력")
    return ", ".join(parts)


def main():
    args = parse_args()
    source = json.loads((ROOT / args.source).read_text(encoding="utf-8"))
    names = json.loads((ROOT / args.names).read_text(encoding="utf-8"))
    cards = source["cards"]
    missing_names = [card["cardNumber"] for card in cards if card["cardNumber"] not in names]
    if missing_names:
        raise RuntimeError(f"Missing Korean names: {', '.join(missing_names)}")
    all_lines = []
    for card in cards:
        text = "\n".join(filter(None, [card.get("effectiveText"), card.get("effectText")]))
        all_lines.extend(line.strip() for line in text.splitlines() if line.strip())
    translations = translate_lines(list(dict.fromkeys(all_lines)), args.batch_size, args.model)
    output = {
        "schemaVersion": 1,
        "set": source["set"],
        "sourceObservedAt": source.get("observedAt"),
        "translationStatus": "unofficial",
        "cards": {},
    }
    for card in cards:
        ko_name = names[card["cardNumber"]]
        text = "\n".join(filter(None, [card.get("effectiveText"), card.get("effectText")]))
        ko_text = "\n".join(translations[line.strip()] for line in text.splitlines() if line.strip())
        output["cards"][card["cardNumber"]] = {
            "collectorNumber": card["cardNumber"],
            "englishName": card["name"],
            "koName": ko_name,
            "koHeader": translate_header(card, ko_name),
            "koTypeLine": translate_type_line(card),
            "koText": f"비공식 번역\n{ko_text}" if ko_text else "비공식 번역\n규칙 문구 없음",
        }
    output_path = ROOT / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(cards)} translations to {output_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
