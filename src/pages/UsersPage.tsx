import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { SUPER_ADMIN_EMAIL } from '../lib/firebase';
import {
  listenUsers,
  approveUser,
  updateUserRole,
  setUserActive,
  listenInvites,
  createInvite,
  deleteInvite,
  type Invite,
} from '../services/users';
import type { UserProfile, Role } from '../types';
import { ROLE_LABELS } from '../lib/constants';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { UsersIcon, TrashIcon, CheckIcon, PlusIcon } from '../components/Icons';
import { esperarConLimite } from '../lib/esperar';

export function UsersPage() {
  const { profile, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('coordinador');
  const [savingInvite, setSavingInvite] = useState(false);

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
    const u2 = listenInvites(
      (list) => setInvites(list),
      (e) => console.error(e),
    );
    return () => {
      u1();
      u2();
    };
  }, [toast]);

  const pending = useMemo(() => users.filter((u) => u.role === 'pending'), [users]);
  const withAccess = useMemo(
    () => users.filter((u) => u.role !== 'pending'),
    [users],
  );

  // Roles que puedo asignar (el admin normal solo crea coordinadoras).
  const assignable: Role[] = isSuperAdmin
    ? ['coordinador', 'admin']
    : ['coordinador'];

  const isSuperDoc = (u: UserProfile) => u.email === SUPER_ADMIN_EMAIL;
  const canManage = (u: UserProfile) => {
    if (isSuperDoc(u)) return false;
    if (u.uid === profile?.uid) return false;
    if (u.role === 'admin' && !isSuperAdmin) return false;
    return true;
  };

  // Quién se está guardando ahora mismo: evita el doble toque y deja ver
  // que la acción está en curso.
  const [busy, setBusy] = useState<string | null>(null);
  const nombre = (u: UserProfile) => u.displayName || u.email;

  /**
   * Corre una escritura con aviso. Sin señal, Firestore la guarda en el
   * teléfono y la envía al volver: en vez de dejar el botón girando para
   * siempre, se avisa de eso.
   */
  const guardar = async (
    id: string,
    escritura: () => Promise<unknown>,
    ok: string,
    fallo: string,
  ) => {
    setBusy(id);
    try {
      const enviado = await esperarConLimite(escritura());
      toast(
        enviado ? ok : 'Sin conexión: el cambio se enviará cuando vuelva la señal.',
        enviado ? 'success' : 'info',
      );
    } catch (e) {
      console.error(e);
      toast(fallo, 'error');
    } finally {
      setBusy(null);
    }
  };

  const approve = (u: UserProfile, role: Role) => {
    if (
      role === 'admin' &&
      !window.confirm(
        `¿Dar acceso a ${nombre(u)} como ${ROLE_LABELS.admin}? Podrá ver el panel, editar personas y aprobar usuarios.`,
      )
    )
      return;
    void guardar(
      u.uid,
      () => approveUser(u.uid, role),
      `${nombre(u)} ahora es ${ROLE_LABELS[role]}.`,
      'No se pudo aprobar.',
    );
  };
  const changeRole = (u: UserProfile, role: Role) => {
    if (role === u.role) return;
    if (
      (role === 'admin' || u.role === 'admin') &&
      !window.confirm(
        `¿Cambiar el permiso de ${nombre(u)} de ${ROLE_LABELS[u.role]} a ${ROLE_LABELS[role]}?`,
      )
    )
      return;
    void guardar(
      u.uid,
      () => updateUserRole(u.uid, role),
      'Permiso actualizado.',
      'No se pudo cambiar el permiso.',
    );
  };
  const toggleActive = (u: UserProfile) => {
    if (
      u.active &&
      !window.confirm(
        `¿Quitarle el acceso a ${nombre(u)}? Ya no podrá entrar a la app ni tomar asistencia. Puedes reactivarla cuando quieras.`,
      )
    )
      return;
    void guardar(
      u.uid,
      () => setUserActive(u.uid, !u.active),
      u.active ? 'Acceso quitado.' : 'Acceso reactivado.',
      'No se pudo cambiar el acceso.',
    );
  };

  const sendInvite = async () => {
    if (!profile || savingInvite) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast('Escribe un correo válido.', 'error');
      return;
    }
    // Si la persona ya entró, la invitación no sirve de nada (solo se lee en
    // el primer ingreso): lo que toca es cambiarle el permiso arriba.
    const yaEntro = users.find((u) => u.email.toLowerCase() === email);
    if (yaEntro) {
      toast(
        yaEntro.role === 'pending'
          ? 'Esa persona ya entró: apruébala arriba en “Solicitudes nuevas”.'
          : 'Esa persona ya tiene acceso: cambia su permiso en la lista de arriba.',
        'info',
      );
      return;
    }
    const previa = invites.find((i) => i.id === email);
    if (previa && previa.role === inviteRole) {
      toast('Ese correo ya estaba invitado.', 'info');
      return;
    }
    setSavingInvite(true);
    try {
      const enviado = await esperarConLimite(createInvite(email, inviteRole, profile));
      toast(
        enviado
          ? previa
            ? 'Invitación actualizada.'
            : 'Invitación creada.'
          : 'Sin conexión: la invitación se enviará cuando vuelva la señal.',
        enviado ? 'success' : 'info',
      );
      setInviteEmail('');
    } catch (e) {
      console.error(e);
      toast('No se pudo crear la invitación.', 'error');
    } finally {
      setSavingInvite(false);
    }
  };

  const removeInvite = (inv: Invite) => {
    if (!window.confirm(`¿Eliminar la invitación de ${inv.email}?`)) return;
    void guardar(
      inv.id,
      () => deleteInvite(inv.id),
      'Invitación eliminada.',
      'No se pudo eliminar la invitación.',
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-primary-900">Usuarios</h2>
        <p className="text-sm text-slate-500">
          Aquí decides quién puede usar la app y con qué permisos.
        </p>
      </div>

      {/* 1) Solicitudes nuevas */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-primary-800">
          🔔 Solicitudes nuevas
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-primary-500 px-2 py-0.5 text-xs font-bold text-white">
              {pending.length}
            </span>
          )}
        </h3>

        {pending.length === 0 ? (
          <p className="rounded-xl border border-primary-100 bg-white px-4 py-4 text-center text-sm text-slate-400">
            No hay solicitudes por ahora. Cuando alguien entre por primera vez,
            aparecerá aquí para que la apruebes.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((u) => (
              <li key={u.uid} className="card p-4">
                <p className="font-semibold text-slate-800">
                  {u.displayName || u.email}
                </p>
                <p className="mb-3 text-xs text-slate-400">{u.email}</p>
                <p className="mb-2 text-xs font-medium text-slate-500">
                  Dale acceso como:
                </p>
                <div className="flex flex-wrap gap-2">
                  {assignable.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => approve(u, r)}
                      disabled={busy === u.uid}
                      className={
                        r === 'coordinador' ? 'btn-primary py-2.5' : 'btn-secondary py-2.5'
                      }
                    >
                      <CheckIcon className="text-lg" />
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2) Personas con acceso */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-primary-800">
          Personas con acceso ({withAccess.length})
        </h3>
        {withAccess.length === 0 ? (
          <EmptyState icon={<UsersIcon />} title="Aún no hay nadie con acceso" />
        ) : (
          <ul className="space-y-2">
            {withAccess.map((u) => {
              const superDoc = isSuperDoc(u);
              const manageable = canManage(u);
              return (
                <li key={u.uid} className={`card p-4 ${u.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-800">
                        {u.displayName || u.email}
                        {u.uid === profile?.uid && (
                          <span className="ml-1 text-xs font-normal text-slate-400">
                            (tú)
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-slate-400">{u.email}</p>
                    </div>
                    <span
                      className={`chip whitespace-nowrap ${
                        superDoc
                          ? 'bg-amber-100 text-amber-700'
                          : u.role === 'admin'
                            ? 'bg-accent-100 text-accent-700'
                            : 'bg-primary-100 text-primary-700'
                      }`}
                    >
                      {u.role === 'super_admin'
                        ? 'Dueña'
                        : ROLE_LABELS[u.role]}
                    </span>
                  </div>

                  {superDoc ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Cuenta principal protegida.
                    </p>
                  ) : manageable ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-slate-500">Permiso:</label>
                      <select
                        className="input w-auto flex-1 py-2"
                        value={u.role}
                        disabled={busy === u.uid}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                      >
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                        {!assignable.includes(u.role) && (
                          <option value={u.role}>{ROLE_LABELS[u.role]}</option>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => toggleActive(u)}
                        disabled={busy === u.uid}
                        className={`min-h-[44px] rounded-full px-4 text-sm font-semibold disabled:opacity-60 ${
                          u.active
                            ? 'bg-rose-100 text-rose-600 active:bg-rose-200'
                            : 'bg-primary-100 text-primary-700 active:bg-primary-200'
                        }`}
                      >
                        {busy === u.uid ? (
                          <Spinner className="h-4 w-4" />
                        ) : u.active ? (
                          'Quitar acceso'
                        ) : (
                          'Reactivar'
                        )}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">
                      {u.uid === profile?.uid
                        ? 'Este eres tú.'
                        : 'Solo la dueña puede cambiar a este usuario.'}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3) Invitar por correo (opcional, plegable) */}
      <section>
        <button
          type="button"
          onClick={() => setShowInvite((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-dashed border-primary-200 bg-white px-4 py-3 text-left text-sm font-medium text-primary-700"
        >
          <span>➕ Invitar a alguien por correo (opcional)</span>
          <span className="text-primary-500">{showInvite ? 'Ocultar' : 'Abrir'}</span>
        </button>

        {showInvite && (
          <div className="card mt-2 space-y-3 p-4">
            <p className="text-sm text-slate-500">
              Úsalo solo si quieres dejar el permiso listo <strong>antes</strong> de
              que la persona entre por primera vez. Si la persona <strong>ya
              entró</strong>, no uses esto: apruébala arriba en “Solicitudes
              nuevas”.
            </p>
            <form
              className="space-y-3"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void sendInvite();
              }}
            >
              <input
                className="input"
                type="email"
                placeholder="correo@ejemplo.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                aria-label="Correo de la persona a invitar"
              />
              <div className="flex gap-2">
                <select
                  className="input flex-1"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                >
                  {assignable.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={savingInvite}
                  className="btn-primary"
                >
                  {savingInvite ? (
                    <Spinner className="h-5 w-5 text-white" />
                  ) : (
                    <PlusIcon className="text-lg" />
                  )}
                  Invitar
                </button>
              </div>
            </form>

            {invites.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {invites.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-slate-700">{inv.email}</span>{' '}
                      <span className="chip bg-primary-100 text-primary-700">
                        {ROLE_LABELS[inv.role]}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeInvite(inv)}
                      disabled={busy === inv.id}
                      className="tap rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 active:bg-rose-50 disabled:opacity-50"
                      aria-label={`Eliminar la invitación de ${inv.email}`}
                    >
                      <TrashIcon className="text-base" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
