import React, { useEffect, useState } from 'react';
import { useSheetStore } from '../store/useSheetStore';
import { fetchTimeline, fetchHistoryState } from '../api/history';

export const HistoryPanel: React.FC = () => {
  const sheetId = useSheetStore(state => state.sheetId);
  const historyMode = useSheetStore(state => state.historyMode);
  const historyTimestamp = useSheetStore(state => state.historyTimestamp);
  const setHistoryMode = useSheetStore(state => state.setHistoryMode);
  const setHistoryState = useSheetStore(state => state.setHistoryState);
  
  const [timeline, setTimeline] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce for the slider
  const [sliderValue, setSliderValue] = useState<number>(0);

  useEffect(() => {
    if (historyMode && sheetId) {
      loadTimeline();
    }
  }, [historyMode, sheetId]);

  const loadTimeline = async () => {
    if (!sheetId) return;
    try {
      setLoading(true);
      setError(null);
      const times = await fetchTimeline(sheetId);
      // Ensure times is sorted ascending
      times.sort((a, b) => a - b);
      setTimeline(times);
      
      if (times.length > 0) {
        const latestTime = times[times.length - 1];
        setSliderValue(times.length - 1);
        await loadHistoryState(latestTime);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryState = async (timestamp: number) => {
    if (!sheetId) return;
    try {
      setLoading(true);
      setError(null);
      const cells = await fetchHistoryState(sheetId, timestamp);
      setHistoryState(timestamp, cells);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value, 10);
    setSliderValue(index);
    // Debouncing the API call would be better here for a fluid slider,
    // but for simplicity, we trigger on mouse up (onMouseUp) or onChange 
    // if we don't mind extra network requests. Let's do it onChange for now.
    const time = timeline[index];
    if (time) {
      loadHistoryState(time);
    }
  };

  if (!historyMode) {
    return (
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
        <button 
          onClick={() => setHistoryMode(true)}
          style={{ padding: '8px 12px', background: '#333', color: 'white', borderRadius: '4px', cursor: 'pointer', border: 'none' }}
        >
          View History
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
      background: 'white', padding: '15px 25px', borderRadius: '8px', 
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 10,
      width: '80%', maxWidth: '800px', display: 'flex', flexDirection: 'column', gap: '10px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>History Mode</h3>
        <button 
          onClick={() => setHistoryMode(false)}
          style={{ padding: '6px 12px', background: '#e0e0e0', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Exit History
        </button>
      </div>
      
      {error && <div style={{ color: 'red' }}>Error: {error}</div>}

      <div style={{ background: '#fff3cd', padding: '8px', borderRadius: '4px', fontSize: '13px', color: '#856404' }}>
        <strong>Note:</strong> Structural changes (row/col inserts) are not shown in history mode.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
        <input 
          type="range" 
          min={0} 
          max={Math.max(0, timeline.length - 1)} 
          value={sliderValue} 
          onChange={handleSliderChange}
          style={{ flexGrow: 1 }}
          disabled={timeline.length === 0 || loading}
        />
        <div style={{ width: '180px', textAlign: 'right' }}>
          {historyTimestamp ? new Date(historyTimestamp).toLocaleString() : 'No data'}
        </div>
      </div>
      
      {loading && <div style={{ fontSize: '12px', color: '#888' }}>Loading...</div>}
    </div>
  );
};
