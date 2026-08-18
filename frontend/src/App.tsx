import React, { useState } from 'react';
import { useSheetStore } from './store/useSheetStore';
import { HandRolledGrid } from './components/HandRolledGrid';
import { ReactWindowGrid } from './components/ReactWindowGrid';
import './App.css';

function App() {
  const seedGrid = useSheetStore(state => state.seedGrid);
  const rows = useSheetStore(state => state.rows);
  const error = useSheetStore(state => state.error);
  const [useReactWindow, setUseReactWindow] = useState(false);

  const handleSeed = () => {
    seedGrid(10000, 26); // 10k rows, 26 cols
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', boxSizing: 'border-box' }}>
      <header style={{ padding: '10px', background: '#f5f5f5', borderBottom: '1px solid #ddd', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '15px' }}>
        <h1 style={{ margin: 0, fontSize: '1.2rem' }}>GridSync</h1>
        
        {import.meta.env.DEV && (
          <button onClick={handleSeed} style={{ padding: '5px 10px', background: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            [DEV] Seed 10k Rows
          </button>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <input 
            type="checkbox" 
            checked={useReactWindow} 
            onChange={(e) => setUseReactWindow(e.target.checked)} 
          />
          Use react-window
        </label>
        
        {error && (
          <span style={{ color: 'red', fontWeight: 'bold' }}>
            Error: {error}
          </span>
        )}
      </header>
      
      <main style={{ flexGrow: 1, overflow: 'hidden', position: 'relative' }}>
        <React.Profiler id="GridProfiler" onRender={(id, phase, actualDuration) => {
          console.log(`[PROFILER] ${useReactWindow ? 'ReactWindow' : 'HandRolled'} ${phase} duration: ${actualDuration.toFixed(2)}ms`);
        }}>
          {rows.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <p>No data. Click Seed to generate.</p>
            </div>
          ) : (
            useReactWindow ? <ReactWindowGrid /> : <HandRolledGrid />
          )}
        </React.Profiler>
      </main>
    </div>
  );
}

export default App;
