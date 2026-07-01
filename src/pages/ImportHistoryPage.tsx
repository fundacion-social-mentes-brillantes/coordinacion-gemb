import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { listenMembers, createMember } from '../services/members';
import {
  listenSessions,
  createSession,
  finalizeImportedSession,
} from '../services/sessions';
import { writeImportedAttendance } from '../services/attendance';
import type { Member, Session, SessionType, Modality } from '../types';
import { normalizeText } from '../lib/normalize';
import { fromInputDate, toInputDate } from '../lib/dates';
import { Spinner } from '../components/Spinner';
import { ArrowLeftIcon, UploadIcon, CheckIcon } from '../components/Icons';

interface HistSession {
  date: string; // YYYY-MM-DD
  type: SessionType;
  modality: Modality;
  attendees: string[];
}
interface Report {
  sessionsCreated: number;
  sessionsSkipped: number;
  attendances: number;
  newMembers: string[];
}

export function ImportHistoryPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [data, setData] = useState<HistSession[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    const u1 = listenMembers(
      (list) => setMembers(list),
      (e) => console.error(e),
    );
    const u2 = listenSessions(
      (list) => setSessions(list),
      (e) => console.error(e),
    );
    return () => {
      u1();
      u2();
    };
  }, []);

  const memberIndex = useMemo(() => {
    const m = new Map<string, Member>();
    for (const x of members) m.set(x.searchName || normalizeText(x.fullName), x);
    return m;
  }, [members]);

  const existingKeys = useMemo(
    () => new Set(sessions.map((s) => `${toInputDate(s.date)}|${s.type}`)),
    [sessions],
  );

  const preview = useMemo(() => {
    if (!data) return null;
    let create = 0;
    let skip = 0;
    let att = 0;
    const newNames = new Set<string>();
    for (const s of data) {
      if (existingKeys.has(`${s.date}|${s.type}`)) {
        skip++;
        continue;
      }
      create++;
      for (const a of s.attendees) {
        att++;
        if (!memberIndex.has(normalizeText(a))) newNames.add(a.trim());
      }
    }
    return {
      create,
      skip,
      att,
      newNames: [...newNames].sort((a, b) => a.localeCompare(b, 'es')),
    };
  }, [data, existingKeys, memberIndex]);

  const handleFile = async (file: File) => {
    setReport(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: HistSession[] = Array.isArray(parsed)
        ? parsed
        : parsed.sessions;
      if (!Array.isArray(list)) throw new Error('formato');
      // Validación mínima
      const clean = list.filter(
        (s) =>
          s &&
          typeof s.date === 'string' &&
          (s.type === 'entrega_pasos' || s.type === 'reduccion_ego') &&
          Array.isArray(s.attendees),
      );
      setFileName(file.name);
      setData(clean);
      if (clean.length === 0) toast('El archivo no tiene reuniones válidas.', 'error');
    } catch (e) {
      console.error(e);
      toast('No se pudo leer el archivo (¿es el .json correcto?).', 'error');
    }
  };

  const doImport = async () => {
    if (!profile || !data) return;
    setImporting(true);
    setProgress(0);
    const idx = new Map(memberIndex);
    const createdNames: string[] = [];
    let sessionsCreated = 0;
    let sessionsSkipped = 0;
    let attendances = 0;

    try {
      for (const s of data) {
        if (existingKeys.has(`${s.date}|${s.type}`)) {
          sessionsSkipped++;
          setProgress((p) => p + 1);
          continue;
        }
        const dateObj = fromInputDate(s.date);
        const dateTs = Timestamp.fromDate(dateObj);
        const modality: Modality = s.modality === 'presencial' ? 'presencial' : 'virtual';

        const sessionId = await createSession(
          { type: s.type, modality, date: dateObj },
          profile,
        );

        let count = 0;
        for (const rawName of s.attendees) {
          const name = String(rawName).trim().replace(/\s+/g, ' ');
          if (!name) continue;
          const key = normalizeText(name);
          let member = idx.get(key);
          if (!member) {
            const id = await createMember({ fullName: name }, profile.uid);
            member = {
              id,
              fullName: name,
              firstName: '',
              lastName: '',
              searchName: key,
              aliases: [],
              active: true,
            };
            idx.set(key, member);
            createdNames.push(name);
          }
          await writeImportedAttendance(
            sessionId,
            { type: s.type, modality, dateTs },
            { id: member.id, fullName: member.fullName },
          );
          count++;
          attendances++;
        }
        await finalizeImportedSession(sessionId, count);
        sessionsCreated++;
        setProgress((p) => p + 1);
      }
      setReport({
        sessionsCreated,
        sessionsSkipped,
        attendances,
        newMembers: createdNames.sort((a, b) => a.localeCompare(b, 'es')),
      });
      toast('¡Historial importado!', 'success');
    } catch (e) {
      console.error(e);
      toast('Hubo un error a mitad de la importación. Puedes volver a intentarlo (lo ya cargado no se duplica).', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate('/personas')}
        className="btn-ghost -ml-2 text-sm"
      >
        <ArrowLeftIcon className="text-lg" /> Personas
      </button>
      <h2 className="text-lg font-bold text-primary-900">
        Importar historial de reuniones
      </h2>
      <p className="text-sm text-slate-500">
        Carga aquí las reuniones pasadas (de las listas de Google Meet). Se crean
        las sesiones con su fecha, se marca la asistencia y se agregan las
        personas nuevas. Si vuelves a importarlo, las reuniones que ya existen{' '}
        <strong>no se duplican</strong>.
      </p>

      {!report && (
        <label className="card flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-8 text-center">
          <UploadIcon className="text-3xl text-primary-400" />
          <span className="text-sm font-medium text-primary-700">
            {fileName || 'Toca para elegir el archivo historial-gemb.json'}
          </span>
          <span className="text-xs text-slate-400">Archivo .json que preparó Claude</span>
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = '';
            }}
          />
        </label>
      )}

      {data && preview && !report && (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="card p-3">
              <p className="text-xl font-bold text-primary-700">{preview.create}</p>
              <p className="text-xs text-slate-500">reuniones nuevas</p>
            </div>
            <div className="card p-3">
              <p className="text-xl font-bold text-green-600">{preview.att}</p>
              <p className="text-xs text-slate-500">asistencias</p>
            </div>
            <div className="card p-3">
              <p className="text-xl font-bold text-amber-600">{preview.skip}</p>
              <p className="text-xs text-slate-500">ya existían</p>
            </div>
          </div>

          {preview.newNames.length > 0 && (
            <div className="card p-4">
              <p className="text-sm font-semibold text-slate-600">
                Se agregarán {preview.newNames.length} personas nuevas:
              </p>
              <div className="mt-2 max-h-40 overflow-auto text-sm text-slate-500">
                {preview.newNames.join(' · ')}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={doImport}
            disabled={importing || preview.create === 0}
            className="btn-primary w-full"
          >
            {importing ? (
              <>
                <Spinner className="h-5 w-5 text-white" />
                Importando… {progress}/{data.length}
              </>
            ) : (
              <>Importar {preview.create} reuniones</>
            )}
          </button>
          {importing && (
            <p className="text-center text-xs text-slate-400">
              No cierres esta pantalla hasta que termine.
            </p>
          )}
        </>
      )}

      {report && (
        <div className="card space-y-3 p-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-500 text-white">
            <CheckIcon className="text-2xl" />
          </div>
          <h3 className="text-base font-bold text-primary-800">
            ¡Historial importado!
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-primary-700">{report.sessionsCreated}</p>
              <p className="text-xs text-slate-500">reuniones</p>
            </div>
            <div>
              <p className="text-xl font-bold text-primary-700">{report.attendances}</p>
              <p className="text-xs text-slate-500">asistencias</p>
            </div>
            <div>
              <p className="text-xl font-bold text-primary-700">{report.newMembers.length}</p>
              <p className="text-xs text-slate-500">personas nuevas</p>
            </div>
          </div>
          {report.sessionsSkipped > 0 && (
            <p className="text-xs text-slate-400">
              ({report.sessionsSkipped} reuniones ya existían y se omitieron.)
            </p>
          )}
          {report.newMembers.length > 0 && (
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-600">
                Personas nuevas agregadas:
              </p>
              <p className="mt-1 max-h-40 overflow-auto text-sm text-slate-500">
                {report.newMembers.join(' · ')}
              </p>
            </div>
          )}
          <button onClick={() => navigate('/panel')} className="btn-primary w-full">
            Ver el panel
          </button>
        </div>
      )}
    </div>
  );
}
