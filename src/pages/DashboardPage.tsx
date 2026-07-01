import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '../context/ToastContext';
import { listenSessions } from '../services/sessions';
import { listenAllAttendance } from '../services/attendance';
import type { Attendance, Session } from '../types';
import {
  SESSION_TYPE_LABELS,
  SESSION_TYPE_SHORT,
  MODALITY_LABELS,
} from '../lib/constants';
import { fmtDate, fmtDateLong, toDate, MONTH_NAMES } from '../lib/dates';
import { exportCSV, exportPDF } from '../lib/export';
import { normalizeText } from '../lib/normalize';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { TypeBadge, ModalityBadge } from '../components/badges';
import { DownloadIcon, ChartIcon, SearchIcon } from '../components/Icons';

type Tab = 'ranking' | 'resumen' | 'sesion';

interface PersonAgg {
  memberId: string;
  fullName: string;
  pasos: number;
  ego: number;
  total: number;
}

export function DashboardPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('ranking');

  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let ready = 0;
    const done = () => {
      ready++;
      if (ready >= 2) setLoading(false);
    };
    const u1 = listenSessions(
      (list) => {
        setSessions(list);
        done();
      },
      (e) => {
        console.error(e);
        toast('No se pudo cargar el panel.', 'error');
        done();
      },
    );
    const u2 = listenAllAttendance(
      (list) => {
        setAttendance(list);
        done();
      },
      (e) => {
        console.error(e);
        toast('No se pudo cargar la asistencia.', 'error');
        done();
      },
    );
    return () => {
      u1();
      u2();
    };
  }, [toast]);

  const years = useMemo(() => {
    const set = new Set<number>();
    sessions.forEach((s) => set.add(toDate(s.date).getFullYear()));
    attendance.forEach((a) => set.add(toDate(a.sessionDate).getFullYear()));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [sessions, attendance]);

  const yearAtt = useMemo(
    () => attendance.filter((a) => toDate(a.sessionDate).getFullYear() === year),
    [attendance, year],
  );
  const yearSessions = useMemo(
    () => sessions.filter((s) => toDate(s.date).getFullYear() === year),
    [sessions, year],
  );

  // Agregado por persona (para el ranking y el detalle).
  const perPerson = useMemo<PersonAgg[]>(() => {
    const map = new Map<string, PersonAgg>();
    for (const a of yearAtt) {
      let e = map.get(a.memberId);
      if (!e) {
        e = { memberId: a.memberId, fullName: a.fullName, pasos: 0, ego: 0, total: 0 };
        map.set(a.memberId, e);
      }
      if (a.sessionType === 'entrega_pasos') e.pasos++;
      else if (a.sessionType === 'reduccion_ego') e.ego++;
      e.total++;
    }
    return [...map.values()].sort(
      (a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName, 'es'),
    );
  }, [yearAtt]);

  const groups = useMemo(() => {
    let ambas = 0;
    let soloPasos = 0;
    let soloEgo = 0;
    for (const p of perPerson) {
      if (p.pasos > 0 && p.ego > 0) ambas++;
      else if (p.pasos > 0) soloPasos++;
      else if (p.ego > 0) soloEgo++;
    }
    return { ambas, soloPasos, soloEgo };
  }, [perPerson]);

  const yearSelector = (
    <select
      className="input w-28 py-2"
      value={year}
      onChange={(e) => setYear(Number(e.target.value))}
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-primary-900">Panel de asistencia</h2>

      <div className="flex gap-1 rounded-xl bg-primary-100/60 p-1 text-sm">
        {(
          [
            ['ranking', '🏆 Ranking'],
            ['resumen', 'Resumen'],
            ['sesion', 'Por sesión'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 font-medium transition ${
              tab === key ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : tab === 'ranking' ? (
        <RankingView
          perPerson={perPerson}
          groups={groups}
          year={year}
          yearSelector={yearSelector}
          onSelect={setSelectedId}
        />
      ) : tab === 'resumen' ? (
        <ResumenView
          yearAtt={yearAtt}
          yearSessions={yearSessions}
          uniquePeople={perPerson.length}
          year={year}
          yearSelector={yearSelector}
        />
      ) : (
        <BySessionView sessions={sessions} attendance={attendance} />
      )}

      {/* Detalle de una persona */}
      <PersonModal
        memberId={selectedId}
        onClose={() => setSelectedId(null)}
        attendance={yearAtt}
        totalSessions={yearSessions.length}
        year={year}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4 text-center">
      <p className="text-2xl font-bold text-primary-700">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RANKING                                                             */
/* ------------------------------------------------------------------ */
function RankingView({
  perPerson,
  groups,
  year,
  yearSelector,
  onSelect,
}: {
  perPerson: PersonAgg[];
  groups: { ambas: number; soloPasos: number; soloEgo: number };
  year: number;
  yearSelector: ReactNode;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return perPerson;
    return perPerson.filter((p) => normalizeText(p.fullName).includes(q));
  }, [perPerson, query]);

  const doExport = (kind: 'csv' | 'pdf') => {
    const rows = perPerson.map((p, i) => ({
      Puesto: i + 1,
      Nombre: p.fullName,
      Total: p.total,
      Pasos: p.pasos,
      Ego: p.ego,
    }));
    if (kind === 'csv') {
      exportCSV(`ranking-asistencia-${year}`, rows);
    } else {
      exportPDF({
        title: `Ranking de asistencia ${year}`,
        subtitle: 'Gimnasio Emocional Mentes Brillantes',
        columns: ['#', 'Nombre', 'Total', 'Pasos', 'Ego'],
        rows: perPerson.map((p, i) => [i + 1, p.fullName, p.total, p.pasos, p.ego]),
        filename: `ranking-asistencia-${year}`,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Quién ha asistido más en el año</p>
        {yearSelector}
      </div>

      {/* Resumen de participación */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Fueron a las dos" value={groups.ambas} />
        <StatCard label="Solo Pasos" value={groups.soloPasos} />
        <StatCard label="Solo Ego" value={groups.soloEgo} />
      </div>

      {perPerson.length === 0 ? (
        <EmptyState icon={<ChartIcon />} title={`Sin asistencias en ${year}`} />
      ) : (
        <>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400" />
            <input
              className="input pl-11"
              placeholder="Buscar persona en el ranking…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button onClick={() => doExport('csv')} className="btn-secondary flex-1">
              <DownloadIcon className="text-lg" /> CSV
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary flex-1">
              <DownloadIcon className="text-lg" /> PDF
            </button>
          </div>

          <ul className="space-y-2">
            {filtered.map((p) => {
              const rank = perPerson.indexOf(p) + 1;
              const medal =
                rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
              return (
                <li key={p.memberId}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.memberId)}
                    className="flex w-full items-center gap-3 rounded-xl border border-primary-100 bg-white p-3 text-left active:scale-[.99]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-bold text-primary-700">
                      {medal ?? rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-800">
                        {p.fullName}
                      </p>
                      <p className="text-xs text-slate-400">
                        Pasos: {p.pasos} · Ego: {p.ego}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-primary-700">{p.total}</p>
                      <p className="text-[10px] uppercase text-slate-400">veces</p>
                    </div>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">
                Nadie coincide con “{query}”.
              </p>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RESUMEN                                                             */
/* ------------------------------------------------------------------ */
function ResumenView({
  yearAtt,
  yearSessions,
  uniquePeople,
  year,
  yearSelector,
}: {
  yearAtt: Attendance[];
  yearSessions: Session[];
  uniquePeople: number;
  year: number;
  yearSelector: ReactNode;
}) {
  const byType = useMemo(() => {
    const t = { entrega_pasos: 0, reduccion_ego: 0 };
    yearAtt.forEach((a) => {
      t[a.sessionType]++;
    });
    return t;
  }, [yearAtt]);
  const byModality = useMemo(() => {
    const m = { presencial: 0, virtual: 0 };
    yearAtt.forEach((a) => {
      m[a.modality]++;
    });
    return m;
  }, [yearAtt]);
  const byMonth = useMemo(() => {
    const arr = new Array(12).fill(0) as number[];
    yearAtt.forEach((a) => {
      arr[toDate(a.sessionDate).getMonth()]++;
    });
    return arr.map((value, i) => ({ label: MONTH_NAMES[i], value }));
  }, [yearAtt]);
  const maxMonth = Math.max(1, ...byMonth.map((d) => d.value));

  const doExport = (kind: 'csv' | 'pdf') => {
    const rows = [
      { Métrica: 'Total de asistencias', Valor: yearAtt.length },
      { Métrica: 'Personas distintas', Valor: uniquePeople },
      { Métrica: 'Reuniones realizadas', Valor: yearSessions.length },
      { Métrica: 'Asistencias a Entrega de Pasos', Valor: byType.entrega_pasos },
      { Métrica: 'Asistencias a Reducción del Ego', Valor: byType.reduccion_ego },
      { Métrica: 'Asistencias presenciales', Valor: byModality.presencial },
      { Métrica: 'Asistencias virtuales', Valor: byModality.virtual },
      ...byMonth.map((m) => ({ Métrica: `Asistencias en ${m.label}`, Valor: m.value })),
    ];
    if (kind === 'csv') exportCSV(`resumen-${year}`, rows);
    else
      exportPDF({
        title: `Resumen de asistencia ${year}`,
        subtitle: 'Gimnasio Emocional Mentes Brillantes',
        columns: ['Dato', 'Valor'],
        rows: rows.map((r) => [r.Métrica, r.Valor]),
        filename: `resumen-${year}`,
      });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Números generales del año</p>
        {yearSelector}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Asistencias" value={yearAtt.length} />
        <StatCard label="Personas" value={uniquePeople} />
        <StatCard label="Reuniones" value={yearSessions.length} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-600">Por tipo</h3>
          <RowLine label="Entrega de Pasos" value={byType.entrega_pasos} />
          <RowLine label="Reducción del Ego" value={byType.reduccion_ego} />
        </div>
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-600">Por modalidad</h3>
          <RowLine label="Presencial" value={byModality.presencial} />
          <RowLine label="Virtual" value={byModality.virtual} />
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-600">
          Asistencias por mes
        </h3>
        {yearAtt.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Sin datos para {year}.
          </p>
        ) : (
          <div className="flex items-end gap-1.5" style={{ height: 140 }}>
            {byMonth.map((d, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-primary-400"
                    style={{ height: `${(d.value / maxMonth) * 100}%` }}
                    title={`${d.label}: ${d.value}`}
                  />
                </div>
                <span className="text-[10px] text-slate-400">{d.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={() => doExport('csv')} className="btn-secondary flex-1">
          <DownloadIcon className="text-lg" /> CSV
        </button>
        <button onClick={() => doExport('pdf')} className="btn-secondary flex-1">
          <DownloadIcon className="text-lg" /> PDF
        </button>
      </div>
    </div>
  );
}

function RowLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-bold text-primary-700">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* POR SESIÓN                                                          */
/* ------------------------------------------------------------------ */
function BySessionView({
  sessions,
  attendance,
}: {
  sessions: Session[];
  attendance: Attendance[];
}) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const selected = sessions.find((s) => s.id === sessionId) ?? sessions[0];
  const rows = useMemo(
    () =>
      attendance
        .filter((a) => a.sessionId === selected?.id)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
    [attendance, selected],
  );

  if (!selected) {
    return <EmptyState icon={<ChartIcon />} title="No hay reuniones todavía" />;
  }

  const doExport = (kind: 'csv' | 'pdf') => {
    const label = `${SESSION_TYPE_SHORT[selected.type]}-${fmtDate(selected.date)}`;
    if (kind === 'csv') {
      exportCSV(
        `asistencia-${label}`,
        rows.map((r) => ({ Nombre: r.fullName, 'Registrado por': r.checkedInByName })),
      );
    } else {
      exportPDF({
        title: `Asistencia — ${SESSION_TYPE_LABELS[selected.type]}`,
        subtitle: `${fmtDateLong(selected.date)} · ${MODALITY_LABELS[selected.modality]} · ${rows.length} presentes`,
        columns: ['Nombre', 'Registrado por'],
        rows: rows.map((r) => [r.fullName, r.checkedInByName]),
        filename: `asistencia-${label}`,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label">Elige una reunión</label>
        <select
          className="input"
          value={selected.id}
          onChange={(e) => setSessionId(e.target.value)}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {fmtDate(s.date)} · {SESSION_TYPE_SHORT[s.type]} ·{' '}
              {MODALITY_LABELS[s.modality]}
            </option>
          ))}
        </select>
      </div>

      <div className="card p-4">
        <p className="font-semibold capitalize text-primary-900">
          {fmtDateLong(selected.date)}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <TypeBadge type={selected.type} />
          <ModalityBadge modality={selected.modality} />
        </div>
        <p className="mt-3 text-3xl font-bold text-primary-700">{rows.length}</p>
        <p className="text-xs text-slate-500">presentes</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => doExport('csv')} className="btn-secondary flex-1">
          <DownloadIcon className="text-lg" /> CSV
        </button>
        <button onClick={() => doExport('pdf')} className="btn-secondary flex-1">
          <DownloadIcon className="text-lg" /> PDF
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<ChartIcon />} title="Sin presentes en esta reunión" />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-primary-100 bg-white px-4 py-3 text-sm font-medium text-slate-700"
            >
              {r.fullName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DETALLE DE PERSONA (modal)                                          */
/* ------------------------------------------------------------------ */
function PersonModal({
  memberId,
  onClose,
  attendance,
  totalSessions,
  year,
}: {
  memberId: string | null;
  onClose: () => void;
  attendance: Attendance[];
  totalSessions: number;
  year: number;
}) {
  const rows = useMemo(
    () =>
      attendance
        .filter((a) => a.memberId === memberId)
        .sort(
          (a, b) => toDate(b.sessionDate).getTime() - toDate(a.sessionDate).getTime(),
        ),
    [attendance, memberId],
  );

  if (!memberId) return null;
  const name = rows[0]?.fullName ?? 'Persona';
  const pasos = rows.filter((r) => r.sessionType === 'entrega_pasos').length;
  const ego = rows.filter((r) => r.sessionType === 'reduccion_ego').length;
  const total = rows.length;
  const pct = totalSessions > 0 ? Math.round((total / totalSessions) * 100) : 0;

  const doExport = () => {
    exportPDF({
      title: `Asistencia de ${name} — ${year}`,
      subtitle: `${total} asistencias · Pasos: ${pasos} · Ego: ${ego} · ${pct}% de ${totalSessions} reuniones`,
      columns: ['Fecha', 'Tipo', 'Modalidad'],
      rows: rows.map((r) => [
        fmtDate(r.sessionDate),
        SESSION_TYPE_LABELS[r.sessionType],
        MODALITY_LABELS[r.modality],
      ]),
      filename: `asistencia-${normalizeText(name).replace(/\s+/g, '-')}-${year}`,
    });
  };

  return (
    <Modal open={!!memberId} onClose={onClose} title={name}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total" value={total} />
          <StatCard label="Pasos" value={pasos} />
          <StatCard label="Ego" value={ego} />
        </div>
        <p className="text-center text-sm text-slate-500">
          Asistió al <strong className="text-primary-700">{pct}%</strong> de las{' '}
          {totalSessions} reuniones de {year}.
          {pasos > 0 && ego > 0 && (
            <span className="mt-1 block text-primary-600">
              ✓ Ha ido a Pasos y a Reducción del Ego.
            </span>
          )}
        </p>

        <button onClick={doExport} className="btn-secondary w-full">
          <DownloadIcon className="text-lg" /> Descargar su historial (PDF)
        </button>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Historial
          </h4>
          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">Sin asistencias en {year}.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-primary-100 bg-white px-3 py-2"
                >
                  <span className="text-sm font-medium capitalize text-slate-700">
                    {fmtDate(r.sessionDate)}
                  </span>
                  <span className="flex gap-1.5">
                    <TypeBadge type={r.sessionType} />
                    <ModalityBadge modality={r.modality} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
