import { useEffect, useState } from 'react';
import { probeDevice, summarize } from '../lib/device';
import { record, setState, useStore } from '../store';
import { Badge, KV, Section } from '../ui';

export function DevicePanel() {
  const d = useStore(s => s.device);
  const backend = useStore(s => s.backend);
  const [persistMsg, setPersistMsg] = useState('');

  const probe = async () => {
    const r = await probeDevice();
    setState({ device: r, backend: r.webgpu.available ? 'webgpu' : 'wasm' });
    await record('device', r as unknown as Record<string, unknown>);
  };
  useEffect(() => { if (!d) void probe(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <Section title="기기 확인">확인 중…</Section>;
  const s = summarize(d);
  return (
    <>
      <Section title="기기 확인 결과">
        <p>
          판정: <Badge tone={s.level === '가능' ? 'ok' : s.level === '제한' ? 'warn' : 'bad'}>{s.level}</Badge>
          {' '}<small>(이 판정은 기능 지원 여부만 봅니다. 실제 속도·메모리는 각 탭에서 실측해야 합니다.)</small>
        </p>
        {s.reasons.length > 0 && <ul>{s.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
        <KV rows={[
          ['User-Agent', <code>{d.userAgent}</code>],
          ['홈 화면 앱 모드', d.standalone ? '예' : '아니오(브라우저 탭)'],
          ['HTTPS(보안 컨텍스트)', String(d.secureContext)],
          ['crossOriginIsolated', `${d.crossOriginIsolated} ${d.crossOriginIsolated ? '(WASM 멀티스레드 가능)' : '(WASM 단일 스레드)'}`],
          ['CPU 코어', String(d.hardwareConcurrency ?? '알 수 없음')],
          ['기기 메모리(deviceMemory)', d.deviceMemoryGB != null ? `${d.deviceMemoryGB} GB (브라우저가 반올림·상한 적용)` : '알 수 없음(Safari 미제공)'],
          ['WebGPU', d.webgpu.available ? 'O' : `X — ${d.webgpu.error ?? ''}`],
          ['GPU 어댑터', d.webgpu.adapter ? `${d.webgpu.adapter.vendor} / ${d.webgpu.adapter.architecture} ${d.webgpu.adapter.device} ${d.webgpu.adapter.description}` : '—'],
          ['shader-f16', String(d.webgpu.shaderF16 ?? false)],
          ['maxBufferSize', d.webgpu.limits ? `${(d.webgpu.limits.maxBufferSize / 1048576).toFixed(0)} MB` : '—'],
          ['maxStorageBufferBindingSize', d.webgpu.limits ? `${(d.webgpu.limits.maxStorageBufferBindingSize / 1048576).toFixed(0)} MB` : '—'],
          ['WASM SIMD / 스레드 / JSPI', `${d.wasm.simd} / ${d.wasm.threads} / ${d.wasm.jspi}`],
          ['저장소 사용/할당', d.storage.quotaMB != null ? `${d.storage.usageMB} MB / ${d.storage.quotaMB} MB` : '알 수 없음'],
          ['영구 저장(persisted)', String(d.storage.persisted)],
          ['OPFS', String(d.storage.opfs)],
          ['마이크 API / AudioWorklet', `${d.media.getUserMedia} / ${d.media.audioWorklet}`],
          ['Screen Wake Lock', String(d.wakeLock)],
        ]} />
        <div className="row">
          <button onClick={probe}>다시 확인</button>
          <button onClick={async () => {
            const ok = await navigator.storage?.persist?.();
            setPersistMsg(ok ? '영구 저장 허용됨: 브라우저가 저장 공간 부족 시에도 모델을 임의 삭제하지 않도록 요청됨' : '영구 저장이 허용되지 않음(브라우저 정책). 모델이 자동 삭제될 수 있음');
            void probe();
          }}>영구 저장 요청</button>
        </div>
        {persistMsg && <p className="note">{persistMsg}</p>}
      </Section>
      <Section title="추론 백엔드 (ASR·번역)" note="ZONOS3-Mini TTS는 WebGPU 전용입니다. ASR·번역은 WebGPU/WASM을 비교할 수 있습니다.">
        <div className="row">
          {(['webgpu', 'wasm'] as const).map(b => (
            <label key={b} className="radio">
              <input type="radio" checked={backend === b} disabled={b === 'webgpu' && !d.webgpu.available}
                onChange={() => setState({ backend: b })} /> {b.toUpperCase()}
            </label>
          ))}
        </div>
      </Section>
    </>
  );
}
