import { useEffect, useState } from 'react';
import { buildReport, clearReport, copyText, errorCount, onReport } from './lib/report';
import { useStore } from './store';

/** Always-visible bar: copy the plain-text report to paste into the Claude chat. */
export function ReportBar() {
  const device = useStore(s => s.device);
  const [, tick] = useState(0);
  const [msg, setMsg] = useState('');
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => onReport(() => tick(x => x + 1)), []);
  const errs = errorCount();
  return (
    <div className="reportbar">
      <button className="copy" onClick={async () => {
        const text = buildReport(device);
        const ok = await copyText(text);
        if (ok) { setMsg('복사됨 → Claude 대화창에 붙여넣기 하세요'); setFallback(null); }
        else { setMsg('자동 복사가 안 돼서 아래 글을 길게 눌러 전체 선택 후 복사하세요'); setFallback(text); }
        setTimeout(() => setMsg(''), 6000);
      }}>📋 결과 복사{errs ? ` (에러 ${errs})` : ''}</button>
      <button onClick={() => { if (confirm('지금까지 모은 결과·에러 기록을 지울까요?')) clearReport(); }}>기록 지우기</button>
      {msg && <span className="note">{msg}</span>}
      {fallback && <textarea readOnly rows={8} value={fallback} onFocus={e => e.currentTarget.select()} />}
    </div>
  );
}
