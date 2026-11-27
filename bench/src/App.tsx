import { useEffect, useState } from 'react';
import { registerSW } from './lib/net';
import { AsrPanel } from './panels/AsrPanel';
import { DevicePanel } from './panels/DevicePanel';
import { MtPanel } from './panels/MtPanel';
import { NetworkPanel } from './panels/NetworkPanel';
import { PipelinePanel } from './panels/PipelinePanel';
import { ResultsPanel } from './panels/ResultsPanel';
import { TtsPanel } from './panels/TtsPanel';
import { useStore } from './store';

const TABS = [
  ['device', '기기'], ['asr', '음성인식'], ['mt', '번역'], ['tts', '합성·음성'], ['pipe', '통합 통역'], ['net', '네트워크'], ['results', '결과'],
] as const;
type Tab = typeof TABS[number][0];

export function App() {
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem('tab') as Tab) || 'device'; } catch { return 'device'; }
  });
  const [sw, setSw] = useState('확인 중');
  const ready = {
    asr: useStore(s => Object.keys(s.asrLoaded).length > 0),
    mt: useStore(s => s.mtLoaded.length > 0),
    tts: useStore(s => s.ttsLoaded),
  };

  useEffect(() => { void registerSW().then(setSw); }, []);
  useEffect(() => { try { localStorage.setItem('tab', tab); } catch { /* private mode */ } }, [tab]);

  return (
    <div className="app">
      <header>
        <div>
          <h1>대면 통역 · Phase 0 기술 검증</h1>
          <div className="sub">모든 추론은 이 기기에서 실행 · 외부 전송 감시 {sw === 'controlled' ? 'ON' : `(${sw})`} · {navigator.onLine ? '온라인' : '오프라인'}</div>
        </div>
        <div className="pills">
          <span className={ready.asr ? 'on' : ''}>ASR</span><span className={ready.mt ? 'on' : ''}>MT</span><span className={ready.tts ? 'on' : ''}>TTS</span>
        </div>
      </header>
      <nav>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <main>
        {/* Panels stay mounted so loaded state and running tests survive tab switches. */}
        <div hidden={tab !== 'device'}><DevicePanel /></div>
        <div hidden={tab !== 'asr'}><AsrPanel /></div>
        <div hidden={tab !== 'mt'}><MtPanel /></div>
        <div hidden={tab !== 'tts'}><TtsPanel /></div>
        <div hidden={tab !== 'pipe'}><PipelinePanel /></div>
        <div hidden={tab !== 'net'}><NetworkPanel swState={sw} /></div>
        <div hidden={tab !== 'results'}><ResultsPanel /></div>
      </main>
      <footer>통역 중에는 화면을 켜 두세요. 화면이 꺼지거나 다른 앱으로 전환하면 브라우저가 처리를 멈출 수 있습니다.</footer>
    </div>
  );
}
