import { useRef, useState } from 'react';
import { LANG_LABEL, LANGS, type Lang } from '../data/languages';
import { MicCapture, resample, trimToSpeech } from '../lib/audio';
import { ASR_CANDIDATES, MT_CANDIDATES, runAsr, translate } from '../lib/engines';
import { currentSeq, entriesSince } from '../lib/net';
import { synthesize } from '../lib/tts';
import { fmtMs, record, setState, useStore } from '../store';
import { ErrorBox, Section } from '../ui';
import { useVoiceProfiles, voiceRefOf } from './TtsPanel';

type Phase = 'idle' | 'listening' | 'asr' | 'mt' | 'tts' | 'speaking';
interface Turn {
  id: number; side: 'A' | 'B'; src: Lang; tgt: Lang; source: string; translation: string; voice: string;
  t: { endDetect: number | null; prep: number; asr: number; mt: number; ttfa: number; firstPlay: number | null; toFirstAudio: number | null; toPlaybackEnd: number | null };
  net: number; status: string;
}

export function PipelinePanel() {
  const { langA, langB, asrId, mtId, mtPivot, mtNoRepeat, asrLoaded, mtLoaded, ttsLoaded, hangoverMs } = useStore(s => s);
  const { list: profiles } = useVoiceProfiles();
  const [voiceAB, setVoiceAB] = useState('auto');
  const [voiceBA, setVoiceBA] = useState('auto');
  const [phase, setPhase] = useState<Phase>('idle');
  const [side, setSide] = useState<'A' | 'B' | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const cap = useRef<MicCapture | null>(null);
  const abort = useRef<AbortController | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const nextId = useRef(1);
  const upsert = (r: Turn) => setTurns(x => x.some(y => y.id === r.id) ? x.map(y => y.id === r.id ? { ...r, t: { ...r.t } } : y) : [{ ...r, t: { ...r.t } }, ...x]);

  const asr = ASR_CANDIDATES.find(c => c.id === asrId)!;
  const mt = MT_CANDIDATES.find(c => c.id === mtId)!;
  const asrReady = asr.kind === 'whisper' ? (asrLoaded[asrId]?.length ?? 0) > 0 : [langA, langB].every(l => asrLoaded[asrId]?.includes(l));
  const ready = asrReady && mtLoaded.includes(mtId) && ttsLoaded;
  const voiceOptions = [
    ...profiles.map(p => ({ v: p.id, l: `${p.role === 'owner' ? '👤' : '🤝'} ${p.name}` })),
    { v: 'auto', l: '자동: 언어별 기본 음성' },
  ];

  const keepAwake = async () => {
    try { if ('wakeLock' in navigator && !wake.current) wake.current = await navigator.wakeLock.request('screen'); } catch { /* denied */ }
  };

  const turn = async (s: 'A' | 'B') => {
    if (phase !== 'idle') return;
    setErr(null); setSide(s); void keepAwake();
    const src = s === 'A' ? langA : langB, tgt = s === 'A' ? langB : langA;
    const vsel = s === 'A' ? voiceAB : voiceBA;
    const ref = voiceRefOf(vsel, profiles) ?? { kind: 'auto' as const };
    const seq = currentSeq();
    const t: Turn['t'] = { endDetect: null, prep: 0, asr: 0, mt: 0, ttfa: 0, firstPlay: null, toFirstAudio: null, toPlaybackEnd: null };
    const row: Turn = { id: nextId.current++, side: s, src, tgt, source: '', translation: '', voice: ref.kind, t, net: 0, status: '' };
    try {
      setPhase('listening');
      cap.current = new MicCapture({ vad: true, hangoverMs, maxMs: 20000, onLevel: r => setLevel(r) });
      const done = await cap.current.start();
      const r = await done;
      if (r.stoppedBy === 'abort') throw new Error('중단됨');
      t.endDetect = r.endDetectMs;
      const tEnd = performance.now();   // the moment the utterance end was decided
      setPhase('asr');
      const pcm16 = await resample(trimToSpeech(r), r.sampleRate, 16000);
      t.prep = performance.now() - tEnd;
      const a = await runAsr(asr, src, pcm16);
      t.asr = a.ms; row.source = a.text;
      if (!a.text) throw new Error('인식된 말이 없습니다');
      upsert(row);
      setPhase('mt');
      const m = await translate(mt, a.text, src, tgt, mtPivot, mtNoRepeat);
      t.mt = m.ms; row.translation = m.text;
      upsert(row);
      setPhase('tts');
      abort.current = new AbortController();
      const tTts = performance.now();
      // Microphone is closed at this point; nothing records while the translation is played (echo prevention).
      const p = synthesize(m.text, tgt, ref, { play: true, signal: abort.current.signal });
      setPhase('speaking');
      const tr = await p;
      t.ttfa = tr.ttfaMs;
      t.firstPlay = tr.firstPlayMs;
      t.toFirstAudio = tr.firstPlayMs != null ? tTts - tEnd + tr.firstPlayMs : null;
      t.toPlaybackEnd = tr.playbackEndMs != null ? tTts - tEnd + tr.playbackEndMs : null;
      row.status = '재생 완료';
    } catch (e) {
      row.status = '실패: ' + (e instanceof Error ? e.message : String(e));
      if (!String(e).includes('중단')) setErr(String(e));
    }
    await new Promise(res => setTimeout(res, 300));
    row.net = entriesSince(seq).filter(x => !x.sameOrigin).length;
    upsert(row);
    await record('pipeline', { ...row, asr: asr.id, mt: mt.id, pivot: mtPivot });
    setPhase('idle'); setSide(null); abort.current = null;
  };

  const stopAll = () => { cap.current?.stop('abort'); abort.current?.abort(); };
  const busy = phase !== 'idle';
  const phaseLabel: Record<Phase, string> = { idle: '대기', listening: '🎤 듣는 중', asr: '인식 중', mt: '번역 중', tts: '합성 중', speaking: '🔊 재생 중(마이크 꺼짐)' };

  return (
    <>
      <Section title="통합 통역 테스트 (교대 발화)" note="ASR·번역·TTS 탭에서 각 모델을 먼저 로드하세요. 이 화면의 측정값이 Phase 0 지연 시간 기록입니다.">
        <div className="row">
          A <select value={langA} onChange={e => setState({ langA: e.target.value as Lang })} disabled={busy}>{LANGS.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}</select>
          <button className="chip" disabled={busy} onClick={() => setState({ langA: langB, langB: langA })}>⇄</button>
          B <select value={langB} onChange={e => setState({ langB: e.target.value as Lang })} disabled={busy}>{LANGS.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}</select>
        </div>
        <div className="row">
          <label>A→B 목소리 <select value={voiceAB} onChange={e => setVoiceAB(e.target.value)}>{voiceOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
          <label>B→A 목소리 <select value={voiceBA} onChange={e => setVoiceBA(e.target.value)}>{voiceOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
        </div>
        <div className="row">
          종료 감지 대기 <select value={hangoverMs} onChange={e => setState({ hangoverMs: Number(e.target.value) })}>{[400, 550, 700, 900, 1200].map(v => <option key={v} value={v}>{v} ms</option>)}</select>
          <span className="note">ASR {asr.id} · 번역 {mt.id}{mtPivot ? '(영어 경유)' : ''}</span>
        </div>
        {!ready && <p className="error">준비 안 됨: {!asrReady && `ASR(${asr.kind === 'moonshine' ? `${langA}, ${langB} 각각` : '1개'}) `}{!mtLoaded.includes(mtId) && '번역 '}{!ttsLoaded && 'TTS'}</p>}
        <div className="status">상태: <b>{phaseLabel[phase]}</b>{side && ` (${side} 측)`} <div className="meter inline"><div style={{ width: `${Math.min(100, level * 600)}%` }} /></div></div>
        <div className="ab">
          <button className={`side a ${side === 'A' && phase === 'listening' ? 'live' : ''}`} disabled={!ready || (busy && !(side === 'A' && phase === 'listening'))}
            onClick={() => phase === 'listening' ? cap.current?.stop('manual') : turn('A')}>
            A 말하기<br /><small>{LANG_LABEL[langA]} → {LANG_LABEL[langB]}</small>
          </button>
          <button className={`side b ${side === 'B' && phase === 'listening' ? 'live' : ''}`} disabled={!ready || (busy && !(side === 'B' && phase === 'listening'))}
            onClick={() => phase === 'listening' ? cap.current?.stop('manual') : turn('B')}>
            B 말하기<br /><small>{LANG_LABEL[langB]} → {LANG_LABEL[langA]}</small>
          </button>
        </div>
        <div className="row">
          <button className="danger" disabled={!busy} onClick={stopAll}>통역 중단</button>
          <button onClick={() => setTurns([])}>대화 내역 삭제</button>
        </div>
        <ErrorBox error={err} />
      </Section>
      <Section title="대화 내역 및 지연 시간">
        {turns.map(r => (
          <div key={r.id} className={`turn ${r.side === 'A' ? 'a' : 'b'}`}>
            <div className="who">{r.side} 측 · {r.src}→{r.tgt} · 목소리: {r.voice === 'embedding' ? '등록 프로필' : '기본'} · {r.status || '진행 중'}</div>
            <div className="src">{r.source}</div>
            <div className="dst">{r.translation}</div>
            <div className="timing">
              종료감지 {fmtMs(r.t.endDetect)} · 전처리 {fmtMs(r.t.prep)} · ASR {fmtMs(r.t.asr)} · 번역 {fmtMs(r.t.mt)} · TTS 첫 음성 {fmtMs(r.t.ttfa)} ·
              <b> 말 끝→첫 소리 {fmtMs(r.t.toFirstAudio != null && r.t.endDetect != null ? r.t.toFirstAudio + r.t.endDetect : r.t.toFirstAudio)}</b>
              {' '}(종료감지 포함) · 재생 끝까지 {fmtMs(r.t.toPlaybackEnd)} · 외부요청 <span className={r.net ? 'bad' : 'ok'}>{r.net}</span>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
