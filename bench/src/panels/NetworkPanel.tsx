import { useEffect, useState } from 'react';
import { clearNetLog, netSummary, onNet, setPolicy, type NetEntry, type Policy } from '../lib/net';
import { record } from '../store';
import { Badge, KV, Section } from '../ui';

export function NetworkPanel({ swState }: { swState: string }) {
  const [entries, setEntries] = useState<NetEntry[]>([]);
  const [policy, setP] = useState<Policy | null>(null);
  const [showSame, setShowSame] = useState(false);
  useEffect(() => onNet((e, p) => { setEntries([...e]); setP(p); }), []);
  const s = netSummary(entries);
  const list = entries.filter(e => showSame || !e.sameOrigin).slice(-300).reverse();

  return (
    <>
      <Section title="외부 전송 감시" note="서비스워커가 이 앱과 워커의 모든 HTTP 요청을 가로채 기록합니다. 외부로는 Hugging Face 모델 다운로드(GET)만 허용되며, 그 외 모든 외부 요청(POST 등)은 차단·기록됩니다.">
        <p>서비스워커: {swState === 'controlled' ? <Badge tone="ok">감시 중</Badge> : <Badge tone="bad">{swState} — 감시 불가</Badge>}</p>
        <KV rows={[
          ['전체 요청', String(s.total)],
          ['외부(cross-origin) 요청', String(s.crossOrigin)],
          ['외부로 본문을 보낸 요청', <span className={s.crossOriginWithBody ? 'bad' : 'ok'}>{s.crossOriginWithBody}</span>],
          ['외부 GET 이외 요청', <span className={s.crossOriginNonGet ? 'bad' : 'ok'}>{s.crossOriginNonGet}</span>],
          ['차단된 요청', String(s.blocked)],
          ['접속한 외부 호스트', s.hosts.join(', ') || '없음'],
          ['허용 목록 밖으로 리다이렉트', String(s.redirectWarnings)],
          ['외부에서 받은 양(Content-Length 합)', `${s.downloadedMB} MB`],
        ]} />
        <div className="row">
          <label className="radio"><input type="checkbox" checked={!!policy?.offlineSim} onChange={e => setPolicy({ offlineSim: e.target.checked })} />오프라인 시뮬레이션(모든 외부 요청 차단)</label>
          <label className="radio"><input type="checkbox" checked={policy?.coi ?? true} onChange={e => setPolicy({ coi: e.target.checked })} />교차 출처 격리(COOP/COEP, 다음 새로고침부터)</label>
        </div>
        <div className="row">
          <button onClick={() => record('network', { summary: s, policy })}>현재 요약을 결과에 기록</button>
          <button onClick={clearNetLog}>기록 지우기</button>
          <label className="radio"><input type="checkbox" checked={showSame} onChange={e => setShowSame(e.target.checked)} />앱 내부 파일 요청도 표시</label>
        </div>
        <p className="note">한계: 서비스워커는 WebSocket·WebRTC를 볼 수 없습니다. 이 앱 코드에는 둘 다 없고, 페이지 CSP(connect-src)로도 제한합니다. 완전한 확인은 PC에 연결한 원격 디버깅(Chrome DevTools / Safari Web Inspector)의 네트워크 탭 또는 기기 비행기 모드 테스트로 교차 검증하세요.</p>
      </Section>
      <Section title="요청 목록 (최근 300건)">
        <table className="grid small">
          <thead><tr><th>시각</th><th>방식</th><th>주소</th><th>상태</th><th>본문</th><th>비고</th></tr></thead>
          <tbody>{list.map(e => (
            <tr key={e.seq} className={e.blocked ? 'blocked' : ''}>
              <td>{new Date(e.t).toLocaleTimeString()}</td><td>{e.method}</td>
              <td className="url">{e.url}</td><td>{e.status ?? ''}</td><td>{e.reqBodyBytes ? `${e.reqBodyBytes} B` : ''}</td>
              <td>{e.blocked ? `차단: ${e.reason}` : e.warn ?? e.error ?? e.note ?? ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>
    </>
  );
}
