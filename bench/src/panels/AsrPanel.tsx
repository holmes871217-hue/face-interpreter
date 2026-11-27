import { useRef, useState } from 'react';
import { LANG_LABEL, LANGS, type Lang } from '../data/languages';
import { ASR_PROMPTS } from '../data/sentences';
import { MicCapture, resample, trimToSpeech, type CaptureResult } from '../lib/audio';
import { ASR_CANDIDATES, loadAsr, runAsr, unloadAsr, type LoadProgress } from '../lib/engines';
import { currentSeq, entriesSince } from '../lib/net';
import { fmtMs, record, setState, useStore } from '../store';
import { ErrorBox, KV, Progress, Section } from '../ui';

interface Row { model: string; lang: Lang; ref: string; text: string; asrMs: number; audioSec: number; endDetectMs: number | null; netDuring: number }

/** Character error rate against the prompt (rough: punctuation/space stripped, case-folded). */
export function cer(ref: string, hyp: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const a = [...norm(ref)], b = [...norm(hyp)];
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / a.length;
}

export function AsrPanel() {
  const { asrId, backend, device, asrLoaded, hangoverMs } = useStore(s => s);
  const [lang, setLang] = useState<Lang>('ko');
  const [prompt, setPrompt] = useState(0);
  const [prog, setProg] = useState<LoadProgress | null>(null);
  const [loadInfo, setLoadInfo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [rec, setRec] = useState<'idle' | 'rec' | 'proc'>('idle');
  const [level, setLevel] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const cap = useRef<MicCapture | null>(null);
  const cand = ASR_CANDIDATES.find(c => c.id === asrId)!;
  const f16 = !!device?.webgpu.shaderF16;
  const loadedForLang = asrLoaded[asrId]?.includes(lang) || (cand.kind === 'whisper' && (asrLoaded[asrId]?.length ?? 0) > 0);

  const load = async () => {
    setErr(null); setProg({ loaded: 0, total: 0, files: 0, status: 'init' });
    try {
      const r = await loadAsr(cand, lang, backend, f16, setProg);
      setLoadInfo(`${r.repo} · ${r.device} · dtype ${JSON.stringify(r.dtype)} · 로드 ${fmtMs(r.ms)}${r.warmupMs != null ? ` · 워밍업 ${fmtMs(r.warmupMs)}` : ''}${r.cached ? ' (이미 로드됨)' : ''}`);
      setState(s => ({ asrLoaded: { ...s.asrLoaded, [asrId]: [...new Set([...(s.asrLoaded[asrId] ?? []), lang])] } }));
      await record('load', { component: 'asr', model: cand.id, lang, ...r });
    } catch (e) { setErr(String(e)); }
    setProg(null);
  };

  const startRec = async () => {
    setErr(null);
    try {
      cap.current = new MicCapture({ vad: true, hangoverMs, maxMs: 15000, onLevel: r => setLevel(r) });
      const done = await cap.current.start();
      setRec('rec');
      const r: CaptureResult = await done;
      setRec('proc');
      const seq = currentSeq();
      const pcm16 = await resample(trimToSpeech(r), r.sampleRate, 16000);
      const out = await runAsr(cand, lang, pcm16);
      await new Promise(res => setTimeout(res, 300));
      const net = entriesSince(seq).filter(e => !e.sameOrigin).length;
      const ref = ASR_PROMPTS[lang][prompt];
      const row: Row = { model: cand.id, lang, ref, text: out.text, asrMs: out.ms, audioSec: out.audioSec, endDetectMs: r.endDetectMs, netDuring: net };
      setRows(x => [row, ...x]);
      await record('asr', { ...row, cer: cer(ref, out.text), backend, stoppedBy: r.stoppedBy });
    } catch (e) { setErr(String(e)); }
    setRec('idle');
  };

  return (
    <>
      <Section title="음성 인식(ASR) 후보" note="발화 버튼으로 언어가 정해지므로 Whisper는 언어를 고정해 실행합니다(자동 감지 없음).">
        <div className="row">
          <select value={asrId} onChange={e => setState({ asrId: e.target.value })}>
            {ASR_CANDIDATES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select value={lang} onChange={e => { setLang(e.target.value as Lang); setPrompt(0); }}>
            {LANGS.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
          </select>
        </div>
        <KV rows={[['다운로드(추정)', cand.approxMB], ['라이선스', cand.license], ['비고', cand.note ?? '—']]} />
        <div className="row">
          <button onClick={load} disabled={!!prog}>모델 로드{cand.kind === 'moonshine' ? ` (${LANG_LABEL[lang]})` : ''}</button>
          <button onClick={async () => { await unloadAsr(); setState({ asrLoaded: {} }); setLoadInfo('언로드됨'); }}>ASR 전체 언로드</button>
        </div>
        {prog && <Progress {...prog} label="ASR" />}
        {loadInfo && <p className="note">{loadInfo}</p>}
        <ErrorBox error={err} />
      </Section>
      <Section title="인식 테스트" note={`아래 문장을 소리 내어 읽으세요. 말을 멈추고 ${hangoverMs} ms 뒤 자동 종료됩니다.`}>
        <div className="row">
          {ASR_PROMPTS[lang].map((p, i) => (
            <label key={i} className="radio"><input type="radio" checked={prompt === i} onChange={() => setPrompt(i)} />{i + 1}</label>
          ))}
        </div>
        <p className="prompt">{ASR_PROMPTS[lang][prompt]}</p>
        <div className="row">
          {rec === 'rec'
            ? <button className="big rec" onClick={() => cap.current?.stop('manual')}>● 녹음 중 (탭하면 종료)</button>
            : <button className="big" disabled={!loadedForLang || rec !== 'idle'} onClick={startRec}>{rec === 'proc' ? '인식 중…' : '🎤 녹음 시작'}</button>}
          <div className="meter"><div style={{ width: `${Math.min(100, level * 600)}%` }} /></div>
        </div>
        {!loadedForLang && <p className="note">먼저 모델을 로드하세요.</p>}
        <table className="grid">
          <thead><tr><th>모델</th><th>언어</th><th>인식 결과</th><th>CER</th><th>ASR</th><th>음성 길이</th><th>종료 감지</th><th>추론 중 외부요청</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.model}</td><td>{r.lang}</td><td>{r.text || <i>(빈 결과)</i>}</td>
                <td>{(cer(r.ref, r.text) * 100).toFixed(0)}%</td><td>{fmtMs(r.asrMs)}</td><td>{r.audioSec.toFixed(1)} s</td>
                <td>{fmtMs(r.endDetectMs)}</td><td className={r.netDuring ? 'bad' : 'ok'}>{r.netDuring}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">CER은 읽은 문장과의 문자 오류율(문장부호·공백 제외)로 참고용입니다. 읽기 실수도 오류로 계산됩니다.</p>
      </Section>
    </>
  );
}
