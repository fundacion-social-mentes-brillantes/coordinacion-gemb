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
import { UsersIcon, TrashIcon, UserPlusIcon } from '../components/Icons';

export function UsersPage() {
  const { profile, isSuperAdmin } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

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

  const pending = useMemo(
    () => users.filter((u) => u.role === 'pending'),
    [users],
  );
  const active = useMemo(
    () => users.filter((u) => u.role !== 'pending'),
    [users],
  );

  // Roles que el usuario actual puede asignar.
  const assignable: Role[] = isSuperAdmin
    ? ['coordinador', 'admin']
    : ['coordinador'];

  const isSuperDoc = (u: UserProfile) => u.email === SUPER_ADMIN_EMAIL;
  // ¿Puedo administrar este usuario? (los admins no gestionan a otros admins)
  const canManage = (u: UserProfile) => {
    if (isSuperDoc(u)) return false;
    if (u.uid === profile?.uid) return false; // no editarme a mí mismo aquí
    if (u.role === 'admin' && !isSuperAdmin) return false;
    return true;
  };

  const handleApprove = async (u: UserProfile, role: Role) => {
    try {
      await approveUser(u.uid, role);
      toast(`${u.displayName || u.email} aprobado como ${ROLE_LABELS[role]}.`, 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo aprobar.', 'error');
    }
  };

  const handleRole = async (u: UserProfile, role: Role) => {
    try {
      await updateUserRole(u.uid, role);
      toast('Rol actualizado.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo actualizar el rol.', 'error');
    }
  };

  const handleActive = async (u: UserProfile) => {
    try {
      await setUserActive(u.uid, !u.active);
      toast(u.active ? 'Usuario desactivado.' : 'Usuario reactivado.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo cambiar el estado.', 'error');
    }
  };

  const handleInvite = async () => {
    if (!profile) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast('Escribe un correo válido.', 'error');
      return;
    }
    setSavingInvite(true);
    try {
      await createInvite(email, inviteRole, profile);
      toast('Invitación creada. La persona quedará con ese rol al ingresar.', 'success');
      setInviteEmail('');
    } catch (e) {
      console.error(e);
      toast('No se pudo crear la invitación.', 'error');
    } finally {
      setSavingInvite(false);
    }
  };

  const removeInvite = async (inv: Invite) => {
    try {
      await deleteInvite(inv.id);
      toast('Invitación eliminada.', 'success');
    } catch (e) {
      console.error(e);
      toast('No se pudo eliminar.', 'error');
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
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-primary-900">Usuarios</h2>

      {/* Pendientes */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Pendientes de aprobación ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-400">
            No hay solicitudes pendientes.
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((u) => (
              <li key={u.uid} className="card p-3">
                <p className="font-medium text-slate-800">
                  {u.displayName || u.email}
                </p>
                <p className="text-xs text-slate-400">{u.email}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {assignable.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleApprove(u, r)}
                      className="btn-primary py-2 text-sm"
                    >
                      Aprobar como {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Invitaciones */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Pre-autorizar por correo
        </h3>
        <div className="card space-y-3 p-4">
          <p className="text-sm text-slate-500">
            Deja lista a una persona con su rol antes de que ingrese por primera
            vez.
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
              onClick={handleInvite}
              disabled={savingInvite}
              className="btn-primary"
            >
              {savingInvite ? (
                <Spinner className="h-5 w-5 text-white" />
              ) : (
                <UserPlusIcon className="text-lg" />
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
                    onClick={() => removeInvite(inv)}
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
      </section>

      {/* Usuarios con rol */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Personas con acceso ({active.length})
        </h3>
        {active.length === 0 ? (
          <EmptyState icon={<UsersIcon />} title="Aún no hay usuarios con rol" />
        ) : (
          <ul className="space-y-2">
            {active.map((u) => {
              const superDoc = isSuperDoc(u);
              const manageable = canManage(u);
              return (
                <li
                  key={u.uid}
                  className={`card p-3 ${u.active ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">
                        {u.displayName || u.email}
                        {u.uid === profile?.uid && (
                          <span className="ml-1 text-xs text-slate-400">(tú)</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-slate-400">{u.email}</p>
                    </div>
                    <span
                      className={`chip ${
                        superDoc
                          ? 'bg-amber-100 text-amber-700'
                          : u.role === 'admin'
                            ? 'bg-accent-100 text-accent-700'
                            : 'bg-primary-100 text-primary-700'
                      }`}
                    >
                      {ROLE_LABELS[u.role]}
                    </span>
                  </div>

                  {superDoc ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Cuenta protegida (no se puede degradar ni desactivar).
                    </p>
                  ) : manageable ? (
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        className="input flex-1 py-2"
                        value={u.role}
                        onChange={(e) => handleRole(u, e.target.value as Role)}
                      >
                        {assignable.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                        {/* Mantén visible el rol actual aunque no sea asignable por ti */}
                        {!assignable.includes(u.role) && (
                          <option value={u.role}>{ROLE_LABELS[u.role]}</option>
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleActive(u)}
                        className={`chip ${
                          u.active
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-primary-100 text-primary-700'
                        }`}
                      >
                        {u.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">
                      {u.uid === profile?.uid
                        ? 'Este eres tú.'
                        : 'Solo el super administrador puede gestionar a este usuario.'}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
