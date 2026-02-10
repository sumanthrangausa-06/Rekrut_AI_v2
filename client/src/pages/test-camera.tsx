import { useEffect, useRef, useState } from 'react'

/**
 * CAMERA ISOLATION TEST PAGE
 *
 * Progressive levels to isolate exactly what breaks the camera:
 * Level 1: Bare minimum getUserMedia + <video>
 * Level 2: Inside a Dialog-like modal
 * Level 3: With React key prop swap (like ai-coaching.tsx)
 * Level 4: With canvas frame capture
 * Level 5: Full ai-coaching pattern (Dialog + key + canvas + all state)
 *
 * If Level 1 fails → problem is app-wide (build, polyfills, etc.)
 * If Level 1 works but Level 2 fails → Dialog overflow issue
 * If Level 2 works but Level 3 fails → React key remount kills stream
 * etc.
 */

type TestLevel = 1 | 2 | 3 | 4 | 5
type TestStatus = 'idle' | 'running' | 'pass' | 'fail'

interface LogEntry {
  time: string
  msg: string
  type: 'info' | 'warn' | 'error' | 'success'
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as any)
}

// ============= LEVEL 1: Bare minimum =============
function Level1({ onLog, onResult }: { onLog: (e: LogEntry) => void; onResult: (pass: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      onLog({ time: timestamp(), msg: 'Requesting getUserMedia({ video: true })...', type: 'info' })
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings?.() || {}
        onLog({ time: timestamp(), msg: `Got stream: track=${track?.readyState}, ${settings.width}x${settings.height}`, type: 'info' })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          onLog({ time: timestamp(), msg: 'Set srcObject on <video>', type: 'info' })

          try {
            await videoRef.current.play()
            onLog({ time: timestamp(), msg: `play() succeeded, readyState=${videoRef.current.readyState}`, type: 'success' })
          } catch (e: any) {
            onLog({ time: timestamp(), msg: `play() failed: ${e?.message}`, type: 'error' })
          }

          // Check if actually rendering frames after 1 second
          setTimeout(() => {
            const v = videoRef.current
            if (!v) return
            onLog({ time: timestamp(), msg: `Video element: readyState=${v.readyState}, videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}, paused=${v.paused}, currentTime=${v.currentTime.toFixed(2)}`, type: 'info' })

            // Draw to offscreen canvas to verify actual pixel data
            const canvas = document.createElement('canvas')
            canvas.width = 64
            canvas.height = 48
            const ctx = canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(v, 0, 0, 64, 48)
              const data = ctx.getImageData(0, 0, 64, 48).data
              // Check if all pixels are black (or near-black)
              let nonBlack = 0
              for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 10 || data[i+1] > 10 || data[i+2] > 10) nonBlack++
              }
              const totalPixels = 64 * 48
              const pct = Math.round((nonBlack / totalPixels) * 100)
              if (pct > 5) {
                onLog({ time: timestamp(), msg: `✅ PASS — ${pct}% non-black pixels. Camera is rendering real frames.`, type: 'success' })
                onResult(true)
              } else {
                onLog({ time: timestamp(), msg: `❌ FAIL — Only ${pct}% non-black pixels. Black screen detected.`, type: 'error' })
                onResult(false)
              }
            }
          }, 1500)
        }
      } catch (err: any) {
        onLog({ time: timestamp(), msg: `getUserMedia error: ${err?.name} — ${err?.message}`, type: 'error' })
        onResult(false)
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="space-y-2">
      <h3 className="font-bold text-sm">Level 1: Bare Minimum</h3>
      <p className="text-xs text-gray-500">Just getUserMedia + &lt;video autoPlay playsInline muted&gt;</p>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', maxWidth: 400, background: '#000', borderRadius: 8 }}
      />
    </div>
  )
}

// ============= LEVEL 2: Inside a Dialog-like container =============
function Level2({ onLog, onResult }: { onLog: (e: LogEntry) => void; onResult: (pass: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      onLog({ time: timestamp(), msg: '[L2] Requesting getUserMedia inside Dialog-like container...', type: 'info' })
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings?.() || {}
        onLog({ time: timestamp(), msg: `[L2] Stream: ${settings.width}x${settings.height}`, type: 'info' })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch((e: any) => {
            onLog({ time: timestamp(), msg: `[L2] play() error: ${e?.message}`, type: 'error' })
          })
          onLog({ time: timestamp(), msg: `[L2] play() ok, readyState=${videoRef.current.readyState}`, type: 'success' })

          setTimeout(() => {
            const v = videoRef.current
            if (!v) return
            const canvas = document.createElement('canvas')
            canvas.width = 64; canvas.height = 48
            const ctx = canvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(v, 0, 0, 64, 48)
              const data = ctx.getImageData(0, 0, 64, 48).data
              let nonBlack = 0
              for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 10 || data[i+1] > 10 || data[i+2] > 10) nonBlack++
              }
              const pct = Math.round((nonBlack / (64 * 48)) * 100)
              if (pct > 5) {
                onLog({ time: timestamp(), msg: `[L2] ✅ PASS — ${pct}% non-black pixels inside Dialog`, type: 'success' })
                onResult(true)
              } else {
                onLog({ time: timestamp(), msg: `[L2] ❌ FAIL — ${pct}% non-black inside Dialog. overflow-y-auto or z-index issue.`, type: 'error' })
                onResult(false)
              }
            }
          }, 1500)
        }
      } catch (err: any) {
        onLog({ time: timestamp(), msg: `[L2] Error: ${err?.name} — ${err?.message}`, type: 'error' })
        onResult(false)
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="space-y-2">
      <h3 className="font-bold text-sm">Level 2: Inside Dialog Container</h3>
      <p className="text-xs text-gray-500">Same as L1 but wrapped in Dialog-like div (fixed, z-50, overflow-y-auto, max-h-90vh)</p>
      {/* Simulates Dialog structure exactly */}
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ position: 'relative', minHeight: 350 }}>
        <div className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border bg-white p-6 shadow-lg">
          <p className="text-xs font-medium mb-2">This simulates the Dialog component's exact CSS</p>
          <div className="relative bg-black aspect-video rounded-xl overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============= LEVEL 3: React key swap pattern =============
function Level3({ onLog, onResult }: { onLog: (e: LogEntry) => void; onResult: (pass: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)

  // Mimic ai-coaching: get stream first, then set cameraReady, then attach in useEffect
  useEffect(() => {
    let cancelled = false
    async function start() {
      onLog({ time: timestamp(), msg: '[L3] Getting stream (NOT attaching yet — mimics overlay pattern)...', type: 'info' })
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings?.() || {}
        onLog({ time: timestamp(), msg: `[L3] Stream ready: ${settings.width}x${settings.height}. Setting cameraReady=true (triggers key swap)...`, type: 'info' })
        setCameraReady(true)
      } catch (err: any) {
        onLog({ time: timestamp(), msg: `[L3] Error: ${err?.name} — ${err?.message}`, type: 'error' })
        onResult(false)
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // Attach stream AFTER cameraReady (mimics ai-coaching.tsx useEffect)
  useEffect(() => {
    if (!cameraReady) return
    const stream = streamRef.current
    if (!stream) return

    onLog({ time: timestamp(), msg: '[L3] cameraReady=true, attaching stream after 100ms delay (key="cam-active")...', type: 'info' })
    const timer = setTimeout(async () => {
      const v = videoRef.current
      if (!v) { onLog({ time: timestamp(), msg: '[L3] videoRef is null after key swap!', type: 'error' }); onResult(false); return }
      v.srcObject = stream
      try {
        await v.play()
        onLog({ time: timestamp(), msg: `[L3] play() ok, readyState=${v.readyState}`, type: 'success' })
      } catch (e: any) {
        onLog({ time: timestamp(), msg: `[L3] play() error: ${e?.message}`, type: 'error' })
      }

      // Verify pixels
      setTimeout(() => {
        if (!v) return
        onLog({ time: timestamp(), msg: `[L3] Checking: videoWidth=${v.videoWidth}, videoHeight=${v.videoHeight}, paused=${v.paused}`, type: 'info' })
        const canvas = document.createElement('canvas')
        canvas.width = 64; canvas.height = 48
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(v, 0, 0, 64, 48)
          const data = ctx.getImageData(0, 0, 64, 48).data
          let nonBlack = 0
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 10 || data[i+1] > 10 || data[i+2] > 10) nonBlack++
          }
          const pct = Math.round((nonBlack / (64 * 48)) * 100)
          if (pct > 5) {
            onLog({ time: timestamp(), msg: `[L3] ✅ PASS — ${pct}% non-black after key swap`, type: 'success' })
            onResult(true)
          } else {
            onLog({ time: timestamp(), msg: `[L3] ❌ FAIL — ${pct}% non-black. Key swap + delayed attach breaks rendering.`, type: 'error' })
            onResult(false)
          }
        }
      }, 1500)
    }, 100)
    return () => clearTimeout(timer)
  }, [cameraReady])

  return (
    <div className="space-y-2">
      <h3 className="font-bold text-sm">Level 3: React Key Swap (ai-coaching pattern)</h3>
      <p className="text-xs text-gray-500">Stream obtained → cameraReady=true → key changes → useEffect attaches stream after 100ms</p>
      <div className="relative bg-black rounded-xl overflow-hidden" style={{ maxWidth: 400, aspectRatio: '16/9' }}>
        {!cameraReady && (
          <div className="absolute inset-0 z-10 bg-black/90 flex items-center justify-center">
            <p className="text-white text-sm">Loading camera...</p>
          </div>
        )}
        <video
          key={cameraReady ? 'cam-active' : 'cam-pending'}
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
      </div>
    </div>
  )
}

// ============= LEVEL 4: Canvas frame capture =============
function Level4({ onLog, onResult }: { onLog: (e: LogEntry) => void; onResult: (pass: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [frames, setFrames] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    async function start() {
      onLog({ time: timestamp(), msg: '[L4] Starting with canvas frame capture...', type: 'info' })
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
          onLog({ time: timestamp(), msg: '[L4] Video playing, starting frame capture every 2s...', type: 'info' })

          // Capture frames like ai-coaching does
          let frameCount = 0
          const interval = setInterval(() => {
            if (cancelled || frameCount >= 3) { clearInterval(interval); return }
            const canvas = canvasRef.current
            const video = videoRef.current
            if (!canvas || !video) return
            canvas.width = 320; canvas.height = 240
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.drawImage(video, 0, 0, 320, 240)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
            frameCount++
            setFrames(prev => [...prev, dataUrl])

            // Check pixel data on first frame
            if (frameCount === 1) {
              const imgData = ctx.getImageData(0, 0, 320, 240).data
              let nonBlack = 0
              for (let i = 0; i < imgData.length; i += 16) { // Sample every 4th pixel for speed
                if (imgData[i] > 10 || imgData[i+1] > 10 || imgData[i+2] > 10) nonBlack++
              }
              const totalSampled = (320 * 240) / 4
              const pct = Math.round((nonBlack / totalSampled) * 100)
              onLog({ time: timestamp(), msg: `[L4] Frame 1 captured: ${dataUrl.length} bytes, ${pct}% non-black`, type: 'info' })
              if (pct > 5) {
                onLog({ time: timestamp(), msg: `[L4] ✅ PASS — Canvas capture is working`, type: 'success' })
                onResult(true)
              } else {
                onLog({ time: timestamp(), msg: `[L4] ❌ FAIL — Canvas draws black frames`, type: 'error' })
                onResult(false)
              }
            } else {
              onLog({ time: timestamp(), msg: `[L4] Frame ${frameCount} captured: ${dataUrl.length} bytes`, type: 'info' })
            }
          }, 2000)

          // Capture first immediately after 500ms warmup
          setTimeout(() => {
            if (cancelled) return
            const canvas = canvasRef.current
            const video = videoRef.current
            if (!canvas || !video) return
            canvas.width = 320; canvas.height = 240
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.drawImage(video, 0, 0, 320, 240)
          }, 500)
        }
      } catch (err: any) {
        onLog({ time: timestamp(), msg: `[L4] Error: ${err?.name} — ${err?.message}`, type: 'error' })
        onResult(false)
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="space-y-2">
      <h3 className="font-bold text-sm">Level 4: Canvas Frame Capture</h3>
      <p className="text-xs text-gray-500">getUserMedia + video + drawImage to canvas every 2s (like ai-coaching recording)</p>
      <div className="flex gap-3 flex-wrap">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: 300, background: '#000', borderRadius: 8 }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {frames.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1">Captured frames:</p>
            <div className="flex gap-1 flex-wrap">
              {frames.map((f, i) => (
                <img key={i} src={f} alt={`frame-${i}`} style={{ width: 80, height: 60, borderRadius: 4, border: '1px solid #ddd' }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============= LEVEL 5: Full ai-coaching pattern =============
function Level5({ onLog, onResult }: { onLog: (e: LogEntry) => void; onResult: (pass: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [showDialog, setShowDialog] = useState(true)

  // Mimic startCamera()
  useEffect(() => {
    let cancelled = false
    async function start() {
      onLog({ time: timestamp(), msg: '[L5] Full pattern: Dialog + overlay + key swap + canvas...', type: 'info' })
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings?.() || {}
        onLog({ time: timestamp(), msg: `[L5] Stream ready: ${settings.width}x${settings.height}. NOT attaching yet (overlay still showing).`, type: 'info' })

        // DO NOT attach to video element — mimics ai-coaching exactly
        setCameraReady(true)
      } catch (err: any) {
        onLog({ time: timestamp(), msg: `[L5] Error: ${err?.name} — ${err?.message}`, type: 'error' })
        onResult(false)
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // Attach stream AFTER cameraReady — exact copy of ai-coaching useEffect
  useEffect(() => {
    if (!cameraReady) return
    const stream = streamRef.current
    if (!stream) return

    onLog({ time: timestamp(), msg: '[L5] cameraReady=true, overlay removed. Attaching stream in 100ms...', type: 'info' })
    const timer = setTimeout(async () => {
      const v = videoRef.current
      if (!v) {
        onLog({ time: timestamp(), msg: '[L5] videoRef null after key swap!', type: 'error' })
        onResult(false)
        return
      }
      v.srcObject = stream
      try {
        await v.play()
        onLog({ time: timestamp(), msg: `[L5] play() ok`, type: 'success' })
      } catch (e: any) {
        onLog({ time: timestamp(), msg: `[L5] play() error: ${e?.message}`, type: 'error' })
        // Retry like ai-coaching
        setTimeout(() => {
          if (videoRef.current && streamRef.current) {
            videoRef.current.srcObject = streamRef.current
            videoRef.current.play().catch(() => {})
          }
        }, 200)
      }

      // Verify with canvas
      setTimeout(() => {
        const v2 = videoRef.current
        const canvas = canvasRef.current
        if (!v2 || !canvas) return
        canvas.width = 64; canvas.height = 48
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(v2, 0, 0, 64, 48)
        const data = ctx.getImageData(0, 0, 64, 48).data
        let nonBlack = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 10 || data[i+1] > 10 || data[i+2] > 10) nonBlack++
        }
        const pct = Math.round((nonBlack / (64 * 48)) * 100)
        onLog({ time: timestamp(), msg: `[L5] videoWidth=${v2.videoWidth}, videoHeight=${v2.videoHeight}, paused=${v2.paused}`, type: 'info' })
        if (pct > 5) {
          onLog({ time: timestamp(), msg: `[L5] ✅ PASS — ${pct}% non-black. Full pattern works.`, type: 'success' })
          onResult(true)
        } else {
          onLog({ time: timestamp(), msg: `[L5] ❌ FAIL — ${pct}% non-black. Full ai-coaching pattern breaks camera.`, type: 'error' })
          onResult(false)
        }
      }, 1500)
    }, 100)
    return () => clearTimeout(timer)
  }, [cameraReady])

  if (!showDialog) return null

  return (
    <div className="space-y-2">
      <h3 className="font-bold text-sm">Level 5: Full ai-coaching Pattern</h3>
      <p className="text-xs text-gray-500">Dialog-like container + overlay + key swap + canvas + scaleX(-1)</p>
      {/* Simulates Dialog */}
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border bg-white p-6 shadow-lg">
        <div className="relative bg-black aspect-video rounded-xl isolate overflow-hidden">
          <video
            key={cameraReady ? 'cam-active' : 'cam-pending'}
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          {!cameraReady && (
            <div className="absolute inset-0 z-10 bg-black/90 flex items-center justify-center">
              <p className="text-white text-sm">Initializing camera...</p>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}


// ============= MAIN PAGE =============
export function TestCameraPage() {
  const [activeLevel, setActiveLevel] = useState<TestLevel | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [results, setResults] = useState<Record<number, TestStatus>>({})

  const addLog = (entry: LogEntry) => {
    setLogs(prev => [...prev, entry])
  }

  const setResult = (level: number) => (pass: boolean) => {
    setResults(prev => ({ ...prev, [level]: pass ? 'pass' : 'fail' }))
  }

  const startTest = (level: TestLevel) => {
    setActiveLevel(level)
    setLogs([])
    setResults(prev => ({ ...prev, [level]: 'running' }))
    addLog({ time: timestamp(), msg: `Starting Level ${level} test...`, type: 'info' })
  }

  const stopTest = () => {
    setActiveLevel(null)
  }

  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)
  const isChromeIOS = isIOS && /CriOS/.test(ua)

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 4 }}>🔬 Camera Isolation Test</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Progressive tests to find what breaks the camera. Each level adds one thing.
      </p>

      {/* Device info */}
      <div style={{ padding: 12, background: '#f1f5f9', borderRadius: 8, marginBottom: 16, fontSize: 11, fontFamily: 'monospace' }}>
        <strong>Device:</strong> {isIOS ? (isChromeIOS ? 'iOS Chrome' : 'iOS Safari') : 'Desktop/Android'}<br/>
        <strong>UA:</strong> {ua.slice(0, 120)}...
      </div>

      {/* Test buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {([1, 2, 3, 4, 5] as TestLevel[]).map(level => {
          const status = results[level] || 'idle'
          const labels = [
            '',
            'Bare minimum',
            '+ Dialog container',
            '+ Key swap pattern',
            '+ Canvas capture',
            'Full ai-coaching'
          ]
          const bgColor = status === 'pass' ? '#dcfce7' : status === 'fail' ? '#fee2e2' : status === 'running' ? '#dbeafe' : '#f9fafb'
          const borderColor = status === 'pass' ? '#86efac' : status === 'fail' ? '#fca5a5' : status === 'running' ? '#93c5fd' : '#d1d5db'
          return (
            <button
              key={level}
              onClick={() => activeLevel === level ? stopTest() : startTest(level)}
              disabled={activeLevel !== null && activeLevel !== level}
              style={{
                padding: '8px 16px',
                border: `2px solid ${borderColor}`,
                borderRadius: 8,
                background: bgColor,
                cursor: activeLevel !== null && activeLevel !== level ? 'not-allowed' : 'pointer',
                opacity: activeLevel !== null && activeLevel !== level ? 0.5 : 1,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              L{level}: {labels[level]}
              {status === 'pass' && ' ✅'}
              {status === 'fail' && ' ❌'}
              {status === 'running' && ' 🔄'}
            </button>
          )
        })}
      </div>

      {activeLevel && (
        <button
          onClick={stopTest}
          style={{ marginBottom: 12, padding: '6px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          Stop Test & Release Camera
        </button>
      )}

      {/* Active test */}
      <div style={{ marginBottom: 16 }}>
        {activeLevel === 1 && <Level1 onLog={addLog} onResult={setResult(1)} />}
        {activeLevel === 2 && <Level2 onLog={addLog} onResult={setResult(2)} />}
        {activeLevel === 3 && <Level3 onLog={addLog} onResult={setResult(3)} />}
        {activeLevel === 4 && <Level4 onLog={addLog} onResult={setResult(4)} />}
        {activeLevel === 5 && <Level5 onLog={addLog} onResult={setResult(5)} />}
      </div>

      {/* Log output */}
      <div style={{ background: '#1e293b', borderRadius: 8, padding: 12, maxHeight: 350, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
        <div style={{ color: '#94a3b8', marginBottom: 4, fontWeight: 'bold' }}>Console Log:</div>
        {logs.length === 0 && <div style={{ color: '#64748b' }}>Click a test level above to start...</div>}
        {logs.map((l, i) => (
          <div key={i} style={{
            color: l.type === 'error' ? '#f87171' : l.type === 'warn' ? '#fbbf24' : l.type === 'success' ? '#4ade80' : '#e2e8f0',
            lineHeight: 1.5
          }}>
            <span style={{ color: '#64748b' }}>[{l.time}]</span> {l.msg}
          </div>
        ))}
      </div>

      {/* Results summary */}
      {Object.keys(results).length > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <strong style={{ fontSize: 14 }}>Results Summary:</strong>
          <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
            {Object.entries(results).map(([level, status]) => (
              <div key={level} style={{ fontSize: 13 }}>
                Level {level}: {status === 'pass' ? '✅ PASS' : status === 'fail' ? '❌ FAIL' : '🔄 Running...'}
              </div>
            ))}
          </div>
          {results[1] === 'fail' && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
              ⚠️ Level 1 failed — the problem is app-wide (not specific to ai-coaching.tsx). Check build config, polyfills, or browser permissions.
            </p>
          )}
          {results[1] === 'pass' && results[2] === 'fail' && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
              ⚠️ Level 2 failed — the Dialog's overflow-y-auto / max-h-90vh / z-50 is breaking the camera.
            </p>
          )}
          {results[2] === 'pass' && results[3] === 'fail' && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
              ⚠️ Level 3 failed — the React key swap pattern (key="cam-active"/"cam-pending") breaks stream attachment.
            </p>
          )}
          {results[3] === 'pass' && results[4] === 'fail' && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
              ⚠️ Level 4 failed — Canvas drawImage is the issue.
            </p>
          )}
          {results[4] === 'pass' && results[5] === 'fail' && (
            <p style={{ marginTop: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
              ⚠️ Level 5 failed — the combination of Dialog + key swap + canvas together causes the issue.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
