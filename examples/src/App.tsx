import { useState } from 'react';
import { Svg3D, PRESETS, type PresetName } from '@filipaovfx/svg3d';

const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export function App() {
  const [text, setText] = useState('CW');
  const [preset, setPreset] = useState<PresetName>('neon');

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px', fontFamily: 'monospace' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: 1 }}>@filipaovfx/svg3d — playground</h1>
        <p style={{ margin: '6px 0 0', color: '#888', fontSize: 13 }}>
          Live preview of the brand presets. Drag to orbit · scroll page normally.
        </p>
      </header>

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ color: '#888' }}>TEXT</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={6}
            style={{
              background: '#0d0f14', color: '#fff', border: '1px solid #2a2a3a',
              padding: '6px 10px', fontFamily: 'monospace', fontSize: 14, width: 120,
            }}
          />
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PRESET_NAMES.map((name) => (
            <button
              key={name}
              onClick={() => setPreset(name)}
              style={{
                background: preset === name ? '#00fff9' : 'transparent',
                color: preset === name ? '#0a0a0f' : '#00fff9',
                border: '1px solid #00fff9',
                padding: '6px 14px', fontFamily: 'monospace', fontSize: 12,
                fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer',
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Stage */}
      <div
        style={{
          height: 460,
          border: '1px solid #1a1a2e',
          borderRadius: 8,
          background: 'radial-gradient(ellipse at 50% 30%, rgba(0,243,255,0.06), transparent 60%)',
          overflow: 'hidden',
        }}
      >
        <Svg3D key={preset} text={text} preset={preset} />
      </div>

      <p style={{ color: '#555', fontSize: 12, marginTop: 12 }}>
        Active preset: <code style={{ color: '#39ff14' }}>{preset}</code> ·
        Props: <code>{JSON.stringify(PRESETS[preset])}</code>
      </p>
    </main>
  );
}
