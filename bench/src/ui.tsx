import type { ReactNode } from 'react';

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {note && <p className="note">{note}</p>}
      {children}
    </section>
  );
}

export function Progress({ loaded, total, label }: { loaded: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)}>
      <div className="bar" style={{ width: `${pct}%` }} />
      <span>{label ?? ''} {total > 0 ? `${(loaded / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB (${pct.toFixed(0)}%)` : '준비 중…'}</span>
    </div>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="kv"><tbody>
      {rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
    </tbody></table>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <pre className="error">{error}</pre>;
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
