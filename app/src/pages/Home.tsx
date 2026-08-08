import { useEffect, useRef, useState } from 'react'
import { Game } from '@/game/Game'
import { AssetLib } from '@/systems/AssetLib'
import '@/ui/ui.css'

/**
 * React-shell: единственная страница, монтирующая игру.
 * Вся игровая логика и HUD — vanilla TS + DOM (design.md §10).
 * Перед созданием Game догружаем GLB-ассеты (AssetLib): пингвин, тюбинг,
 * рогатка, препятствия, пикапы, декор. Без них сущности собирались бы из
 * процедурных фолбэков, поэтому ждём preload здесь.
 */
export default function Home() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [assetsReady, setAssetsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void AssetLib.preload((t) => {
      if (!cancelled) setProgress(t)
    }).then(() => {
      if (!cancelled) setAssetsReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!assetsReady) return
    const host = hostRef.current
    if (!host) return
    const game = new Game(host)
    game.start()
    return () => game.dispose()
  }, [assetsReady])

  return (
    <div
      ref={hostRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
        background: '#CFE8FF',
      }}
    >
      {!assetsReady && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            background: 'linear-gradient(180deg, #BFDFFF 0%, #E8F4FF 100%)',
            color: '#1d3a5f',
            fontFamily: 'system-ui, sans-serif',
            zIndex: 10,
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 1 }}>SNOW RUSH 3D</div>
          <div
            style={{
              width: 220,
              height: 8,
              borderRadius: 4,
              background: 'rgba(29,58,95,0.15)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: '100%',
                borderRadius: 4,
                background: '#2f6fb4',
                transition: 'width 120ms ease-out',
              }}
            />
          </div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>Загрузка… {Math.round(progress * 100)}%</div>
        </div>
      )}
    </div>
  )
}
