import { useEffect, useRef, useState } from 'react';
import { LANG_LABEL, LANGS, type Lang } from '../data/languages';
import { ENROLL_SCRIPT, SENTENCES } from '../data/sentences';
import { encodeWav, MicCapture } from '../lib/audio';
import { voices as voiceDb, type VoiceProfile } from '../lib/db';
import { ZONOS_SIZES_MB } from '../lib/models';
import { currentSeq, entriesSince } from '../lib/net';
import { AUTO_VOICE, VOICE_NAME, embedVoice, synthesizeVerified, listVoices, loadTts, synthesize, ttsFatal, type DefaultVoice, type EngineProgress, type TtsResult, type VoiceRef } from '../lib/tts';
import { fmtMs, record, setState, useStore } from '../store';
import { logError, logNote, logTts } from '../lib/report';
import { audioContext } from '../lib/audio';
import { Badge, ErrorBox, KV, Progress, Section } from '../ui';

export function useVoiceProfiles() {
  const [list, setList] = useState<VoiceProfile[]>([]);
  const refresh = async () => setList(await voiceDb.all());
  useEffect(() => { void refresh(); }, []);
  return { list, refresh };
}

export function voiceRefOf(sel: string, profiles: VoiceProfile[]): VoiceRef | null {
  if (sel === 'auto' || sel === '') return { kind: 'auto' };
  if (sel.startsWith('default:')) return { kind: 'default', id: sel.slice(8) };
  const p = profiles.find(x => x.id === sel);
  return p ? { kind: 'embedding', embedding: p.embedding } : null;
}

export function TtsPanel() {
  const { ttsLoaded, device } = useStore(s => s);
  const [prog, setProg] = useState<EngineProgress | null>(null);
  const [encProg, setEncProg] = useState<EngineProgress | null>(null);
  const [info, setInfo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<DefaultVoice[]>([]);
  const { list: profiles, refresh } = useVoiceProfiles();
  const [voiceSel, setVoiceSel] = useState('auto');
  const [laci, setLaci] = useState(true);
  const [stable, setStable] = useState(true);
  const [prebuf, setPrebuf] = useState(0.4);
  const [lang, setLang] = useState<Lang>('ja');
  const [text, setText] = useState(SENTENCES[0].ja);
  const [results, setResults] = useState<(TtsResult & { lang: Lang; voice: string; text: string; net: number; attempts?: number; rejected?: string[]; ok?: boolean })[]>([]);
  const [busy, setBusy] = useState(false);

  // enrolment
  const [role, setRole] = useState<'owner' | 'guest'>('owner');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [enrollLang, setEnrollLang] = useState<Lang>('ko');
  const [secs, setSecs] = useState(12);
  const [recState, setRecState] = useState<'idle' | 'rec' | 'proc'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const cap = useRef<MicCapture | null>(null);

  const load = async () => {
    setErr(null); setProg({ models: [], loaded: 0, total: 0, fetched: 0 });
    try {
      const r = await loadTts(setProg, setEncProg);
      const v = await listVoices();
      setDefaults(v);
      setState({ ttsLoaded: true });
      setInfo(`ZONOS3-Mini 엔진 준비 완료 · ${fmtMs(r.ms)} (다운로드 포함 여부는 네트워크 탭 참조) · 기본 음성 ${v.length}개`);
      await record('load', { component: 'tts', model: 'ZONOS3-Mini web', ms: r.ms, defaultVoices: v.length });
    } catch (e) {
      setErr(String(e) + (ttsFatal() ? `\n엔진: ${ttsFatal()}` : ''));
      logError('엔진 로드', ttsFatal() ? `${String(e)} / 엔진: ${ttsFatal()}` : e);
      setProg(null);
      return false;
    }
    setProg(null);
    return true;
  };

  /** One tap: unlock audio, load the engine if needed, then read the same sentence in all four languages (stable mode). */
  const oneTap = async () => {
    setErr(null);
    try { await audioContext(); } catch (e) { logError('오디오 시작', e); }
    setBusy(true);
    logNote('원클릭 테스트 시작');
    if (!ttsLoaded && !(await load())) { setBusy(false); return; }
    for (const l of LANGS) await speakOnce(SENTENCES[4][l], l, voiceSel, laci);
    logNote('원클릭 테스트 끝');
    setBusy(false);
  };

  const voiceLabel = (sel: string, l: Lang) => {
    if (sel === 'auto') { const id = AUTO_VOICE[l]; return VOICE_NAME[id] ?? (defaults.find(v => v.id === id)?.label ?? id).split(' ')[0]; }
    if (sel.startsWith('default:')) return VOICE_NAME[sel.slice(8)] ?? (defaults.find(v => 'default:' + v.id === sel)?.label ?? sel).split(' ')[0];
    return profiles.find(p => p.id === sel)?.name ?? sel;
  };

  const speakOnce = async (t: string, l: Lang, sel: string, useLaci: boolean, seed?: number, tag = '') => {
    const ref = voiceRefOf(sel, profiles);
    if (!ref) { setErr('출력 목소리를 선택하세요'); return; }
    const seq = currentSeq();
    try {
      const r = stable
        ? await synthesizeVerified(t, l, ref, { laci: useLaci, seed })
        : await synthesize(t, l, ref, { play: true, laci: useLaci, prebufferSec: prebuf, seed });
      await new Promise(res => setTimeout(res, 300));
      const net = entriesSince(seq).filter(e => !e.sameOrigin).length;
      const label = `${tag}${voiceLabel(sel, l)}${seed != null ? ` #${seed}` : ''}`;
      setResults(x => [{ ...r, lang: l, voice: label, text: t, net }, ...x]);
      const v = r as typeof r & { attempts?: number; rejected?: string[]; ok?: boolean; readyMs?: number };
      logTts({ at: new Date().toISOString(), lang: l, voice: label, chars: t.length, audioSec: r.audioSec, rmsDb: r.rmsDb, ok: v.ok,
        attempts: v.attempts, rejected: v.rejected, readyMs: v.readyMs, ttfaMs: r.ttfaMs, rtf: r.rtf, laci: r.laci });
      await record('tts', { ...r, lang: l, voice: label, chars: t.length, prebufferSec: prebuf, seed: seed ?? 1234, crossOriginDuring: net });
    } catch (e) {
      setErr(String(e) + (ttsFatal() ? `\n엔진: ${ttsFatal()}` : ''));
      logError(`합성 ${l}`, ttsFatal() ? `${String(e)} / 엔진: ${ttsFatal()}` : e);
    }
  };

  const speak = async (t: string, l: Lang) => {
    setBusy(true); setErr(null);
    await speakOnce(t, l, voiceSel, laci);
    setBusy(false);
  };

  /** Chinese diagnosis: voice x LACI x seed, so a listener can tell which factor breaks the take. */
  const zhDiag = async () => {
    setBusy(true); setErr(null);
    const t = SENTENCES[4].zh;
    const meilin = 'default:' + AUTO_VOICE.zh, haoran = 'default:default_d8a9b688b64e638d';
    const plan: [string, boolean, number, string][] = [
      [meilin, true, 1, 'A '], [meilin, false, 1, 'B '], [haoran, true, 1, 'C '], [haoran, false, 1, 'D '],
      [meilin, true, 2, 'E '], [meilin, true, 1, 'F '],   // F repeats A exactly: same seed should give the same take
    ];
    for (const [sel, useLaci, seed, tag] of plan) {
      await speakOnce(t, 'zh', sel, useLaci, seed, tag);
      await new Promise(res => setTimeout(res, 1200));   // a pause so each take can be told apart by ear
    }
    setBusy(false);
  };

  const enroll = async () => {
    if (role === 'guest' && !consent) { setErr('상대방 음성 등록 전에 본인 동의를 확인하세요.'); return; }
    setErr(null);
    try {
      cap.current = new MicCapture({ vad: false, hangoverMs: 0, maxMs: secs * 1000, onLevel: () => setElapsed(e => e) });
      const t0 = performance.now();
      const timer = setInterval(() => setElapsed((performance.now() - t0) / 1000), 200);
      const done = await cap.current.start();
      setRecState('rec');
      const r = await done;
      clearInterval(timer);
      setRecState('proc');
      const wav = encodeWav(r.pcm, r.sampleRate);
      const seq = currentSeq();
      const e = await embedVoice(wav, name || (role === 'owner' ? '앱 소유자' : '상대방'));
      // The raw recording is not kept: `r.pcm` and `wav` go out of scope here. Only the 192-d embedding is stored.
      const p: VoiceProfile = {
        id: crypto.randomUUID(), name: name || (role === 'owner' ? '앱 소유자' : '상대방'), role,
        consentAt: role === 'guest' ? new Date().toISOString() : null, createdAt: new Date().toISOString(),
        sampleSeconds: r.durationMs / 1000, embedding: e.embedding, embedMs: e.ms,
      };
      await voiceDb.put(p);
      await new Promise(res => setTimeout(res, 300));
      const net = entriesSince(seq).filter(x => !x.sameOrigin);
      await record('voice', { role, sampleSeconds: p.sampleSeconds, embedMs: e.ms, dim: e.embedding.length, crossOriginDuring: net.length, hosts: [...new Set(net.map(x => x.host))] });
      setInfo(`음성 프로필 생성: ${p.name} · 샘플 ${p.sampleSeconds.toFixed(1)} s · 임베딩 ${e.embedding.length}차원 · ${fmtMs(e.ms)}` +
        (net.length ? ` · 이 동안 외부 요청 ${net.length}건(최초 1회 화자 인코더 43 MB 다운로드일 수 있음: 네트워크 탭에서 확인)` : ' · 외부 요청 0건'));
      await refresh();
      setVoiceSel(p.id);
      setConsent(false);
    } catch (e) { setErr(String(e)); }
    setRecState('idle');
  };

  if (device && !device.webgpu.available) {
    return <Section title="음성 합성(TTS)"><p className="error">이 기기/브라우저는 WebGPU를 지원하지 않아 ZONOS3-Mini를 실행할 수 없습니다.</p></Section>;
  }

  return (
    <>
      <section className="card hero">
        <h2>원클릭 테스트</h2>
        <p className="note">한 번 누르면 엔진을 준비하고(처음 한 번만 몇 분) 같은 문장을 한국어·일본어·영어·중국어로 차례로 들려줍니다. 끝나면 맨 위 <b>📋 결과 복사</b>를 눌러 Claude 대화창에 붙여넣기 하세요.</p>
        <button className="big" disabled={busy || !!prog} onClick={oneTap}>{busy || prog ? '진행 중… 화면을 켜 두세요' : '▶ 원클릭 테스트'}</button>
        {prog && <Progress loaded={prog.loaded} total={prog.total} label={prog.models.join('+')} />}
      </section>

      <Section title="ZONOS3-Mini (WebGPU, 기기 내 실행)"
        note={`최초 로드 시 backbone ${ZONOS_SIZES_MB.backbone} MB + 코덱 ${ZONOS_SIZES_MB.zac} MB + 기본 음성 ${ZONOS_SIZES_MB.voices} MB를 Hugging Face에서 받아 Cache Storage에 저장합니다. 음성 등록 시 화자 인코더 ${ZONOS_SIZES_MB.spk} MB가 추가됩니다(임베딩 모드). 2.6 GB 레퍼런스 인코더는 사용하지 않습니다.`}>
        <div className="row">
          <button onClick={load} disabled={!!prog || ttsLoaded}>{ttsLoaded ? '로드됨' : '엔진 로드'}</button>
        </div>
        {prog && <Progress loaded={prog.loaded} total={prog.total} label={prog.models.join('+')} />}
        {encProg && encProg.loaded < encProg.total && <Progress loaded={encProg.loaded} total={encProg.total} label={encProg.models.join('+')} />}
        {info && <p className="note">{info}</p>}
        <ErrorBox error={err} />
      </Section>

      <Section title="출력 목소리">
        <select value={voiceSel} onChange={e => setVoiceSel(e.target.value)} disabled={!ttsLoaded}>
          <option value="auto">자동: 언어별 기본 음성 (일본어는 한국어 여성 음성)</option>
          <optgroup label="등록한 프로필(기기 내부)">
            {profiles.map(p => <option key={p.id} value={p.id}>{p.role === 'owner' ? '👤 ' : '🤝 '}{p.name}</option>)}
          </optgroup>
          <optgroup label="ZONOS 기본 음성">
            {defaults.map(v => <option key={v.id} value={'default:' + v.id}>{v.label}</option>)}
          </optgroup>
        </select>
        <div className="row">
          <select value={lang} onChange={e => { const l = e.target.value as Lang; setLang(l); setText(SENTENCES[0][l]); }}>
            {LANGS.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
          </select>
          {SENTENCES.slice(0, 6).map((s, i) => <button key={i} className="chip" onClick={() => setText(s[lang])}>{i + 1}</button>)}
          <button className="chip" disabled={!ttsLoaded || busy} onClick={zhDiag}>중국어 진단(A~F)</button>
        </div>
        <textarea rows={2} value={text} onChange={e => setText(e.target.value)} />
        <div className="row">
          <button disabled={!ttsLoaded || busy} onClick={() => speak(text, lang)}>{busy ? '합성 중…' : '▶ 합성·재생'}</button>
          <button disabled={!ttsLoaded || busy} onClick={async () => { for (const l of LANGS) await speak(SENTENCES[4][l], l); }}>4개 언어 연속 테스트</button>
        </div>
        <div className="row">
          <label className="radio"><input type="checkbox" checked={stable} onChange={e => setStable(e.target.checked)} /><b>안정 모드</b>(다 만든 뒤 검사, 잘림·무음이면 다시 만들어 재생)</label>
          <label className="radio"><input type="checkbox" checked={laci} onChange={e => setLaci(e.target.checked)} />LACI(말 늘어짐·잘림 방지)</label>
          재생 버퍼 <select value={prebuf} onChange={e => setPrebuf(Number(e.target.value))}>{[0, 0.2, 0.4, 0.8, 1.5].map(v => <option key={v} value={v}>{v} 초</option>)}</select>
        </div>
        <p className="note">브라우저 엔진에서는 텍스트 정규화(숫자→읽는 말)가 꺼져 있습니다(공식 README). 숫자는 글자로 풀어 쓰는 전처리가 필요할 수 있습니다.</p>
        <table className="grid">
          <thead><tr><th>언어</th><th>목소리</th><th>문장</th><th>첫 음성(TTFA)</th><th>스피커 출력 시작</th><th>합성 완료</th><th>음성 길이</th><th>RTF</th><th>음량</th><th>끊김</th><th>LACI</th><th>검사</th><th>외부요청</th></tr></thead>
          <tbody>{results.map((r, i) => (
            <tr key={i}><td>{r.lang}</td><td><b>{r.voice}</b></td><td>{r.text}</td><td>{fmtMs(r.ttfaMs)}</td><td>{fmtMs(r.firstPlayMs)}</td><td>{fmtMs(r.totalMs)}</td>
              <td>{r.audioSec.toFixed(1)} s</td><td className={r.rtf < 1 ? 'ok' : 'bad'}>{r.rtf.toFixed(2)}</td>
              <td className={r.rmsDb < -45 ? 'bad' : 'ok'}>{r.rmsDb.toFixed(0)} dB{r.rmsDb < -45 ? <div>거의 무음</div> : null}{r.nonFinite ? <div className="bad">깨진 값 {r.nonFinite}</div> : null}</td>
              <td className={r.underruns ? 'bad' : 'ok'}>{r.underruns}회{r.gapSec > 0.05 ? ` (${r.gapSec.toFixed(1)} s)` : ''}</td>
              <td>{r.laci ? 'O' : 'X'}{r.capped ? <div className="bad">길이 제한 도달</div> : null}</td>
              <td>{r.attempts == null ? '—' : <span className={r.ok ? 'ok' : 'bad'}>{r.ok ? '통과' : '실패'} ({r.attempts}번째){r.rejected?.length ? <div className="note">버림: {r.rejected.join(', ')}</div> : null}</span>}</td>
              <td className={r.net ? 'bad' : 'ok'}>{r.net}</td></tr>
          ))}</tbody>
        </table>
        <p className="note">음량: 보통 말소리는 -30 ~ -15 dB, -45 dB 아래는 거의 무음. 끊김 = 재생 도중 음성이 바닥나 멈춘 횟수(소리가 툭툭 끊기는 원인). RTF &lt; 1 이면 실시간보다 빠름. 첫 합성은 셰이더 컴파일 때문에 느릴 수 있으니 2회 이상 측정하세요.</p>
      </Section>

      <Section title="음성 프로필 등록" note="원본 녹음은 프로필 생성 직후 버립니다. 기기에는 192차원 화자 임베딩만 IndexedDB에 저장됩니다.">
        <div className="row">
          <label className="radio"><input type="radio" checked={role === 'owner'} onChange={() => setRole('owner')} />앱 소유자(기본)</label>
          <label className="radio"><input type="radio" checked={role === 'guest'} onChange={() => setRole('guest')} />상대방(선택)</label>
        </div>
        <input placeholder="이름(기기에만 저장)" value={name} onChange={e => setName(e.target.value)} />
        {role === 'guest' && (
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
            상대방 본인이 자신의 목소리를 이 기기에서 복제·합성하는 데 동의했습니다. (임베딩은 이 기기에만 저장되며 언제든 삭제할 수 있음)
          </label>
        )}
        <div className="row">
          읽을 문장 언어 <select value={enrollLang} onChange={e => setEnrollLang(e.target.value as Lang)}>{LANGS.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}</select>
          녹음 길이 <select value={secs} onChange={e => setSecs(Number(e.target.value))}>{[5, 8, 12, 20, 30].map(s => <option key={s} value={s}>{s}초</option>)}</select>
        </div>
        <p className="prompt">{ENROLL_SCRIPT[enrollLang]}</p>
        {recState === 'rec'
          ? <button className="big rec" onClick={() => cap.current?.stop('manual')}>● 녹음 중 {elapsed.toFixed(0)} / {secs} s (탭하면 종료)</button>
          : <button className="big" disabled={!ttsLoaded || recState !== 'idle'} onClick={enroll}>{recState === 'proc' ? '프로필 생성 중…' : '🎤 녹음 후 프로필 생성'}</button>}
        <p className="note">최적 녹음 길이는 Phase 0에서 5/8/12/20/30초로 각각 프로필을 만들어 유사도를 청취 비교해 정합니다.</p>
        <table className="grid">
          <thead><tr><th>구분</th><th>이름</th><th>샘플</th><th>생성</th><th>동의</th><th></th></tr></thead>
          <tbody>{profiles.map(p => (
            <tr key={p.id}>
              <td>{p.role === 'owner' ? <Badge tone="info">소유자</Badge> : <Badge tone="warn">상대방</Badge>}</td>
              <td>{p.name}</td><td>{p.sampleSeconds.toFixed(0)} s</td><td>{new Date(p.createdAt).toLocaleString()}</td>
              <td>{p.consentAt ? new Date(p.consentAt).toLocaleString() : '—'}</td>
              <td><button className="danger" onClick={async () => {
                if (!confirm(`'${p.name}' 프로필을 삭제할까요? 복구할 수 없습니다.`)) return;
                await voiceDb.remove(p.id); await refresh();
                const left = (await voiceDb.all()).some(x => x.id === p.id);
                await record('voice', { deleted: p.id, verifiedGone: !left });
              }}>삭제</button></td>
            </tr>
          ))}</tbody>
        </table>
        <KV rows={[['저장 위치', 'IndexedDB "interpreter-bench" / store "voices" (이 브라우저·이 기기 전용)'], ['주의', '브라우저 데이터 삭제·앱 제거 시 프로필은 복구할 수 없습니다.']]} />
      </Section>
    </>
  );
}
