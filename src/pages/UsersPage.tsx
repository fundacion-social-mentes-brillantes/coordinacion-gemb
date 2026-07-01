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

  const approve = async (u: UserProfile, role: Role) => {
    try {
      await approveUser(u.uid, role);
      toast(`${u.displayName || u.email} ahora es ${ROLE_LABELS[role]}.`, 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo aprobar.', 'error');
    }
  };
  const changeRole = async (u: UserProfile, role: Role) => {
    try {
      await updateUserRole(u.uid, role);
      toast('Rol actualizado.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo cambiar el rol.', 'error');
    }
  };
  const toggleActive = async (u: UserProfile) => {
    try {
      await setUserActive(u.uid, !u.active);
      toast(u.active ? 'Acceso quitado.' : 'Acceso reactivado.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo cambiar el estado.', 'error');
    }
  };

  const sendInvite = async () => {
    if (!profile) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast('Escribe un correo válido.', 'error');
      return;
    }
    setSavingInvite(true);
    try {
      await createInvite(email, inviteRole, profile);
      toast('Invitación creada.', 'success');
      setInviteEmail('');
    } catch (e) {
      console.error(e);
      toast('No se pudo crear la invitación.', 'error');
    } finally {
      setSavingInvite(false);
    }
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
                        className={`chip ${
                          u.active
                            ? 'bg-rose-100 text-rose-600'
                            : 'bg-primary-100 text-primary-700'
                        }`}
                      >
                        {u.active ? 'Quitar acceso' : 'Reactivar'}
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
            <input
              className="input"
              placeholder="correo@ejemplo.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              inputMode="email"
              autoComplete="off"
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
                type="button"
                onClick={sendInvite}
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
                      onClick={() => deleteInvite(inv.id)}
                      className="rounded-full p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Eliminar invitación"
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
