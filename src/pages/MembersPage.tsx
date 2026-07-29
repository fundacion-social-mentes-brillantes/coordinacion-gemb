import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  listenMembers,
  createMember,
  updateMember,
  setMemberActive,
} from '../services/members';
import { propagateNameToAttendance } from '../services/identify';
import { buildNameParts } from '../lib/normalize';
import type { Member } from '../types';
import { buildFuse, searchMembers, toSearchable } from '../lib/search';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import {
  PlusIcon,
  SearchIcon,
  UploadIcon,
  EditIcon,
  UsersIcon,
} from '../components/Icons';

interface FormState {
  fullName: string;
  phone: string;
  aliases: string;
  notes: string;
}
const EMPTY: FormState = { fullName: '', phone: '', aliases: '', notes: '' };

export function MembersPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = listenMembers(
      (list) => {
        setMembers(list);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        toast('No se pudieron cargar las personas.', 'error');
        setLoading(false);
      },
    );
    return unsub;
  }, [toast]);

  // Las personas "por revisar" NO forman parte de la lista oficial: viven en
  // su propia bandeja hasta que la administradora las apruebe.
  const oficiales = useMemo(
    () => members.filter((m) => !m.pendingReview),
    [members],
  );
  const porRevisar = useMemo(
    () => members.filter((m) => m.pendingReview).length,
    [members],
  );

  // El buscador trabaja SOLO sobre la lista oficial: si se filtrara después
  // del límite de resultados, con muchas coincidencias podría esconder gente.
  const searchable = useMemo(() => toSearchable(oficiales), [oficiales]);
  const fuse = useMemo(() => buildFuse(searchable), [searchable]);

  const visible = useMemo(() => {
    let list: Member[] =
      query.trim().length >= 2
        ? searchMembers(fuse, searchable, query, 300)
        : oficiales;
    if (!showInactive) list = list.filter((m) => m.active);
    return list;
  }, [oficiales, query, fuse, searchable, showInactive]);

  const activeCount = oficiales.filter((m) => m.active).length;

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setModalOpen(true);
  };
  const openEdit = (m: Member) => {
    setEditing(m);
    setForm({
      fullName: m.fullName,
      phone: m.phone ?? '',
      aliases: (m.aliases ?? []).join(', '),
      notes: m.notes ?? '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!profile) return;
    const fullName = form.fullName.trim();
    if (!fullName) {
      toast('Escribe el nombre completo.', 'error');
      return;
    }
    const aliases = form.aliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    setSaving(true);
    try {
      if (editing) {
        const clean = buildNameParts(fullName).fullName;
        const nameChanged = clean !== editing.fullName;
        await updateMember(editing.id, {
          fullName,
          phone: form.phone.trim(),
          aliases,
          notes: form.notes.trim(),
          // Al ponerle nombre real a una "Por identificar", deja de serlo.
          ...(editing.pendingIdentify && nameChanged
            ? { pendingIdentify: false }
            : {}),
        });
        if (nameChanged && !navigator.onLine) {
          toast(
            'Nombre guardado. Su historial se corrige con internet: vuelve a guardar entonces.',
            'info',
          );
        } else if (nameChanged) {
          // El nombre vive copiado en cada asistencia: corrige el historial.
          const res = await propagateNameToAttendance(editing.id, clean);
          if (res.failed > 0) {
            toast(
              `Persona actualizada; ${res.failed} registro(s) antiguos no se pudieron corregir.`,
              'info',
            );
          } else {
            toast('Persona actualizada (también su historial).', 'success');
          }
        } else {
          toast('Persona actualizada.', 'success');
        }
      } else {
        await createMember(
          { fullName, phone: form.phone.trim(), aliases, notes: form.notes.trim() },
          profile.uid,
        );
        toast('Persona agregada.', 'success');
      }
      setModalOpen(false);
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: Member) => {
    try {
      await setMemberActive(m.id, !m.active);
      toast(m.active ? 'Persona desactivada.' : 'Persona reactivada.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo cambiar el estado.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-primary-900">Personas</h2>
        <p className="text-xs text-slate-500">{activeCount} en la lista oficial</p>
      </div>

      {/* Aviso: hay gente que registraron las coordinadoras sin revisar. */}
      {porRevisar > 0 && (
        <button
          type="button"
          onClick={() => navigate('/personas/revisar')}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-left"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-400 text-lg font-bold text-white">
            {porRevisar}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-amber-900">
              {porRevisar === 1
                ? 'Hay 1 persona nueva por revisar'
                : `Hay ${porRevisar} personas nuevas por revisar`}
            </span>
            <span className="block text-xs text-amber-800">
              Las registraron en las reuniones. Toca para aprobarlas o corregir
              el nombre.
            </span>
          </span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => navigate('/personas/importar')}
          className="btn-secondary min-h-[48px] w-full"
        >
          <UploadIcon className="text-lg" /> Importar
        </button>
        <button
          type="button"
          onClick={openAdd}
          className="btn-primary min-h-[48px] w-full"
        >
          <PlusIcon className="text-lg" /> Agregar
        </button>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-slate-400" />
        <input
          className="input pl-11"
          placeholder="Buscar persona…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-primary-500"
        />
        Mostrar personas inactivas
      </label>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={members.length === 0 ? 'No hay personas' : 'Sin resultados'}
          description={
            members.length === 0
              ? 'Importa la base o agrega personas manualmente.'
              : 'Prueba con otro nombre.'
          }
          action={
            members.length === 0 ? (
              <button
                onClick={() => navigate('/personas/importar')}
                className="btn-primary"
              >
                <UploadIcon className="text-lg" /> Importar base
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((m) => (
            <li
              key={m.id}
              className={`flex items-center gap-3 rounded-xl border bg-white p-3 ${
                m.active ? 'border-primary-100' : 'border-slate-200 opacity-60'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium text-slate-800">
                  <span className="truncate">{m.fullName}</span>
                  {m.pendingIdentify && (
                    <span className="chip shrink-0 bg-amber-100 text-amber-700">
                      Sin nombre aún
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {m.phone || (m.aliases?.length ? `alias: ${m.aliases.join(', ')}` : 'sin datos')}
                  {!m.active && ' · inactiva'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openEdit(m)}
                className="tap shrink-0 rounded-full text-slate-500 active:bg-primary-50 active:text-primary-600"
                aria-label={`Editar ${m.fullName}`}
              >
                <EditIcon className="text-xl" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    m.active &&
                    !window.confirm(
                      `¿Desactivar a ${m.fullName}? Dejará de aparecer al tomar asistencia (su historial se conserva).`,
                    )
                  )
                    return;
                  toggleActive(m);
                }}
                className={`min-h-[44px] shrink-0 rounded-full px-3 text-sm font-medium ${
                  m.active
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-primary-100 text-primary-700'
                }`}
              >
                {m.active ? 'Desactivar' : 'Activar'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar persona' : 'Agregar persona'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nombre completo *</label>
            <input
              autoFocus
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Ej. Johana Rendón"
            />
          </div>
          <div>
            <label className="label">Teléfono (opcional)</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              inputMode="tel"
            />
          </div>
          <div>
            <label className="label">Alias (separados por coma)</label>
            <input
              className="input"
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              placeholder="Ej. Jo, Joha"
            />
          </div>
          <div>
            <label className="label">Notas (opcional)</label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary w-full"
          >
            {saving ? <Spinner className="h-5 w-5 text-white" /> : null}
            {editing ? 'Guardar cambios' : 'Agregar persona'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
