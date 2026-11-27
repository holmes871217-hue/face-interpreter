import { useEffect, useState } from 'react';
import { results, voices, wipeEverything, type BenchRecord } from '../lib/db';
import { netSummary } from '../lib/net';
import { fmtMs, getState } from '../store';
import { KV, Section } from '../ui';

const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export function ResultsPanel() {
  const [list, setList] = useState<BenchRecord[]>([]);
  const [msg, setMsg] = useState('');
  const refresh = async () => setList(await results.all());
  useEffect(() => { void refresh(); }, []);

  const pipe = list.filter(r => r.kind === 'pipeline').map(r => r.data as { t: Record<string, number | null>; status: string });
  const ok = pipe.filter(p => p.status === '재생 완료');
  const m = (k: string) => median(ok.map(p => Number(p.t[k])).filter(x => isFinite(x)));
  const tts = list.filter(r => r.kind === 'tts').map(r => r.data as { ttfaMs: number; rtf: number });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), device: getState().device, network: netSummary(), records: list }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `phase0-results-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <>
      <Section title="측정 요약" note="중앙값 기준. 결과는 이 기기 IndexedDB에만 저장되며, 아래 버튼으로 직접 파일로 내보낼 때만 기기 밖으로 나갑니다.">
        <KV rows={[
          ['기록 건수', String(list.length)],
          ['통합 통역 성공 턴', `${ok.length} / ${pipe.length}`],
          ['발화 종료 감지', fmtMs(m('endDetect'))],
          ['ASR', fmtMs(m('asr'))],
          ['번역', fmtMs(m('mt'))],
          ['TTS 첫 음성(엔진)', fmtMs(m('ttfa'))],
          ['종료 결정 → 첫 소리', fmtMs(m('toFirstAudio'))],
          ['종료 결정 → 재생 끝', fmtMs(m('toPlaybackEnd'))],
          ['TTS 단독 TTFA / RTF', tts.length ? `${fmtMs(median(tts.map(t => t.ttfaMs)))} / ${median(tts.map(t => t.rtf)).toFixed(2)}` : '—'],
        ]} />
        <div className="row">
          <button onClick={exportJson}>결과 JSON 내보내기(파일 저장)</button>
          <button onClick={refresh}>새로고침</button>
        </div>
      </Section>
      <Section title="데이터 삭제 테스트" note="삭제 후 '다시 확인'으로 남은 데이터가 없는지 검증합니다.">
        <div className="row">
          <button className="danger" onClick={async () => {
            if (!confirm('음성 프로필과 측정 결과를 모두 삭제합니다. 복구할 수 없습니다.')) return;
            setMsg((await wipeEverything({ models: false })).join('\n')); await refresh();
          }}>프로필·결과 삭제</button>
          <button className="danger" onClick={async () => {
            if (!confirm('모델 캐시(수 GB)까지 모두 삭제합니다. 다시 쓰려면 재다운로드가 필요합니다.')) return;
            setMsg((await wipeEverything({ models: true })).join('\n')); await refresh();
          }}>모델 포함 전체 삭제</button>
          <button onClick={async () => {
            const v = await voices.all(); const r = await results.all(); const c = await caches.keys();
            setMsg(`남은 음성 프로필: ${v.length}건\n남은 결과: ${r.length}건\nCache Storage: ${c.join(', ') || '없음'}`);
          }}>다시 확인</button>
        </div>
        {msg && <pre className="note">{msg}</pre>}
      </Section>
      <Section title="원시 기록 (최근 50건)">
        <pre className="raw">{JSON.stringify(list.slice(-50).reverse(), null, 1)}</pre>
      </Section>
    </>
  );
}
