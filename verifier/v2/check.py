#!/usr/bin/env python3
"""Verifier v2: v1 + требование темпа 15–25 заездов на мир/уровень."""
import re, sys, json, datetime, pathlib

PROMPT = pathlib.Path("/mnt/agents/output/Промт_доработки_SNOW_RUSH_3D.md")
text = PROMPT.read_text(encoding="utf-8")
low = text.lower()
words = len(re.findall(r"\w+", text))

# (id, описание, [маркеры — хотя бы один из каждой группы обязателен])
checks = [
    ("p1_research", "исследования/скиллы/плейтесты", [["исслед"], ["скилл"], ["плейтест"]]),
    ("p2_ui", "UI-аудит + фейковый переключатель графики", [["ui", "интерфейс"], ["переключен", "переключатель"], ["график"]]),
    ("p3_economy", "экономика по исследованиям", [["экономи"], ["f2p", "retention", "монетизац", "крив"]]),
    ("p4_models", "3D-модели детальнее", [["модел"], ["полигон", "детал"]]),
    ("p5_anim", "анимации: полёт/ветер/нитро", [["анимац"], ["полёт", "полет"], ["нитро", "nitro", "буст"]]),
    ("p6_five_maps", "минимум 5 карт", [["5 карт", "пять карт", "5 уровн", "пять уровн"]]),
    ("p7_world_fix", "висячие элементы/невидимые камни", [["висяч", "висят", "в воздухе"], ["невидим"]]),
    ("p8_penguin", "разворот пингвина", [["пингвин"], ["лицом"], ["спиной", "разворот"]]),
    ("p9_launch", "кривой запуск с рогатки", [["запуск"], ["рогатк"]]),
    ("p10_upgrade_visual", "визуальная эволюция при апгрейде", [["апгрейд"], ["визуальн"], ["тир", "уров", "скин"]]),
    ("p11_action", "динамика/экшен", [["динамич", "экшен", "action"], ["скорост"]]),
    ("p12_tracks", "карты: спуски/подъёмы/повороты", [["спуск"], ["подъём", "подъем"], ["поворот"]]),
    ("p13_selfqa", "самостоятельный поиск багов", [["баг"], ["плейтест", "бот"]]),
    ("p14_own", "собственные улучшения каждого пункта", [["сам", "свои", "собственн"], ["улучшен"]]),
    ("workflow", "воркфлоу: plan.md + этапы", [["plan.md", "план"], ["этап"]]),
    ("dod", "критерии приёмки (DoD)", [["критери", "definition of done", "приёмк", "приемк"]]),
    ("context", "контекст проекта (пути/ветки)", [["/mnt/agents/output/app", "master", "ветк"]]),
    ("length", "объём ≥ 600 слов", []),
    ("p15_pace", "мир/уровень проходится минимум за 15–25 заездов", [["15–25", "15-25"], ["заезд"], ["минимум", "не раньше", "не меньше"]]),
]

results, ok_all = [], True
for cid, desc, groups in checks:
    if cid == "length":
        ok = words >= 600
        detail = f"words={words}"
    else:
        missing = [g for g in groups if not any(m in low for m in g)]
        ok = not missing
        detail = "ok" if ok else f"missing groups: {missing}"
    results.append({"id": cid, "desc": desc, "pass": ok, "detail": detail})
    ok_all &= ok

report = {
    "ts": datetime.datetime.now().isoformat(timespec="seconds"),
    "file": str(PROMPT), "words": words, "all_pass": ok_all, "checks": results,
}
print(json.dumps(report, ensure_ascii=False, indent=2))
run = pathlib.Path("/mnt/agents/output/verifier/runs") / f"run-{report['ts'].replace(':','-')}.json"
run.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
sys.exit(0 if ok_all else 1)
