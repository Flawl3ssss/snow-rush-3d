# SNOW RUSH 3D — Архитектура и контракты (swarm)

Vertical slice от Scaffold-агента. Полностью играбельно: меню → натяжение рогатки →
запуск → заезд (стеринг, монеты, препятствия, трамплины, буст-пады, ice patch, финиш)
→ результаты → апгрейды. Все числа — `src/config.ts` (из gdd.md).

## Главное правило

**Не менять чужие файлы.** Свои файлы — по карте владения ниже. Если нужно изменение
в чужой зоне — договориться через lead-агента. Публичные API (ниже) — заморожены:
расширять можно, ломать сигнатуры нельзя.

## Карта владения (ветки)

```
src/
  config.ts                 SCAFFOLD (все тюнинг-числа; правки — через lead)
  core/                     SCAFFOLD
    Loop.ts                   rAF-цикл, clamp delta ≤ 0.1
    Renderer.ts               WebGLRenderer (ACES, sRGB, PCFSoft), свет/небо/fog §5
    InputController.ts        клавиатура+pointer → интенты (steer/pull/boost/pause)
    SaveSystem.ts             localStorage snowrush_save_v1, SaveData (схема финальна)
  game/                     SCAFFOLD (meta/ — расширяет META-SYSTEMS)
    Game.ts                   state machine + оркестрация кадра + тестовые хуки
    RunSession.ts             fixed-step симуляция заезда (gdd §4.1)
    meta/
      MetaProgression.ts      META-SYSTEMS расширяет (задания, сундук) — API финален
      Economy.ts              META-SYSTEMS расширяет (магазин, сундук-дропы)
  entities/                 WORLD-GRAPHICS — визуал мешей; SCAFFOLD — данные/коллизии
    Penguin.ts                иерархия group→flippers/head сохраняется
    PlayerTube.ts             group→squashNode→bodyNode; squash/tumble API финален
    Slingshot.ts              setPull(0..1), getPocketPosition(p) — API финален
    Track.ts                  heightAt/surfaceAt/centerX/headingAt/worldPos — финален;
                              buildGroundMesh() может заменить WORLD-GRAPHICS
    Obstacle.ts               kind/radius/heavy/destroy() — финален; makeMesh — графике
    Pickup.ts                 сенсоры/pop — финален; makePickupMesh — графике
    Ramp.ts, FinishGate.ts, Decor.ts   данные — финален; меши — графике
  systems/
    TrackBuilder.ts           SCAFFOLD — логика расстановки (gdd §7); визуальное
                              оформление — WORLD-GRAPHICS
    CameraRig.ts              SCAFFOLD (gdd §4.5)
    ShakeRig.ts               SCAFFOLD (trauma-based, game-feel)
    CollisionSystem.ts        SCAFFOLD (сфера/сфера, сенсоры, anti-tunneling)
    ParticleSystem.ts         WORLD-GRAPHICS (сейчас базовый снег; брызги/конфетти —
                              сюда же)
    AudioSystem.ts            AUDIO — реализация (сейчас stub, интерфейс финален)
                              + public/sfx/*.ogg, public/music/*.ogg
    DebugPanel.ts             SCAFFOLD (lil-gui, только ?debug=1)
  ui/                       UI-SCREENS (полные экраны по ui.md поверх skeleton)
    ScreenManager.ts          showOnly/showPause/update — API финален
    screens/*                 skeleton-экраны; UI-SCREENS заменяет содержимое,
                              сохраняя публичные методы (см. ScreenManager)
    ui.css                    UI-SCREENS
  utils/                    SCAFFOLD
    random.ts                 createSeededRandom/createRng — Math.random() ЗАПРЕЩЁН
    tween.ts                  TweenManager + easing (game-feel)
    events.ts                 EventBus + GameEvents — КОНТРАКТ, см. ниже
    math.ts, dispose.ts
  pages/Home.tsx, main.tsx, App.tsx   React-shell (только монтирование игры)
docs/ARCHITECTURE.md        этот файл (SCAFFOLD; правки — через lead)
public/                     ассеты (logo.png, icon-*.png, sfx/*.ogg) — graphics/audio
                            агенты; код ссылается на них с graceful fallback
```

## Порядок кадра (design.md §10)

```
input intents → fixed-step симуляция 1/60 (аккумулятор, clamp ≤0.1) →
коллизии/события (RunSession.step) → камера/VFX/HUD (реальный delta) → render
```

Hitstop/slow-mo масштабируют ТОЛЬКО gameplay delta; камера, твины, shake, HUD —
всегда реальный delta.

## Публичные API

### Game (src/game/Game.ts)

Состояния: `loading | menu | aim | launch | run | crash | stopped | finish | results | pause`.
Публичные методы: `toAim()`, `restartRun()`, `quitToMenu()`, `togglePause()`,
`resumeFromPause()`, `tryBoost()`, `hitstop(ms, scale)`.
Геттеры: `state`, `meta`, `economy`, `bus`, `audio`, `save`, `currentSession`,
`currentResults`, `currentTrack`.

### Тестовые хуки

```ts
window.__THREE_GAME_TEST_HOOKS__ = {
  setState(state),          // 'menu'|'aim'|'run'|'results'
  getState(),               // snapshot: state, distance, speed(Kmh), coins, ...
  startRun(power = 1),      // из меню/results сразу в запуск с силой power
  setReducedMotion(v),
  seed(n),                  // seed следующих заездов (детерминизм)
}
window.__THREE_GAME_DIAGNOSTICS__ = { state, renderer }
```

### EventBus (src/utils/events.ts) — события

`state_changed {from,to}` · `run_started {seed,finishDistance}` · `run_finished RunResults` ·
`pull_changed {power}` · `launched {power,speed}` · `coin_collected {runTotal,x,y,z}` ·
`crystal_collected {runTotal}` · `diamond_collected {runTotal}` · `new_best {distance}` ·
`collision {kind:'light'|'wall'|'boostpad',x,z}` · `crash {x,z,obstacleType}` ·
`finish {distance}` · `jump {}` · `land {}` · `boost_started {rocketsLeft}` · `boost_ended {}` ·
`upgrade_purchased {line,level,cost}` · `upgrade_failed {line}` ·
`currency_changed {coins,crystals,diamonds,rockets}` ·
`level_up {level,coins,crystals,diamonds,rockets}` · `settings_changed {...}`

HUD/аудио/мета подписываются (`bus.on`), геймплей только эмитит.

### MetaProgression / Economy (src/game/meta/)

- `getUpgradeLevel(line)`, `getUpgradeCost(line)`, `isMaxLevel(line)`,
  `getUpgradeStat(line)`, `incomeMult`, `finishDistance`, `playerLevel`, `xp`,
  `xpNeed`, `xpProgress`, `best`, `recordDistance(d)`, `addXp(n) → levelUps[]`.
- `economy.coins/crystals/diamonds/rockets`, `add*(n)`, `spendCrystals/Diamonds(n)`,
  `useRocket()`, `buyUpgrade(line) → bool`, `grantLevelUp(level)`.
- **Точки расширения meta-агента**: задания (gdd §5.5) и сундук (§5.6) — новые методы
  в Economy + поля `tasks`/`chest` уже есть в SaveData; «второй шанс» (§5.7) —
  конфиг CONTINUE в config.ts + модалка поверх results.
- Автосохранение: конец заезда, покупка, visibilitychange→hidden. После мутаций
  меты вне этих точек вызывать `game.save.save(game.meta.save)`.

### AudioSystem (src/systems/AudioSystem.ts) — stub, интерфейс финален

`play(name, {pitch?, gain?}?)` — имена из матрицы design.md §8 (`AudioEventName`);
`setMusic('menu'|'run'|null)`, `setDuck(v)`, `setMusicEnabled/setSfxEnabled`, `unlock()`.
Audio-агент: Web Audio, буферы из `/sfx/*.ogg`, gain-матрица Music/SFX/Master,
pitch-вариация через seeded RNG, первый звук после жеста (unlock уже вызывается на tap).

### Track (src/entities/Track.ts)

Координаты трассы: `s` — дистанция спуска (world z = −s), `x` — поперёк
(world x = centerX(s) + x). `heightAt(x,s)`, `surfaceAt(x) → 'ice'|'snow'|'loose'`,
`slopeDegAt(s)`, `headingAt(s)`, `worldPos(x,s,yOff,out)`, `finishDistance`, `length`.
Физика и контент обязаны жить в этих координатах.

## Сохранение

`localStorage["snowrush_save_v1"]` — `SaveData` (src/core/SaveSystem.ts), версия схемы 2
(миграция v1→v2 в `migrateSave`: tasks расширен keys/targets/seen, старый прогресс
заданий перегенерируется seeded). Поля: coins/crystals/diamonds/rockets,
upgrades{slingshot,sled,income}, playerLevel, xp, best,
tasks{dateId,keys[],targets[],progress[],claimed[],seen}, chest{readyAt},
settings{music,sfx,quality,reducedMotion}, stats{lifetimeDistance,runs}.

## Мета-системы (META-SYSTEMS, gdd §5.5–5.7, ui.md §3.6–3.8)

Реализация: `src/game/meta/dailyTasks.ts` (пул/генерация), `chest.ts` (таймер/дропы),
`shop.ts` (наборы), фасад — `MetaProgression` (подключён к шине через
`Economy.constructor → meta.attach(bus, economy)`). Мета сама автосохраняется
после claim/сундука/покупок (gdd §6). Никакого Math.random — seeded RNG
(`daily:<dateId>`, `chest:<readyAt>`).

### API на MetaProgression (контракт для UI-SCREENS)

```ts
getDailyTasks(): DailyTask[]        // 3 задания дня {id,title,target,progress,reward,done,claimed}
claimTaskReward(id): boolean        // «ЗАБРАТЬ»: начисляет reward, эмитит task_claimed
hasTasksBadge(): boolean            // бейдж NEW: не просмотрено ИЛИ есть невзятые награды
markTasksSeen(): void               // вызвать при открытии экрана заданий
getTasksResetSeconds(): number      // секунды до 00:00 («ОБНОВЛЕНИЕ ЧЕРЕЗ …»)
getChestState(): {ready, secondsLeft}  // эмитит chest_ready при первом обнаружении готовности
openChest(): TaskReward | null      // 2 дропа по таблице §5.6, перезапуск 15 мин
speedUpChest(): boolean             // 10 кр → сброс таймера
getRockets(): number
buyRocket(): boolean                // 2 алмаза → +1 ракета, эмитит rocket_purchased
canContinue(): boolean              // крэш > 150 м, 1 раз за заезд (валюту НЕ проверяет)
getContinueCost(): number           // 5 (кристаллы, CONTINUE.costCrystals)
spendContinue(): boolean            // списывает 5 кр, эмитит continue_used
getShopOffers(): ShopOffer[]        // 6 наборов ui.md §3.6 (rocket×1/×5, 10/30/100◆ за кр, ускорение)
canBuyOffer(id): boolean
buyShopOffer(id): boolean           // mock-покупка, эмитит purchase_made {mock:true}
```

### Новые события EventBus

`task_completed {task}` (баннер «DAILY TASK COMPLETED!» + звук task_done) ·
`task_claimed {task}` · `chest_ready` (покачивание сундука) ·
`chest_opened {reward}` (звук chest_open) · `rocket_purchased {rockets}` (ui_buy) ·
`rocket_used {rocketsLeft}` (эмитит Economy.useRocket; ядро дополнительно шлёт boost_started) ·
`continue_used {}` · `purchase_made {offerId,kind,amount,cost,costCurrency,mock:true}`.

Прогресс заданий идёт от существующих событий: coin_collected→«монеты»,
run_finished(distance/finished)→«дистанция»/«финиши», crystal_collected→«кристаллы»,
jump→«трамплины», new_best→«рекорд».

### Точки интеграции

- **UI-SCREENS**: экраны TASKS/CHEST/SHOP строятся на API выше; CONTINUE-модалка
  (ui.md поверх results): показывать, когда `meta.canContinue()` и
  `economy.crystals >= meta.getContinueCost()`; по принятию — `meta.spendContinue()`.
- **Ядро (SCAFFOLD)**: `continue_used` сейчас никем не подхватывается — для
  респавна по gdd §5.7 (v=10 м/с, неуязвимость 2 с, чистка препятствий 15 м)
  нужен обработчик в Game.ts + кнопка в results (отдельная задача через lead).
- **AUDIO**: маппинг task_completed→task_done, chest_opened→chest_open,
  rocket_purchased/purchase_made→ui_buy.

## Ассеты

Код ссылается на `/logo.png`, `/icon-*.png` и т.п. как на будущие файлы (манифест —
design.md §9); все `<img>` через `iconImg()` с onerror-fallback (скрытие). Небо —
canvas-градиент fallback до появления `sky-panorama.png`.

## Известные ограничения среза

- Экраны — skeleton (ui.md): нет SHOP/TASKS/CHEST/SETTINGS/LEVEL UP экранов,
  нет CONTINUE-модалки (конфиг готов), баннеров, count-up анимаций.
- Нет звука (AudioSystem — stub, маршрутизация событий готова).
- Декор/VFX минимальные (снег-Points, ветряки, ёлки, скалы, снеговики);
  трамплинные «снежные всплески», конфетти финиша, speed-lines — за графикой.
- Перекати-снежки (min z 800 м, gdd §7.2) не реализованы — точка расширения
  в TrackBuilder.pickObstacleKind + Obstacle.update.
- Skybox — градиентный fallback; tex-ice-track/tex-snow-noise не подключены.
- DebugPanel (?debug=1) — базовый набор ручек.
