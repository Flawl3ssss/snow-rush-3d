# SNOW RUSH 3D — Подробный план оставшихся работ

Дата: 2026-08-08. Ветка: master. Последний коммит: `9b957de` (W2+W3-физика).
Рабочая директория: `/mnt/agents/output/app`. Игра: Three.js 0.180 + TypeScript + Vite, React-оболочка.

---

## 0. ЧТО УЖЕ СДЕЛАНО (для контекста)

| Волна | Содержание | Статус |
|---|---|---|
| Исследование | 3 субагента: game feel (Juice it or Lose it, GMTK), трассы санных игр, рендер-стек Three.js. Спек: `QUALITY_OVERHAUL.md` | ✅ |
| Видео-аудит №1 | Записи геймплея, разбор по кадрам (ffmpeg), список недочётов | ✅ |
| Wave A | 21 реальная GLB-модель с poly.pizza (CC0/CC-BY) вместо процедурных «болванок»: пингвин, тюб, рогатка, ели, камни, снеговик, иглу, флажки, монета, самоцвет, кристалл, факел, айсберг, ракета, сундук, домик. CREDITS.md + титры в настройках | ✅ коммит `4b46533` |
| W2 трасса | Секции наклона tech/cruise/burst (90–160 м, smoothstep-blend), двухчастотные роллеры (2.6м/72м + 1.5м/43м), двухгармонические кривые, виражи до 11°, стены по wallMul биома, скала только на крутых гранях (slope-gated цвет), трамплинные точки + баллистические дуги монет | ✅ коммит `9b957de` |
| W3 физика | Crest-launch на гребнях (Δθ≥6°), качество приземления (угол полёта vs уклон: land_clean +5%, land_hard −18%), near-miss +2%, кривая руления \|steer\|^1.25 × speed authority | ✅ коммит `9b957de` |
| W3 сцена крэша | Hit-stop 90мс → slow-mo 0.25 (700мс) → tumble 2–4с ∝ скорости; взрыв снега ∝ силе; синтезированный бас-вумп (WebAudio, 130→42 Гц) | ⚠️ код готов, НЕ закоммичен, не проверен визуально |
| W5 камера | Крен ∝ vx (±8°), look-ahead ∝ v (до −14м), FOV-кик до ~70–75°, air-режим (демпфинг↓) | ⚠️ ПОЛОВИНА кода внесена, требует завершения (см. §1) |

Легенда инструментов далее по тексту:
- **PW** = Playwright (headless Chromium, `/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs`, флаги `--enable-unsafe-swiftshader --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`)
- **FF** = ffmpeg (нарезка кадров из .webm: `ffmpeg -ss {t} -i x.webm -frames:v 1 out.png`)
- **PIL** = Python Pillow (попиксельные сравнения RGB-замеров, склейки до/после)
- **VAL** = валидаторы `npx tsx scripts/validate-world.ts` (посадка 2087+ объектов) и `npx tsx scripts/smoke-run.ts` (симуляция заезда: 501м, crashFree)
- **BUILD** = FUSE-безопасная сборка: `vite build --outDir /tmp/dist-X` → `rm -rf dist && cp -r` → sleep 2 → diff списков файлов → докопировать недостающие по `comm -23` → повтор до 0 missing
- **SRV** = статик-сервер `python3 -m http.server 5188` из `app/dist` (умирает между длинными операциями — перезапускать, проверять `curl -o /dev/null -w "%{http_code}"`)
- **HOOKS** = `window.__THREE_GAME_TEST_HOOKS__` {setState, getState, startRun(power), setReducedMotion, seed} + инъекция сейва version:3 через `page.addInitScript`
- В headless игровое время идёт ~в 10 раз медленнее реального → длинные заезды только фоном (`nohup node script.mjs &`), кадры — из видео через FF

---

## 1. НЕМЕДЛЕННОЕ: завершить W5 (камера) — ~15 правок

Уже внесено: поля `speedFovSm/roll/rollTarget` в CameraRig, run-ветка с look-ahead ∝ v, air-демпфингом и rollTarget. **Осталось:**

1. **CameraRig.update — сигнатура**: добавить параметр `airborne: boolean` (после heading). Сейчас run-ветка использует `airborne`, которого нет в сигнатуре → tsc упадёт.
2. **CameraRig — FOV-секция** (внизу update): заменить мгновенный `speedFov` на демпфированный:
   ```ts
   const speedFovTarget = this.mode === 'run'
     ? clamp((speed - CAMERA.fovSpeedStart) * CAMERA.fovSpeedMul, 0, CAMERA.fovSpeedMax)
       + (airborne ? CAMERA.airFovBonus : 0) : 0;
   this.speedFovSm = lerp(this.speedFovSm, speedFovTarget, damp(CAMERA.fovSpeedDamp, delta));
   this.camera.fov = this.baseFov + this.speedFovSm + this.fovPunch + finishFov;
   ```
3. **CameraRig — применение крена**: после `camera.lookAt(smoothedLook)`:
   `this.roll = lerp(this.roll, this.rollTarget, damp(6, delta)); this.camera.rotation.z += this.roll;`
   (rollTarget=0 в ветках menu/aim/finish — обнулить там же).
4. **Game.ts (вызов, ~стр. 742)**: добавить `this.session?.airborne ?? false` аргументом.
5. **Проверки**: `npx tsc --noEmit` → VAL → BUILD → PW-диагностика (меню/прицел/заезд) → замер: кадр на вираже должен показать крен 2–6°, FOV на 120 км/ч ≈ 68–70°.
6. **Коммит**: «W3-сцена крэша + W5 камера» (Game.ts, CameraRig.ts, config.ts, PlayerTube.ts, ParticleSystem.ts, vfxHub.ts, AudioSystem.ts).

**Критерий приёмки**: tsc чисто; VAL PASS; на видеокадрах виден крен камеры в поворотах; на крэше слышна фазовая структура (стоп-кадр → замедление → кувырок 2–4с); HUD и состояния не сломаны (20/20 smoke-чеклист состояний: menu→aim→launch→run→crash→results→retry).

---

## 2. W4 — АНИМАЦИИ (волна «оживления»)

Цель: убрать ощущение «статичных манекенов». Все анимации — процедурные (кодом), без внешних файлов.

### 2.1. Тюб — воббл и squash (файл `src/entities/PlayerTube.ts`)
- **Что есть**: `squash(tweens, scale, dur)` вызывается на jump/land/hit — проверить, что реально видно (в кадрах не читается).
- **Добавить**: непрерывный воббл от скорости — `bodyNode.rotation.z = sin(t·(4+v·0.12))·0.02·min(1,v/20)`; микро-наклон по крену виража (roll уже есть — усилить до ±0.12 рад ∝ vx).
- **Squash при приземлении**: масштаб по силе: land_clean → squash(0.92, 0.14), land_hard → squash(0.78, 0.25) + встряска. Сейчас единый 0.9.
- **Pose в полёте**: подъём носа ∝ vy (pitch = clamp(vy·0.02, −0.15, +0.25)).

### 2.2. Сундук — открытие крышки (`src/entities/… chest`, точка: results/chest screen)
- GLB chest (Quaternius) — проверить, есть ли отдельная нода крышки (probe через viewer.html + GLTFLoader, как делали для рогатки). Если нода есть — поворот крышки −70° за 0.4с easeOutBack при `chest_opened`. Если ноды нет — scale-пульс + вспышка частиц (fallback).

### 2.3. Флаги и гирлянда — ветер (`src/world/WorldDecor.ts`)
- Флажки: к ним уже применён `injectSway` (шейдер uTime)? Проверить: sway применён только к елям. Добавить sway к флагам (амплитуда 0.15, фаза по instanceId) и к гирлянде рогатки (Slingshot.ts, если не применён).
- Трюк: тот же onBeforeCompile с `cacheKey 'flag-wind'`, амплитуда в 2 раза выше еловой.

### 2.4. Факелы и лава — мерцание (`src/world/WorldDecor.ts`, `src/game/Game.ts`)
- Эмиссив материалов факелов (volcano/caves): в Game.update — `mat.emissiveIntensity = 1.1 + sin(t·11+φ)·0.25 + noise·0.1` (детерминированный шум).
- Если есть PointLight у лавы — синхронное мерцание intensity.

### 2.5. Пингвин — микро-поза (`src/entities/Penguin.ts`)
- В покое (menu/aim): «дыхание» scale y 1±0.015, поворот головы к камере.
- В заезде: наклон корпуса ∝ vx (уже есть частично — проверить).

**Проверки W4**: tsc → BUILD → PW: запись 20с видео меню (дыхание/флаги), заезда с прыжком (squash/воббл), открытия сундука. FF-кадры → глазами по чеклисту. Коммит «W4 анимации».

---

## 3. W6 — РЕНДЕР-СТЕК (самая большая волна, 6 подзадач)

Цель: картинка уровня «полished мобильная игра 2025»: bloom, небосвод по биому, окружение-освещение, искрящийся снег.

### 3.1. Post-processing composer (`src/systems/Renderer.ts`)
- Технология: `three/examples/jsm/postprocessing/EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass`.
- RenderTarget: `HalfFloatType`, `samples: 4` (MSAA в WebGL2) — иначе bloom ореолы + алиасинг.
- UnrealBloom: strength 0.45, radius 0.35, threshold 0.88 (только самые яркие: солнце, монеты, лава, кристаллы).
- Свой ShaderPass «speed+виньетка»: радиальное затемнение 0.12 в углах + на скорости >28 м/с лёгкое радиальное размытие по краям (cheap: 4 samples lerp, вкл плавно от v=28).
- Каскад отказа: если composer падает (SwiftShader!) — try/catch → прямой renderer.render. **Обязательно протестировать на SwiftShader (PW) — там HalfFloat+MSAA работает, но проверить FPS.**
- Порядок: RenderPass → Bloom → SpeedVignette → OutputPass (sRGB + tone mapping в конце!).

### 3.2. Небосвод по биомам (новый `src/world/SkyDome.ts`)
- Сейчас: вероятно сплошной clearColor/градиент. Заменить на сферу (BackSide) с шейдером: вертикальный градиент 3 стопа + солнечный диск + лёгкие облачные полосы (fbm 2 октавы, медленный дрейф по uTime).
- Палитры по биомам (уже есть в config palettes): valley — тёплый рассвет; canyon — холоднее; aurora — ночь с зелёным свечением; caves — сумрак + тёплые блики; volcano — багровый горизонт.
- Лерп между палитрами при смене карты (uniform blend за 1с).

### 3.3. PMREM environment (убить «чёрный металл» навсегда)
- `PMREMGenerator.fromScene(skyDomeScene)` → `scene.environment` (+ `scene.environmentIntensity ≈ 0.5`).
- После этого вернуть металличность: монета 0.85, обод тюба 0.6, детали рогатки 0.5 — блестяще, но не чёрно.
- Perf: генерить один раз на смену биома, не каждый кадр.

### 3.4. Тени: следование + texel snapping (`src/systems/Renderer.ts` или Game)
- Теневая орто-камера уже следует за игроком — добавить **texel snapping**: позицию light.target округлять к сетке `texelSize = (2·halfW)/shadowMapSize` в мировых осях света → убирает «плавание/мерцание» теней на ходу.
- Проверить `shadow.bias −0.0005`, `normalBias 0.02` против полос на новых роллерах.

### 3.5. Снежный блеск (sparkle) на трассе (`src/entities/Track.ts`)
- onBeforeCompile на материал полосы: в fragment добавить view-dependent глиттер — `pow(max(dot(reflect(-L,N),V),0),60) · step(0.997, hash(floor(worldPos·8)))` — редкие искры, видимые на ходу. Детерминированный hash без текстур.
- Категорически проверить на SwiftShader (дорогой pow — ограничить полосой ≤6м от центра).

### 3.6. GPU-снегопад + аврора (`src/systems/ParticleSystem.ts`, `src/world/`)
- Снегопад сейчас CPU-спрайты? Перевести на Points с шейдером: 1500 точек в box 60×40×60 вокруг камеры, wrap по модулю, drift ветром ∝ biome, размер по дистанции. (Если уже GPU — только добавить wind uniform.)
- **Aurora-биом**: 2–3 полупрозрачные «шторки» (PlaneGeometry 200×60, изогнутые) с шейдером: вертикальные волны зелёного/фиолетового, additive, медленный дрейф. Только для biome='aurora'.

**Проверки W6**: после КАЖДОЙ подзадачи отдельно: tsc → BUILD → PW-скриншоты (меню, заезд 30м, 150м) → PIL-сравнение яркости/контраста, замер FPS в page (`renderer.info`, rAF-timing — целиться ≥30 FPS на SwiftShader, ≥60 на реальном GPU). Отдельный коммит на подзадачи 3.1–3.3 и 3.4–3.6 (2 коммита).

---

## 4. W7 — ЗВУК И ОБРАТНАЯ СВЯЗЬ

### 4.1. Генерация недостающих SFX (плагин **audio_generation**, agent-gw)
Файлы → `/mnt/agents/output/app/public/sfx/` (mp3), имена — по матрице AudioSystem:
- `wind_loop.mp3` — sound effects, English prompt: *"continuous cold mountain wind whoosh, seamless loop, no birds, no music"*, 8–10с (макс 22с — но loop лучше короче; проверить стыковку — crossfade в AudioSystem).
- `coin.mp3` (если текущий слабый) — *"bright cheerful coin pickup chime, short 0.3s, video game"* — но сначала прослушать текущий (оценка: есть ли уже).
- `crash_whomp` уже синтезирован кодом (W3) — файл НЕ нужен.
- `record.mp3` (NEW BEST fanfare): *"short triumphant fanfare jingle, 1.5s, casual game"* — если отсутствует.
- Проверка наличия: `ls public/sfx/` → генерировать только недостающее.
- После генерации: MP3 → проверить длительность (`ffprobe`), громкость (нормализация ffmpeg `-af loudnorm` если слишком тихо/громко).

### 4.2. Ветер по скорости (`src/systems/AudioSystem.ts`)
- Уже есть loop wind_loop — проверить: gain = f(v)? Если нет: `windGain = clamp(0.15 + (v/35)·0.5, 0, 0.65)`, rate = `0.9 + v/70`. Обновлять в Game.update (run) через новый метод `audio.setWind(v)`.

### 4.3. Лесенка питча монет (`src/systems/AudioSystem.ts`)
- Сейчас: COMBO_STEP +2%, COMBO_MAX 12 (окно 1.5с). По спеку: cap 1.15 → `comboCount` уже даёт max 1.24 — снизить cap до 1.15 (`Math.min(1.15, 1 + n·0.02)` → step 0.02, max 7–8 ступеней). Сброс при пропуске >1.5с — есть.

### 4.4. Магнит-поп пикапов (`src/entities/Pickup.ts`)
- При притяжении к игроку: scale-поп 1.0→1.25→0 за 200мс easeOutBack + лёгкий pitch up звука (1.05). Сейчас playPop есть — привязать к magnet-событию.

### 4.5. Экран результатов (`src/ui/screens/ResultsScreen.ts`)
- Count-up монет/очков: 0 → итог за ~2с, easeOutCubic, со звуком тиков (ui_click каждые 80мс, pitch растёт 1→1.2).
- NEW BEST: если рекорд — золотая вспышка баннера + `record.mp3` + конфетти (confettiPool уже есть в ParticleSystem — вызвать burst 60 шт).
- Проверить событие `new_best` эмитится (есть в AudioSystem подписка — значит шина есть).

**Проверки W7**: `ls public/sfx` полнота; PW-прогон с `settings.sound:true` + `page.evaluate` перехват AudioContext (проверить, что play() вызывается — моки не нужны, достаточно отсутствия ошибок в консоли); ручная проверка логов на 404 sfx. Коммит «W7 звук».

---

## 5. W8 — МЕНЮ И ПЕРВОЕ ВПЕЧАТЛЕНИЕ

### 5.1. Hero-витрина (`src/game/Game.ts`, menu-state камера)
- Сейчас: статичный кадр за рогаткой + «дыхание». Сделать медленную орбиту вокруг героя: угол `sin(t·0.1)·0.35` рад вокруг базы рогатки, radius 7.5, высота 3.2 — герой/тюб/рогатка крупно, мир фоном.
- Пингвин в меню: idle-анимация (из W4.5) обязательна в кадре.

### 5.2. Хедер не перекрывает героя (`src/ui/screens/MenuScreen.ts` + `ui.css`)
- Проблема из аудита: «TAP TO PLAY»/шапка перекрывает героя. Решение: шапку вверх (safe-area + 8px), CTA-кнопку в нижнюю треть (`bottom: max(12%, env(safe-area-inset-bottom))`), герой визуально по центру-верху. Проверить PW-скриншотом 1280×720 и 390×844 (мобильный вьюпорт — добавить второй вьюпорт в diag-скрипт!).

### 5.3. Титры — ✅ уже сделано (Settings + CREDITS.md).

**Проверки W8**: PW-скриншоты меню (десктоп + мобильный вьюпорты), герой не перекрыт, орбита плавная (2 кадра t=0 и t=3 — угол изменился). Коммит «W8 меню».

---

## 6. ФИНАЛЬНЫЙ КОНТУР (обязательный, после всех волн)

### 6.1. Видео-аудит №2 (повторный, как в начале)
- PW-скрипт `playtests/final-audit.mjs`: 3 заезда (valley, canyon, volcano) × 150с + меню + крэш намеренный (startRun(0.3) в стену).
- FF: по 8 кадров с каждого видео → контрольные листы (terrain, модели, анимации, камера, bloom).
- PIL: замеры яркости mid-ground на тех же точках, что в аудите №1 → сравнение в таблицу «до/после».

### 6.2. Верификация (независимая)
- Субагент-**verifier** с чеклистом 20 пунктов (обновлённым под волны): состояния, экономика (coin → save → shop), карты, апгрейды, отсутствие консольных ошибок, FPS-замер, наличие: bloom, небосвода, крена камеры, фаз крэша. Свежие логи → `verifier/runs/`.
- Любой FAIL → фикс → повтор до 20/20.

### 6.3. Сборка и доставка
1. VAL (оба) PASS → `npx tsc --noEmit` чисто.
2. BUILD (FUSE-процедура из §0) → SRV проверка 200.
3. Финальный PW-smoke: меню→заезд→крэш→результаты, консоль чистая.
4. `git add -A && git commit` («final: W2–W8 + аудит»).
5. **website_version_manager** `action:"build_version"`, `type:"static"`, `project_dir:"/mnt/agents/output/app"` (источник, не dist) → карточка версии в чат.
6. Отчёт пользователю: таблица «было→стало» по каждому пункту его списка (карты/модели/анимации/динамика/звук/меню), с цифрами (кадры, замеры, чеклисты).

---

## 7. РИСКИ И ЗАПАСНЫЕ ВАРИАНТЫ

| Риск | Вероятность | План Б |
|---|---|---|
| HalfFloat+MSAA composer тормозит/падает на SwiftShader | Средняя | Каскад: composer без MSAA → bloom-only → прямой рендер; порог FPS <25 = автопонижение (renderer.setPixelRatio 0.85) |
| FUSE теряет файлы dist при копировании | Высокая (уже было) | Цикл «diff → докопировать → sleep 3» до 0 missing (отработано) |
| Игровое время в headless ×10 медленнее | Постоянно | Длинные прогоны только `nohup`-фоном; кадры из видео FF; метки времени из marks-файлов |
| GLB сундука без ноды крышки | Средняя | Fallback: scale-пульс + частицы (заложено в W4.2) |
| audio_generation выдаёт не-loopable ветер | Средняя | ffmpeg crossfade сам на себя (`-filter_complex acrossfade`) → loop |
| PMREM на SwiftShader медленный | Низкая | Генерить 1 раз на биом; при ошибке — оставить metalness 0.3 |
| Регрессия цвета террейна (как «бетон» в W2) | Средняя | После КАЖДОЙ волны PW-скриншот с фиксированной камеры + PIL-замер тех же RGB-точек (уже наработана методика) |

## 8. ПОРЯДОК И ОЦЕНКА

1. §1 завершение W5 + коммит W3/W5 — ближайшие действия.
2. §2 W4 анимации → коммит.
3. §3 W6 рендер (6 подзадач, 2 коммита) — самая длинная волна.
4. §4 W7 звук (генерация через audio_generation).
5. §5 W8 меню.
6. §6 финальный контур → доставка версией.

Каждая волна заканчивается гейтом: tsc + VAL + BUILD + визуальные кадры → коммит. Без прохождения гейта следующая волна не начинается.
