import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Timestamp,
  collection,
  doc,
  getDocsFromServer,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { listenMembers } from '../services/members';
import { listenSessions, finalizeImportedSession } from '../services/sessions';
import type { Member, Session, SessionType, Modality } from '../types';
import { buildNameParts, normalizeText } from '../lib/normalize';
import { dayKey, fromInputDate, isValidDateKey } from '../lib/dates';
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
  sessionsCompleted: number;
  attendances: number;
  newMembers: string[];
  invalid: number;
}

/** Une nombres repetidos dentro de una misma reunión del archivo. */
function limpiarAsistentes(raw: unknown[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const a of raw) {
    // Solo texto: un dato raro no puede dejar la app en blanco ni crear la
    // persona "[object Object]".
    if (typeof a !== 'string') continue;
    const nombre = a.trim().replace(/\s+/g, ' ');
    const k = normalizeText(nombre);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(nombre);
  }
  return out;
}

export function ImportHistoryPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  // Hasta que ambas listas lleguen DEL SERVIDOR no se puede saber qué ya
  // existe: importar antes duplicaba todas las sesiones y personas.
  const [membersReady, setMembersReady] = useState(false);
  const [sessionsReady, setSessionsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState<HistSession[] | null>(null);
  const [invalidCount, setInvalidCount] = useState(0);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    const u1 = listenMembers(
      (list, meta) => {
        setMembers(list);
        if (!meta.fromCache) setMembersReady(true);
      },
      (e) => {
        console.error(e);
        setLoadError(true);
      },
    );
    const u2 = listenSessions(
      (list, meta) => {
        setSessions(list);
        if (!meta.fromCache) setSessionsReady(true);
      },
      (e) => {
        console.error(e);
        setLoadError(true);
      },
    );
    return () => {
      u1();
      u2();
    };
  }, []);
  const listo = membersReady && sessionsReady && !loadError;

  // Nombre normalizado (y cada alias) → persona.
  const memberIndex = useMemo(() => {
    const m = new Map<string, Member>();
    for (const x of members) {
      m.set(x.searchName || normalizeText(x.fullName), x);
      for (const a of x.aliases ?? []) {
        const k = normalizeText(a);
        if (k && !m.has(k)) m.set(k, x);
      }
    }
    return m;
  }, [members]);

  // "aaaa-mm-dd|tipo" → sesión que ya existe ese día.
  const existing = useMemo(() => {
    const m = new Map<string, Session>();
    for (const s of sessions) m.set(`${dayKey(s.date)}|${s.type}`, s);
    return m;
  }, [sessions]);

  // Reuniones del archivo, una por día y tipo (si venían repetidas, se juntan).
  const porDia = useMemo(() => {
    if (!data) return null;
    const m = new Map<string, HistSession>();
    for (const s of data) {
      const k = `${s.date}|${s.type}`;
      const prev = m.get(k);
      if (prev) prev.attendees = limpiarAsistentes([...prev.attendees, ...s.attendees]);
      else m.set(k, { ...s, attendees: limpiarAsistentes(s.attendees) });
    }
    return m;
  }, [data]);

  const preview = useMemo(() => {
    if (!porDia) return null;
    let create = 0;
    let complete = 0;
    let att = 0;
    const newNames = new Set<string>();
    for (const [k, s] of porDia) {
      if (existing.has(k)) complete++;
      else create++;
      for (const a of s.attendees) {
        att++;
        if (!memberIndex.has(normalizeText(a))) newNames.add(a);
      }
    }
    return {
      create,
      complete,
      att,
      newNames: [...newNames].sort((a, b) => a.localeCompare(b, 'es')),
    };
  }, [porDia, existing, memberIndex]);

  const handleFile = async (file: File) => {
    setReport(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: unknown = Array.isArray(parsed) ? parsed : parsed?.sessions;
      if (!Array.isArray(list)) throw new Error('formato');
      // Validación: fecha real "aaaa-mm-dd" (una fecha con hora u otro
      // formato antes terminaba guardada el día 1 del mes), tipo conocido y
      // lista de asistentes.
      const clean: HistSession[] = [];
      let malas = 0;
      for (const s of list as Record<string, unknown>[]) {
        const ok =
          s &&
          typeof s.date === 'string' &&
          isValidDateKey(s.date) &&
          (s.type === 'entrega_pasos' || s.type === 'reduccion_ego') &&
          Array.isArray(s.attendees);
        if (!ok) {
          malas++;
          continue;
        }
        clean.push({
          date: s.date as string,
          type: s.type as SessionType,
          modality: s.modality === 'presencial' ? 'presencial' : 'virtual',
          attendees: limpiarAsistentes(s.attendees as unknown[]),
        });
      }
      setFileName(file.name);
      setData(clean);
      setInvalidCount(malas);
      if (clean.length === 0) toast('El archivo no tiene reuniones válidas.', 'error');
      else if (malas > 0)
        toast(`Se ignoraron ${malas} reunión(es) con fecha o tipo inválidos.`, 'info');
    } catch (e) {
      console.error(e);
      toast('No se pudo leer el archivo (¿es el .json correcto?).', 'error');
    }
  };

  const doImport = async () => {
    if (!profile || !porDia || !listo || importing) return;
    setImporting(true);
    setProgress(0);
    const idx = new Map(memberIndex);
    const createdNames: string[] = [];
    let sessionsCreated = 0;
    let sessionsCompleted = 0;
    let sessionsSkipped = 0;
    let attendances = 0;
    const quien = profile.displayName || profile.email;

    try {
      for (const [k, s] of porDia) {
        const dateObj = fromInputDate(s.date);
        const dateTs = Timestamp.fromDate(dateObj);
        const previa = existing.get(k);
        const sessionRef = previa
          ? doc(db, 'sessions', previa.id)
          : doc(db, 'sessions', `${s.type}-${s.date}`);

        // Quiénes ya están en esa reunión (si existía): solo se agregan los
        // que falten. Antes, si ya había una sesión ese día, se descartaba
        // toda la lista del Meet.
        const yaPresentes = new Set<string>();
        if (previa) {
          const snap = await getDocsFromServer(collection(db, 'sessions', previa.id, 'attendance'));
          snap.docs.forEach((d) => yaPresentes.add(d.id));
        }

        // TODO lo de una reunión va en UN lote: o queda completa, o no queda
        // nada (y el reintento la vuelve a importar). Antes una importación
        // cortada dejaba la reunión abierta, a medias y con 0 presentes.
        const batch = writeBatch(db);
        if (!previa) {
          batch.set(sessionRef, {
            type: s.type,
            modality: s.modality,
            date: dateTs,
            status: 'open',
            createdBy: profile.uid,
            createdByName: quien,
            createdAt: serverTimestamp(),
            presentCount: 0,
            coordinator: '',
          });
        }
        let nuevas = 0;
        for (const name of s.attendees) {
          const key = normalizeText(name);
          let member = idx.get(key);
          if (!member) {
            // Quien no coincide NO entra a la lista oficial: queda "por
            // revisar", donde la administración ve si ya existía con otro
            // nombre. Antes cada variante creaba una ficha oficial nueva.
            const parts = buildNameParts(name);
            const ref = doc(collection(db, 'members'));
            batch.set(ref, {
              fullName: parts.fullName,
              firstName: parts.firstName,
              lastName: parts.lastName,
              searchName: parts.searchName,
              aliases: [],
              phone: '',
              notes: 'Importada desde el informe de Meet',
              active: true,
              createdAt: serverTimestamp(),
              createdBy: profile.uid,
              createdByName: 'Importado (Meet)',
              pendingIdentify: false,
              pendingReview: true,
              sourceSessionId: sessionRef.id,
              sourceSessionDate: dateTs,
            });
            member = {
              id: ref.id,
              fullName: parts.fullName,
              firstName: parts.firstName,
              lastName: parts.lastName,
              searchName: parts.searchName,
              aliases: [],
              active: true,
            };
            idx.set(key, member);
            createdNames.push(parts.fullName);
          }
          if (yaPresentes.has(member.id)) continue;
          yaPresentes.add(member.id);
          batch.set(doc(sessionRef, 'attendance', member.id), {
            memberId: member.id,
            fullName: member.fullName,
            status: 'present',
            checkedInAt: dateTs,
            checkedInBy: 'import',
            checkedInByName: 'Importado (Meet)',
            sessionId: sessionRef.id,
            sessionType: s.type,
            modality: s.modality,
            sessionDate: dateTs,
          });
          nuevas++;
        }

        if (!previa || nuevas > 0) {
          await batch.commit();
          // El contador es el total real, sin estimar. Una reunión nueva queda
          // cerrada; una que ya existía conserva su estado.
          await finalizeImportedSession(
            sessionRef.id,
            yaPresentes.size,
            previa ? previa.status : 'closed',
          );
          if (previa) sessionsCompleted++;
          else sessionsCreated++;
          attendances += nuevas;
        } else {
          sessionsSkipped++;
        }
        setProgress((p) => p + 1);
      }
      setReport({
        sessionsCreated,
        sessionsSkipped,
        sessionsCompleted,
        attendances,
        newMembers: createdNames.sort((a, b) => a.localeCompare(b, 'es')),
        invalid: invalidCount,
      });
      toast('¡Historial importado!', 'success');
    } catch (e) {
      console.error(e);
      toast(
        'Hubo un error a mitad de la importación. Vuelve a intentarlo: lo que ya quedó no se duplica.',
        'error',
      );
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
              <p className="text-xl font-bold text-amber-600">{preview.complete}</p>
              <p className="text-xs text-slate-500">ya existían (se completan)</p>
            </div>
          </div>
          {!listo && (
            <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
              {loadError ? (
                'No se pudieron cargar las personas y sesiones. Revisa la conexión y vuelve a entrar.'
              ) : (
                <>
                  <Spinner className="h-4 w-4" /> Revisando qué ya existe…
                </>
              )}
            </p>
          )}

          {preview.newNames.length > 0 && (
            <div className="card p-4">
              <p className="text-sm font-semibold text-slate-600">
                {preview.newNames.length} nombres no están en la lista: quedarán
                «por revisar» para que confirmes si ya existían con otro nombre:
              </p>
              <div className="mt-2 max-h-40 overflow-auto text-sm text-slate-500">
                {preview.newNames.join(' · ')}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={doImport}
            disabled={importing || !listo || preview.create + preview.complete === 0}
            className="btn-primary w-full"
          >
            {importing ? (
              <>
                <Spinner className="h-5 w-5 text-white" />
                Importando… {progress}/{porDia?.size ?? 0}
              </>
            ) : (
              <>Importar {preview.create + preview.complete} reuniones</>
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
          {report.sessionsCompleted > 0 && (
            <p className="text-xs text-slate-500">
              {report.sessionsCompleted} reunión(es) que ya existían se completaron con
              quienes faltaban.
            </p>
          )}
          {report.sessionsSkipped > 0 && (
            <p className="text-xs text-slate-400">
              ({report.sessionsSkipped} reuniones ya estaban completas y no se tocaron.)
            </p>
          )}
          {report.invalid > 0 && (
            <p className="text-xs text-amber-700">
              Se ignoraron {report.invalid} reunión(es) del archivo con fecha o tipo inválidos.
            </p>
          )}
          {report.newMembers.length > 0 && (
            <div className="text-left">
              <p className="text-sm font-semibold text-slate-600">
                Quedaron «por revisar» (en Personas → Revisar):
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
