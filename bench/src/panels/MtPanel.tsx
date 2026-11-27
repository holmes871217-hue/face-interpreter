import { useState } from 'react';
import { DIRECTIONS, LANG_LABEL, LANGS, type Lang } from '../data/languages';
import { SENTENCES } from '../data/sentences';
import { MT_CANDIDATES, loadMt, translate, unloadMt, type LoadProgress } from '../lib/engines';
import { currentSeq, entriesSince } from '../lib/net';
import { fmtMs, record, setState, useStore } from '../store';
import { ErrorBox, KV, Progress, Section } from '../ui';

interface Row { model: string; src: Lang; tgt: Lang; source: string; output: string; reference: string; ms: number; pivot?: string; tokens: number }

export function MtPanel() {
  const { mtId, backend, device, mtLoaded, mtPivot } = useStore(s => s);
  const cand = MT_CANDIDATES.find(c => c.id === mtId)!;
  const [prog, setProg] = useState<LoadProgress | null>(null);
  const [info, setInfo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(3);
  const [running, setRunning] = useState(false);
  const [free, setFree] = useState('');
  const [fs, setFs] = useState<Lang>('ko');
  const [ft, setFt] = useState<Lang>('ja');
  const f16 = !!device?.webgpu.shaderF16;
  const dev = cand.devices.includes(backend) ? backend : cand.devices[0];
  const loaded = mtLoaded.includes(cand.id);
  const unsupported = dev === 'webgpu' && (!device?.webgpu.available || (cand.kind === 'hymt' && !f16));

  const load = async () => {
    setErr(null); setProg({ loaded: 0, total: 0, files: 0, status: 'init' });
    try {
      const r = await loadMt(cand, dev, f16, setProg);
      setInfo(`${r.repo} · ${r.device} · dtype ${JSON.stringify(r.dtype)} · 로드 ${fmtMs(r.ms)}${r.cached ? ' (이미 로드됨)' : ''}`);
      setState(s => ({ mtLoaded: [...new Set([...s.mtLoaded, cand.id])] }));
      await record('load', { component: 'mt', model: cand.id, ...r });
    } catch (e) { setErr(String(e)); }
    setProg(null);
  };

  const run12 = async () => {
    setErr(null); setRunning(true); setRows([]);
    const seq = currentSeq();
    try {
      for (const [src, tgt] of DIRECTIONS) {
        for (const s of SENTENCES.slice(0, count)) {
          const r = await translate(cand, s[src], src, tgt, mtPivot);
          const row: Row = { model: cand.id, src, tgt, source: s[src], output: r.text, reference: s[tgt], ms: r.ms, pivot: r.pivot?.text, tokens: r.newTokens };
          setRows(x => [...x, row]);
          await record('mt', { ...row, pivotMode: mtPivot, backend: dev });
        }
      }
      await new Promise(res => setTimeout(res, 300));
      const net = entriesSince(seq).filter(e => !e.sameOrigin);
      await record('network', { during: 'mt-12-directions', crossOriginRequests: net.length });
      if (net.length) setErr(`주의: 번역 중 외부 요청 ${net.length}건 발생 (네트워크 탭 확인)`);
    } catch (e) { setErr(String(e)); }
    setRunning(false);
  };

  const stats = DIRECTIONS.map(([s, t]) => {
    const rs = rows.filter(r => r.src === s && r.tgt === t);
    return { s, t, n: rs.length, avg: rs.length ? rs.reduce((a, r) => a + r.ms, 0) / rs.length : NaN };
  });

  return (
    <>
      <Section title="번역 후보" note="모델을 임의 확정하지 않기 위해 후보별로 12개 방향을 같은 문장으로 비교합니다. 품질은 아래 표의 참조문과 비교해 사람이 판단합니다.">
        <div className="row">
          <select value={mtId} onChange={e => setState({ mtId: e.target.value })}>
            {MT_CANDIDATES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <label className="radio"><input type="checkbox" checked={mtPivot} onChange={e => setState({ mtPivot: e.target.checked })} />영어 경유(피벗) 번역</label>
        </div>
        <KV rows={[['다운로드(추정)', cand.approxMB], ['라이선스', cand.license], ['실행 장치', dev], ['비고', cand.note ?? '—']]} />
        {unsupported && <p className="error">이 기기에서는 실행 조건(WebGPU{cand.kind === 'hymt' ? ' + shader-f16' : ''})을 충족하지 않습니다.</p>}
        <div className="row">
          <button onClick={load} disabled={!!prog || unsupported}>모델 로드</button>
          <button onClick={async () => { await unloadMt(); setState({ mtLoaded: [] }); setInfo('언로드됨'); }}>번역 전체 언로드</button>
        </div>
        {prog && <Progress {...prog} label="번역" />}
        {info && <p className="note">{info}</p>}
        <ErrorBox error={err} />
      </Section>
      <Section title="직접 입력">
        <div className="row">
          <select value={fs} onChange={e => setFs(e.target.value as Lang)}>{LANGS.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}</select>
          →
          <select value={ft} onChange={e => setFt(e.target.value as Lang)}>{LANGS.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}</select>
        </div>
        <textarea value={free} onChange={e => setFree(e.target.value)} rows={2} placeholder="번역할 문장" />
        <button disabled={!loaded || !free.trim() || fs === ft} onClick={async () => {
          try {
            const r = await translate(cand, free.trim(), fs, ft, mtPivot);
            setRows(x => [{ model: cand.id, src: fs, tgt: ft, source: free.trim(), output: r.text, reference: '', ms: r.ms, pivot: r.pivot?.text, tokens: r.newTokens }, ...x]);
          } catch (e) { setErr(String(e)); }
        }}>번역</button>
      </Section>
      <Section title="12개 방향 일괄 테스트">
        <div className="row">
          문장 수 <input type="number" min={1} max={SENTENCES.length} value={count} onChange={e => setCount(Number(e.target.value))} style={{ width: 60 }} />
          <span className="note">(총 {12 * count}회 번역)</span>
          <button disabled={!loaded || running} onClick={run12}>{running ? `진행 중 ${rows.length}/${12 * count}` : '실행'}</button>
        </div>
        <table className="grid small">
          <thead><tr><th>방향</th><th>건수</th><th>평균 시간</th></tr></thead>
          <tbody>{stats.filter(s => s.n).map(s => <tr key={s.s + s.t}><td>{s.s}→{s.t}</td><td>{s.n}</td><td>{fmtMs(s.avg)}</td></tr>)}</tbody>
        </table>
        <table className="grid">
          <thead><tr><th>방향</th><th>원문</th><th>번역 결과</th><th>참조문</th><th>시간</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.src}→{r.tgt}</td><td>{r.source}</td>
                <td>{r.output}{r.pivot && <div className="note">(경유: {r.pivot})</div>}</td>
                <td className="muted">{r.reference}</td><td>{fmtMs(r.ms)}{r.tokens ? <div className="note">{r.tokens} tok</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}
