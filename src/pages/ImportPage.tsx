import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { readTable, type RawTable } from '../lib/import';
import { normalizeText } from '../lib/normalize';
import { listenMembers, bulkImportMembers } from '../services/members';
import type { Member } from '../types';
import { Spinner } from '../components/Spinner';
import { ArrowLeftIcon, UploadIcon } from '../components/Icons';

interface BuiltRow {
  fullName: string;
  phone: string;
  aliases: string[];
  dupInFile: boolean;
  dupInDb: boolean;
}

const NONE = -1;

export function ImportPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);
  const [raw, setRaw] = useState<RawTable | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);

  const [hasHeader, setHasHeader] = useState(true);
  const [nameCol, setNameCol] = useState(0);
  const [secondCol, setSecondCol] = useState(NONE);
  const [phoneCol, setPhoneCol] = useState(NONE);
  const [aliasCol, setAliasCol] = useState(NONE);
  const [skipDup, setSkipDup] = useState(true);

  useEffect(() => {
    const unsub = listenMembers(
      (list) => setMembers(list),
      (e) => console.error(e),
    );
    return unsub;
  }, []);

  const existingSet = useMemo(
    () => new Set(members.map((m) => m.searchName || normalizeText(m.fullName))),
    [members],
  );

  const colCount = useMemo(
    () => (raw ? Math.max(0, ...raw.matrix.map((r) => r.length)) : 0),
    [raw],
  );

  const headerNames = useMemo(() => {
    if (!raw) return [];
    if (hasHeader && raw.matrix[0]) {
      return Array.from({ length: colCount }, (_, i) => raw.matrix[0][i] || `Columna ${i + 1}`);
    }
    return Array.from({ length: colCount }, (_, i) => `Columna ${i + 1}`);
  }, [raw, hasHeader, colCount]);

  const handleFile = async (file: File) => {
    setReading(true);
    setRaw(null);
    try {
      const table = await readTable(file);
      setFileName(file.name);
      setRaw(table);
      setHasHeader(table.guessedHeader);
      // Defaults de columnas según encabezado detectado.
      const findCol = (re: RegExp) =>
        table.guessedHeader && table.matrix[0]
          ? table.matrix[0].findIndex((c) => re.test(c))
          : -1;
      const n = findCol(/nombre|name/i);
      setNameCol(n >= 0 ? n : 0);
      setSecondCol(findCol(/apellido|last/i));
      setPhoneCol(findCol(/tel|cel|phone|whats/i));
      setAliasCol(findCol(/alias|apodo/i));
      if (table.matrix.length === 0) {
        toast('El archivo no tiene filas legibles.', 'error');
      }
    } catch (e) {
      console.error(e);
      toast('No se pudo leer el archivo.', 'error');
    } finally {
      setReading(false);
    }
  };

  const built = useMemo<BuiltRow[]>(() => {
    if (!raw) return [];
    const dataRows = hasHeader ? raw.matrix.slice(1) : raw.matrix;
    const seen = new Set<string>();
    const out: BuiltRow[] = [];
    for (const row of dataRows) {
      let name = (row[nameCol] ?? '').trim();
      if (secondCol >= 0) name = `${name} ${row[secondCol] ?? ''}`.trim();
      name = name.replace(/\s+/g, ' ');
      if (!name) continue;
      const key = normalizeText(name);
      const dupInFile = seen.has(key);
      const dupInDb = existingSet.has(key);
      seen.add(key);
      out.push({
        fullName: name,
        phone: phoneCol >= 0 ? (row[phoneCol] ?? '').trim() : '',
        aliases:
          aliasCol >= 0 && (row[aliasCol] ?? '').trim()
            ? [(row[aliasCol] ?? '').trim()]
            : [],
        dupInFile,
        dupInDb,
      });
    }
    return out;
  }, [raw, hasHeader, nameCol, secondCol, phoneCol, aliasCol, existingSet]);

  const stats = useMemo(() => {
    const dupInDb = built.filter((b) => b.dupInDb).length;
    const dupInFile = built.filter((b) => b.dupInFile).length;
    const toImport = built.filter((b) =>
      skipDup ? !b.dupInFile && !b.dupInDb : true,
    );
    return { total: built.length, dupInDb, dupInFile, toImport };
  }, [built, skipDup]);

  const doImport = async () => {
    if (!profile) return;
    if (stats.toImport.length === 0) {
      toast('No hay personas nuevas para importar.', 'info');
      return;
    }
    setImporting(true);
    try {
      const n = await bulkImportMembers(
        stats.toImport.map((b) => ({
          fullName: b.fullName,
          phone: b.phone,
          aliases: b.aliases,
        })),
        profile.uid,
      );
      toast(`${n} personas importadas.`, 'success');
      navigate('/personas');
    } catch (e) {
      console.error(e);
      toast('No se pudieron importar. Revisa tu conexión.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const colOptions = (includeNone: boolean) => (
    <>
      {includeNone && <option value={NONE}>— ninguna —</option>}
      {headerNames.map((name, i) => (
        <option key={i} value={i}>
          {name}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate('/personas')}
        className="btn-ghost -ml-2 text-sm"
      >
        <ArrowLeftIcon className="text-lg" /> Personas
      </button>
      <h2 className="text-lg font-bold text-primary-900">Importar personas</h2>

      <button
        type="button"
        onClick={() => navigate('/personas/historial')}
        className="flex w-full items-center justify-between rounded-xl border border-dashed border-primary-200 bg-white px-4 py-3 text-left text-sm font-medium text-primary-700"
      >
        <span>📅 ¿Tienes historial de reuniones (asistencia pasada)? Impórtalo aquí</span>
        <span className="text-primary-500">Abrir</span>
      </button>
      <p className="text-sm text-slate-500">
        Sube un archivo <strong>CSV</strong> o <strong>Excel (.xlsx)</strong>.
        Se corrigen automáticamente los acentos dañados y se detectan
        duplicados. Puedes reutilizarlo para actualizar la base.
      </p>

      <label className="card flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-8 text-center">
        <UploadIcon className="text-3xl text-primary-400" />
        <span className="text-sm font-medium text-primary-700">
          {fileName || 'Toca para elegir un archivo'}
        </span>
        <span className="text-xs text-slate-400">CSV, XLSX o XLS</span>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
      </label>

      {reading && (
        <div className="flex items-center justify-center gap-2 py-6 text-slate-500">
          <Spinner className="h-6 w-6" /> Leyendo archivo…
        </div>
      )}

      {raw && !reading && (
        <>
          <div className="card space-y-3 p-4">
            <h3 className="text-sm font-semibold text-slate-600">
              Configura las columnas
            </h3>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary-500"
              />
              La primera fila es un encabezado
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nombre *</label>
                <select
                  className="input"
                  value={nameCol}
                  onChange={(e) => setNameCol(Number(e.target.value))}
                >
                  {colOptions(false)}
                </select>
              </div>
              <div>
                <label className="label">+ Apellido (opcional)</label>
                <select
                  className="input"
                  value={secondCol}
                  onChange={(e) => setSecondCol(Number(e.target.value))}
                >
                  {colOptions(true)}
                </select>
              </div>
              <div>
                <label className="label">Teléfono (opcional)</label>
                <select
                  className="input"
                  value={phoneCol}
                  onChange={(e) => setPhoneCol(Number(e.target.value))}
                >
                  {colOptions(true)}
                </select>
              </div>
              <div>
                <label className="label">Alias (opcional)</label>
                <select
                  className="input"
                  value={aliasCol}
                  onChange={(e) => setAliasCol(Number(e.target.value))}
                >
                  {colOptions(true)}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={skipDup}
                onChange={(e) => setSkipDup(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary-500"
              />
              Omitir duplicados (recomendado)
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="card p-3">
              <p className="text-xl font-bold text-primary-700">{stats.total}</p>
              <p className="text-xs text-slate-500">filas con nombre</p>
            </div>
            <div className="card p-3">
              <p className="text-xl font-bold text-green-600">
                {stats.toImport.length}
              </p>
              <p className="text-xs text-slate-500">se importarán</p>
            </div>
            <div className="card p-3">
              <p className="text-xl font-bold text-amber-600">
                {stats.dupInDb + stats.dupInFile}
              </p>
              <p className="text-xs text-slate-500">duplicados</p>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-primary-100 px-4 py-2 text-sm font-semibold text-slate-600">
              Vista previa
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-primary-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Teléfono</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {built.slice(0, 100).map((b, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{b.fullName}</td>
                      <td className="px-3 py-2 text-slate-400">{b.phone || '—'}</td>
                      <td className="px-3 py-2">
                        {b.dupInDb ? (
                          <span className="chip bg-amber-100 text-amber-700">
                            en base
                          </span>
                        ) : b.dupInFile ? (
                          <span className="chip bg-slate-100 text-slate-500">
                            repetida
                          </span>
                        ) : (
                          <span className="chip bg-green-100 text-green-700">
                            nueva
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {built.length > 100 && (
                <p className="px-3 py-2 text-center text-xs text-slate-400">
                  … y {built.length - 100} más.
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={doImport}
            disabled={importing || stats.toImport.length === 0}
            className="btn-primary w-full"
          >
            {importing ? <Spinner className="h-5 w-5 text-white" /> : null}
            Importar {stats.toImport.length} personas
          </button>
        </>
      )}
    </div>
  );
}
