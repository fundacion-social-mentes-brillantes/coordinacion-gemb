import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { listenSessions } from '../services/sessions';
import { listenAllAttendance } from '../services/attendance';
import { listenMembers } from '../services/members';
import type { Attendance, Member, Session } from '../types';
import {
  SESSION_TYPE_LABELS,
  SESSION_TYPE_SHORT,
  MODALITY_LABELS,
} from '../lib/constants';
import { fmtDate, fmtDateLong, toDate, MONTH_NAMES } from '../lib/dates';
import { exportCSV, exportPDF } from '../lib/export';
import { buildFuse, searchMembers, toSearchable } from '../lib/search';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { TypeBadge, ModalityBadge } from '../components/badges';
import { DownloadIcon, ChartIcon, SearchIcon } from '../components/Icons';

type Tab = 'sesion' | 'persona' | 'anual';

export function DashboardPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('anual');

  const [sessions, setSessions] = useState<Session[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

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
    const u3 = listenMembers(
      (list) => setMembers(list),
      (e) => console.error(e),
    );
    return () => {
      u1();
      u2();
      u3();
    };
  }, [toast]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-primary-900">Panel de asistencia</h2>

      <div className="flex gap-1 rounded-xl bg-primary-100/60 p-1 text-sm">
        {(
          [
            ['anual', 'General'],
            ['sesion', 'Por sesión'],
            ['persona', 'Por persona'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 font-medium transition ${
              tab === key
                ? 'bg-white text-primary-700 shadow-sm'
                : 'text-slate-500'
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
      ) : tab === 'anual' ? (
        <AnnualView sessions={sessions} attendance={attendance} />
      ) : tab === 'sesion' ? (
        <BySessionView sessions={sessions} attendance={attendance} />
      ) : (
        <ByPersonView
          sessions={sessions}
          attendance={attendance}
          members={members}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjetas de resumen y gráfico                                       */
/* ------------------------------------------------------------------ */

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <p className="text-2xl font-bold text-primary-700">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function MiniBarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5" style={{ height: 140 }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-primary-400"
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.label}: ${d.value}`}
            />
          </div>
          <span className="text-[10px] text-slate-400">{d.label}</span>
          <span className="text-[10px] font-medium text-slate-600">
            {d.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vista General / Anual                                               */
/* ------------------------------------------------------------------ */

function AnnualView({
  sessions,
  attendance,
}: {
  sessions: Session[];
  attendance: Attendance[];
}) {
  const years = useMemo(() => {
    const set = new Set<number>();
    sessions.forEach((s) => set.add(toDate(s.date).getFullYear()));
    attendance.forEach((a) => set.add(toDate(a.sessionDate).getFullYear()));
    set.add(new Date().getFullYear());
    return [...set].sort((a, b) => b - a);
  }, [sessions, attendance]);

  const [year, setYear] = useState(() => new Date().getFullYear());

  const yearAtt = useMemo(
    () => attendance.filter((a) => toDate(a.sessionDate).getFullYear() === year),
    [attendance, year],
  );
  const yearSessions = useMemo(
    () => sessions.filter((s) => toDate(s.date).getFullYear() === year),
    [sessions, year],
  );

  const uniquePeople = useMemo(
    () => new Set(yearAtt.map((a) => a.memberId)).size,
    [yearAtt],
  );

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

  const exportSummary = (kind: 'csv' | 'pdf') => {
    const rows = [
      { Métrica: 'Total de asistencias', Valor: yearAtt.length },
      { Métrica: 'Asistentes únicos', Valor: uniquePeople },
      { Métrica: 'Sesiones realizadas', Valor: yearSessions.length },
      { Métrica: 'Asistencias — Entrega de Pasos', Valor: byType.entrega_pasos },
      { Métrica: 'Asistencias — Reducción del Ego', Valor: byType.reduccion_ego },
      { Métrica: 'Asistencias — Presencial', Valor: byModality.presencial },
      { Métrica: 'Asistencias — Virtual', Valor: byModality.virtual },
      ...byMonth.map((m) => ({ Métrica: `Asistencias — ${m.label}`, Valor: m.value })),
    ];
    if (kind === 'csv') {
      exportCSV(`resumen-anual-${year}`, rows);
    } else {
      exportPDF({
        title: `Resumen de asistencia ${year}`,
        subtitle: 'Gimnasio Emocional Mentes Brillantes',
        columns: ['Métrica', 'Valor'],
        rows: rows.map((r) => [r.Métrica, r.Valor]),
        filename: `resumen-anual-${year}`,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-600">Año</label>
        <select
          className="input w-32"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Asistencias" value={yearAtt.length} />
        <StatCard label="Personas únicas" value={uniquePeople} />
        <StatCard label="Sesiones" value={yearSessions.length} />
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
          <MiniBarChart data={byMonth} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-600">Por tipo</h3>
          <Row label={SESSION_TYPE_LABELS.entrega_pasos} value={byType.entrega_pasos} />
          <Row label={SESSION_TYPE_LABELS.reduccion_ego} value={byType.reduccion_ego} />
        </div>
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-600">
            Por modalidad
          </h3>
          <Row label={MODALITY_LABELS.presencial} value={byModality.presencial} />
          <Row label={MODALITY_LABELS.virtual} value={byModality.virtual} />
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => exportSummary('csv')} className="btn-secondary flex-1">
          <DownloadIcon className="text-lg" /> CSV
        </button>
        <button onClick={() => exportSummary('pdf')} className="btn-secondary flex-1">
          <DownloadIcon className="text-lg" /> PDF
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-primary-700">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vista por sesión                                                    */
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
    return <EmptyState icon={<ChartIcon />} title="No hay sesiones todavía" />;
  }

  const doExport = (kind: 'csv' | 'pdf') => {
    const label = `${SESSION_TYPE_SHORT[selected.type]}-${fmtDate(selected.date)}`;
    const data = rows.map((r) => ({ Nombre: r.fullName, 'Registrado por': r.checkedInByName }));
    if (kind === 'csv') {
      exportCSV(`asistencia-${label}`, data);
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
        <label className="label">Sesión</label>
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
        <EmptyState icon={<ChartIcon />} title="Sin presentes en esta sesión" />
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
/* Vista por persona                                                   */
/* ------------------------------------------------------------------ */

function ByPersonView({
  sessions,
  attendance,
  members,
}: {
  sessions: Session[];
  attendance: Attendance[];
  members: Member[];
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const searchable = useMemo(() => toSearchable(members), [members]);
  const fuse = useMemo(() => buildFuse(searchable), [searchable]);
  const results = useMemo(
    () => searchMembers(fuse, searchable, query, 12),
    [fuse, searchable, query],
  );

  const selected = members.find((m) => m.id === selectedId);
  const personRows = useMemo(
    () =>
      attendance
        .filter((a) => a.memberId === selectedId)
        .sort(
          (a, b) => toDate(b.sessionDate).getTime() - toDate(a.sessionDate).getTime(),
        ),
    [attendance, selectedId],
  );

  const totalSessions = sessions.length;
  const pct =
    totalSessions > 0 ? Math.round((personRows.length / totalSessions) * 100) : 0;

  const doExport = (kind: 'csv' | 'pdf') => {
    if (!selected) return;
    const data = personRows.map((r) => ({
      Fecha: fmtDate(r.sessionDate),
      Tipo: SESSION_TYPE_LABELS[r.sessionType],
      Modalidad: MODALITY_LABELS[r.modality],
    }));
    if (kind === 'csv') {
      exportCSV(`historial-${selected.searchName.replace(/\s+/g, '-')}`, data);
    } else {
      exportPDF({
        title: `Historial de asistencia — ${selected.fullName}`,
        subtitle: `${personRows.length} asistencias · ${pct}% de ${totalSessions} sesiones`,
        columns: ['Fecha', 'Tipo', 'Modalidad'],
        rows: personRows.map((r) => [
          fmtDate(r.sessionDate),
          SESSION_TYPE_LABELS[r.sessionType],
          MODALITY_LABELS[r.modality],
        ]),
        filename: `historial-${selected.searchName.replace(/\s+/g, '-')}`,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400" />
        <input
          className="input pl-11"
          placeholder="Buscar persona…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedId(null);
          }}
        />
      </div>

      {!selected && query.trim().length >= 2 && (
        <ul className="space-y-2">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(m.id);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-primary-300"
              >
                {m.fullName}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">
              Nadie coincide con “{query}”.
            </p>
          )}
        </ul>
      )}

      {selected && (
        <>
          <div className="card p-4">
            <p className="text-lg font-bold text-primary-900">
              {selected.fullName}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatCard label="Asistencias" value={personRows.length} />
              <StatCard label="% de asistencia" value={`${pct}%`} />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Sobre {totalSessions} sesiones registradas.
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => doExport('csv')} className="btn-secondary flex-1">
              <DownloadIcon className="text-lg" /> CSV
            </button>
            <button onClick={() => doExport('pdf')} className="btn-secondary flex-1">
              <DownloadIcon className="text-lg" /> PDF
            </button>
            <button
              onClick={() => {
                setSelectedId(null);
                setQuery('');
              }}
              className="btn-ghost"
            >
              Cambiar
            </button>
          </div>

          {personRows.length === 0 ? (
            <EmptyState icon={<ChartIcon />} title="Aún no tiene asistencias" />
          ) : (
            <ul className="space-y-2">
              {personRows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-primary-100 bg-white px-4 py-3"
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
        </>
      )}

      {!selected && query.trim().length < 2 && (
        <EmptyState
          icon={<SearchIcon />}
          title="Busca una persona"
          description="Escribe un nombre para ver su historial y % de asistencia."
        />
      )}
    </div>
  );
}
