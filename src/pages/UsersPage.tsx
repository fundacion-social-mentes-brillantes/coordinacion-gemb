import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { SUPER_ADMIN_EMAIL } from '../lib/firebase';
import {
  asignarRol,
  borrarSolicitud,
  createInvite,
  deleteInvite,
  listenInvites,
  listenUsers,
  setUserActive,
  type Invite,
} from '../services/users';
import type { UserProfile } from '../types';
import { ROL_VISIBLE, nombreDeRol, rolVisibleDe, type RolVisible } from '../lib/constants';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { CheckIcon, TrashIcon } from '../components/Icons';
import { esperarConLimite } from '../lib/esperar';

// ---------------------------------------------------------------------------
//  Usuarios: quién entra a la app y con qué rol.
//
//  Tres roles, y solo el correo principal los cambia:
//    Coordinador                  toma asistencia y ve el calendario
//    Coordinador de coordinadores además agenda el calendario
//    Administrador                además Panel, Personas y Usuarios
//
//  Quien está en "Entrada directa" entra con Google y ya tiene su rol. Los
//  demás quedan esperando y aparecen arriba para darles acceso con un toque
//  (eso sí lo puede hacer cualquier administrador, como Coordinador).
// ---------------------------------------------------------------------------

const ROLES: RolVisible[] = ['coordinador', 'coordinador_coordinadores', 'admin'];
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inicial = (u: { displayName?: string; email: string }) =>
  (u.displayName || u.email).trim().charAt(0).toUpperCase() || '?';

function Avatar({ u }: { u: UserProfile }) {
  return u.photoURL ? (
    <img
      src={u.photoURL}
      alt=""
      referrerPolicy="no-referrer"
      className="h-11 w-11 shrink-0 rounded-full border border-white/10 object-cover"
    />
  ) : (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-500/15 font-display text-lg font-bold text-primary-500">
      {inicial(u)}
    </span>
  );
}

/** Tarjetas para elegir uno de los tres roles. */
function ElegirRol({ valor, onChange }: { valor: RolVisible | null; onChange: (r: RolVisible) => void }) {
  return (
    <div className="space-y-2">
      {ROLES.map((r) => {
        const sel = valor === r;
        return (
          <button
            key={r}
            type="button"
            aria-pressed={sel}
            onClick={() => onChange(r)}
            className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
              sel ? 'border-primary-500 bg-primary-500/10' : 'border-white/10 active:bg-white/5'
            }`}
          >
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                sel ? 'border-primary-500 bg-primary-500 text-white' : 'border-slate-400'
              }`}
            >
              {sel && <CheckIcon className="text-xs" />}
            </span>
            <span>
              <span className="block font-semibold text-slate-900">{ROL_VISIBLE[r].nombre}</span>
              <span className="block text-sm text-slate-500">{ROL_VISIBLE[r].detalle}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function UsersPage() {
  const { profile, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editando, setEditando] = useState<UserProfile | null>(null);
  const [rolNuevo, setRolNuevo] = useState<RolVisible | null>(null);

  // Entrada directa
  const [correos, setCorreos] = useState('');
  const [rolInvita, setRolInvita] = useState<RolVisible>('coordinador');
  const [invitando, setInvitando] = useState(false);

  useEffect(() => {
    const u1 = listenUsers(
      (list) => {
        setUsers(list);
        setLoading(false);
      },
      (e) => {
        console.error(e);
        toast('No se pudieron cargar los usuarios.', 'error');
        setLoading(false);
      },
    );
    const u2 = listenInvites(setInvites, (e) => console.error(e));
    return () => {
      u1();
      u2();
    };
  }, [toast]);

  const pending = useMemo(() => users.filter((u) => u.role === 'pending'), [users]);
  const equipo = useMemo(() => users.filter((u) => u.role !== 'pending'), [users]);
  const nombre = (u: UserProfile) => u.displayName || u.email;
  const esPrincipal = (u: UserProfile) => u.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

  /** Corre una escritura con aviso; sin señal, avisa que se enviará luego. */
  const guardar = async (id: string, escritura: () => Promise<unknown>, ok: string, fallo: string) => {
    setBusy(id);
    try {
      const enviado = await esperarConLimite(escritura());
      toast(enviado ? ok : 'Sin conexión: el cambio se enviará cuando vuelva la señal.', enviado ? 'success' : 'info');
      return true;
    } catch (e) {
      console.error(e);
      toast(fallo, 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const darAcceso = (u: UserProfile, r: RolVisible) =>
    void guardar(u.uid, () => asignarRol(u.uid, r), `${nombre(u)} ya puede entrar como ${ROL_VISIBLE[r].nombre}.`, 'No se pudo dar acceso.');

  const noEsDelEquipo = (u: UserProfile) => {
    if (!window.confirm(`¿${nombre(u)} no es del equipo? Se borra su solicitud.`)) return;
    void guardar(u.uid, () => borrarSolicitud(u.uid), 'Solicitud borrada.', 'No se pudo borrar.');
  };

  const abrirEdicion = (u: UserProfile) => {
    setEditando(u);
    setRolNuevo(rolVisibleDe(u));
  };

  const guardarRol = async () => {
    if (!editando || !rolNuevo) return;
    if (rolNuevo === 'admin' && rolVisibleDe(editando) !== 'admin') {
      if (!window.confirm(`¿Hacer Administrador a ${nombre(editando)}? Podrá ver el Panel, editar Personas y dar acceso.`)) return;
    }
    const ok = await guardar(
      editando.uid,
      () => asignarRol(editando.uid, rolNuevo),
      `${nombre(editando)} ahora es ${ROL_VISIBLE[rolNuevo].nombre}.`,
      'No se pudo cambiar el rol.',
    );
    if (ok) setEditando(null);
  };

  const cambiarAcceso = async (u: UserProfile) => {
    if (u.active && !window.confirm(`¿Quitarle el acceso a ${nombre(u)}? Ya no podrá entrar a la app. Puedes devolvérselo cuando quieras.`))
      return;
    const ok = await guardar(
      u.uid,
      () => setUserActive(u.uid, !u.active),
      u.active ? 'Acceso quitado.' : 'Acceso devuelto.',
      'No se pudo cambiar el acceso.',
    );
    if (ok) setEditando(null);
  };

  /** Uno o varios correos (separados por coma, espacio o renglón). */
  const agregarCorreos = async () => {
    if (!profile || invitando) return;
    const lista = [...new Set(correos.split(/[\s,;]+/).map((c) => c.trim().toLowerCase()).filter(Boolean))];
    const malos = lista.filter((c) => !CORREO.test(c));
    if (lista.length === 0 || malos.length) {
      toast(malos.length ? `Revisa: ${malos.join(', ')}` : 'Escribe al menos un correo.', 'error');
      return;
    }
    const yaEntraron = lista.filter((c) => users.some((u) => u.email.toLowerCase() === c));
    const nuevos = lista.filter((c) => !yaEntraron.includes(c));
    setInvitando(true);
    try {
      const enviado = await esperarConLimite(
        Promise.all(nuevos.map((c) => createInvite(c, isSuperAdmin ? rolInvita : 'coordinador', profile))),
      );
      const partes = [
        nuevos.length ? `${nuevos.length} correo(s) con entrada directa.` : '',
        yaEntraron.length ? `${yaEntraron.length} ya había(n) entrado: cámbiales el rol en la lista.` : '',
      ].filter(Boolean);
      toast(enviado ? partes.join(' ') : 'Sin conexión: se guardará al volver la señal.', enviado ? 'success' : 'info');
      setCorreos('');
    } catch (e) {
      console.error(e);
      toast('No se pudieron guardar los correos.', 'error');
    } finally {
      setInvitando(false);
    }
  };

  const quitarInvitacion = (inv: Invite) => {
    if (!window.confirm(`¿Quitar ${inv.email} de la entrada directa?`)) return;
    void guardar(inv.id, () => deleteInvite(inv.id), 'Quitado de la entrada directa.', 'No se pudo quitar.');
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="esqueleto h-10 w-40" />
        <div className="esqueleto h-24" />
        <div className="esqueleto h-24" />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h2 className="titulo-pantalla">Usuarios</h2>
        <p className="mt-1 text-sm text-slate-500">Quién entra a la app y con qué rol.</p>
      </div>

      {/* 1) Quieren entrar */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-slate-500">
          Quieren entrar
          {pending.length > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] text-white">{pending.length}</span>
          )}
        </h3>
        {pending.length === 0 ? (
          <p className="card p-4 text-center text-sm text-slate-500">
            Nadie esperando. Cuando alguien entre con Google por primera vez y no esté en la entrada
            directa, aparecerá aquí.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((u) => (
              <li key={u.uid} className="card p-4">
                <div className="flex items-center gap-3">
                  <Avatar u={u} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{nombre(u)}</p>
                    <p className="truncate text-sm text-slate-500">{u.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy === u.uid}
                  onClick={() => darAcceso(u, 'coordinador')}
                  className="btn-primary mt-3 min-h-[50px] w-full"
                >
                  {busy === u.uid ? <Spinner className="h-5 w-5" /> : <CheckIcon className="text-lg" />}
                  Dar acceso como Coordinador
                </button>
                <div className="mt-2 flex gap-2">
                  {isSuperAdmin && (
                    <>
                      <button
                        type="button"
                        disabled={busy === u.uid}
                        onClick={() => {
                          setEditando(u);
                          setRolNuevo('coordinador');
                        }}
                        className="btn-secondary min-h-[44px] flex-1 text-sm"
                      >
                        Con otro rol
                      </button>
                      <button
                        type="button"
                        disabled={busy === u.uid}
                        onClick={() => noEsDelEquipo(u)}
                        className="btn-ghost min-h-[44px] flex-1 text-sm text-rose-600"
                      >
                        No es del equipo
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2) El equipo */}
      <section className="space-y-3">
        <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500">Equipo ({equipo.length})</h3>
        <ul className="card divide-y divide-white/5 overflow-hidden">
          {equipo.map((u) => {
            const principal = esPrincipal(u);
            const yo = u.uid === profile?.uid;
            const editable = isSuperAdmin && !principal && !yo;
            return (
              <li key={u.uid}>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => abrirEdicion(u)}
                  className={`flex w-full items-center gap-3 p-4 text-left ${editable ? 'active:bg-white/5' : ''} ${
                    u.active ? '' : 'opacity-50'
                  }`}
                >
                  <Avatar u={u} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">
                      {nombre(u)}
                      {yo && <span className="ml-1 text-xs font-normal text-slate-500">(tú)</span>}
                    </span>
                    <span className="block truncate text-sm text-slate-500">{u.email}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`chip ${
                        principal
                          ? 'bg-primary-500 text-white'
                          : u.role === 'admin'
                            ? 'bg-accent-100 text-accent-700'
                            : u.puedeProgramar
                              ? 'bg-primary-500/15 text-primary-500'
                              : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {nombreDeRol(u)}
                    </span>
                    {!u.active && <span className="chip bg-rose-100 text-rose-600">Sin acceso</span>}
                    </span>
                  </span>
                  {editable && <span className="shrink-0 text-xs font-semibold text-primary-500">Cambiar</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {!isSuperAdmin && (
          <p className="px-1 text-xs text-slate-500">Los roles los cambia el correo principal.</p>
        )}
      </section>

      {/* 3) Entrada directa */}
      <section className="space-y-3">
        <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-slate-500">Entrada directa</h3>
        <div className="card space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Los correos de esta lista entran con Google y ya tienen su rol, sin esperar. Puedes pegar
            varios a la vez.
          </p>
          <textarea
            className="input min-h-[96px]"
            placeholder={'correo1@gmail.com\ncorreo2@gmail.com'}
            value={correos}
            onChange={(e) => setCorreos(e.target.value)}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Correos con entrada directa"
          />
          {isSuperAdmin && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRolInvita(r)}
                  aria-pressed={rolInvita === r}
                  className={`min-h-[44px] rounded-2xl border px-3 text-sm font-semibold ${
                    rolInvita === r ? 'border-primary-500 bg-primary-500/10 text-primary-500' : 'border-white/10 text-slate-600'
                  }`}
                >
                  {ROL_VISIBLE[r].nombre}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={agregarCorreos} disabled={invitando} className="btn-primary min-h-[48px] w-full">
            {invitando ? <Spinner className="h-5 w-5" /> : null}
            Agregar a la entrada directa
          </button>

          {invites.length > 0 && (
            <ul className="divide-y divide-white/5 border-t border-white/5 pt-1">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-800">{inv.email}</span>
                    <span className="block text-xs text-slate-500">
                      {nombreDeRol({ role: inv.role, puedeProgramar: inv.puedeProgramar })} · todavía no ha entrado
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => quitarInvitacion(inv)}
                    disabled={busy === inv.id}
                    className="tap rounded-full text-slate-400 hover:text-rose-500"
                    aria-label={`Quitar ${inv.email}`}
                  >
                    <TrashIcon className="text-base" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Cambiar el rol (solo el principal) */}
      <Modal open={editando !== null} onClose={() => setEditando(null)} title={editando ? nombre(editando) : ''}>
        {editando && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">{editando.email}</p>
            <ElegirRol valor={rolNuevo} onChange={setRolNuevo} />
            <button
              type="button"
              onClick={guardarRol}
              disabled={busy === editando.uid || !rolNuevo}
              className="btn-primary btn-lg"
            >
              {busy === editando.uid ? <Spinner className="h-5 w-5" /> : null}
              {editando.role === 'pending' ? 'Dar acceso' : 'Guardar'}
            </button>
            {editando.role !== 'pending' && (
              <button
                type="button"
                onClick={() => cambiarAcceso(editando)}
                disabled={busy === editando.uid}
                className={`btn-ghost min-h-[44px] w-full text-sm ${editando.active ? 'text-rose-600' : ''}`}
              >
                {editando.active ? 'Quitarle el acceso' : 'Devolverle el acceso'}
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
