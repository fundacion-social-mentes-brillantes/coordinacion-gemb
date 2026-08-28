import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/Modal';
import { ClipboardIcon, LockIcon, CheckIcon } from '../components/Icons';

const URL_MCP = 'https://coordinacion-gemb.vercel.app/api/mcp';

/**
 * "Conectar con Claude": entrega a cada persona su llave personal para que
 * Claude pueda consultar la asistencia EN SU NOMBRE.
 *
 * La llave es el mismo permiso que ya tiene este navegador por haber iniciado
 * sesión con Google. No se guarda en ningún servidor: viaja en cada consulta,
 * se usa y se descarta. Por eso Claude ve exactamente lo que ve la persona,
 * ni más ni menos, y se le corta el acceso desactivándola en Usuarios.
 */
export function ConnectPage() {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  const llave = user?.refreshToken ?? '';
  const esAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const copiar = async (valor: string, que: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      toast(`${que} copiado.`, 'success');
    } catch {
      setManual(valor);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-primary-900">Conectar con Claude</h2>
        <p className="mt-1 text-sm text-slate-500">
          Para poder preguntarle por la asistencia sin entrar a la app: “¿cuántas
          personas están haciendo Pasos últimamente?”, “¿quién dejó de venir?”.
        </p>
      </div>

      {/* Qué verá Claude, según quién eres */}
      <div className="card p-4">
        <p className="text-sm text-slate-600">
          Se conectará como <strong className="text-primary-800">{profile?.displayName || profile?.email}</strong>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {esAdmin
            ? 'Como administradora, Claude podrá consultar todo lo que tú ves: reuniones, asistencia, personas y la bandeja de revisión.'
            : 'Como coordinadora, Claude podrá consultar las reuniones y cómo va el grupo. El historial de una persona concreta y la bandeja de revisión son de administración.'}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Claude solo <strong>lee</strong>: no puede marcar asistencia, crear
          reuniones ni cambiar fichas. Nunca ve teléfonos ni notas privadas.
        </p>
      </div>

      {/* Pasos */}
      <ol className="space-y-3">
        <li className="card p-4">
          <p className="font-semibold text-slate-800">1. Copia tu llave personal</p>
          <p className="mt-1 text-xs text-slate-500">
            Es como tu contraseña: no se la pases a nadie ni la publiques.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => copiar(llave, 'Tu llave')}
              className="btn-primary min-h-[48px] flex-1"
              disabled={!llave}
            >
              <ClipboardIcon className="text-lg" /> Copiar mi llave
            </button>
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="btn-secondary min-h-[48px] px-4"
              aria-label={visible ? 'Ocultar la llave' : 'Ver la llave'}
            >
              {visible ? 'Ocultar' : 'Ver'}
            </button>
          </div>

          {visible && (
            <p className="mt-2 break-all rounded-lg bg-slate-100 p-2 font-mono text-[10px] leading-tight text-slate-600">
              {llave || 'No disponible: cierra sesión y vuelve a entrar.'}
            </p>
          )}
        </li>

        <li className="card p-4">
          <p className="font-semibold text-slate-800">2. Añade el conector en Claude</p>
          <p className="mt-1 text-sm text-slate-600">
            En claude.ai → Configuración → Conectores → <em>Agregar conector
            personalizado</em>. Pega esta dirección:
          </p>
          <button
            type="button"
            onClick={() => copiar(URL_MCP, 'La dirección')}
            className="btn-secondary mt-2 min-h-[48px] w-full text-xs"
          >
            <ClipboardIcon className="text-base" /> {URL_MCP}
          </button>
          <p className="mt-2 text-sm text-slate-600">
            Y en la autenticación, cabecera <code className="text-xs">Authorization</code> con
            el valor <code className="text-xs">Bearer</code> + tu llave.
          </p>
        </li>

        <li className="card p-4">
          <p className="font-semibold text-slate-800">3. Pruébalo</p>
          <p className="mt-1 text-sm text-slate-600">
            Pregúntale: <em>“¿con qué cuenta estás conectado?”</em>. Debe
            responder con tu nombre y tu rol. Después ya puedes preguntarle
            cualquier cosa de la asistencia.
          </p>
        </li>
      </ol>

      <div className="card border-amber-200 bg-amber-50/60 p-4">
        <p className="flex items-start gap-2 text-sm text-amber-900">
          <LockIcon className="mt-0.5 shrink-0 text-base" />
          <span>
            <strong>Si alguna vez quieres cortarla:</strong> sal de la app con el
            botón de salir (arriba a la derecha). Eso invalida la llave al
            instante y tendrás que copiar una nueva. Una administradora también
            puede desactivar tu cuenta en Usuarios.
          </span>
        </p>
      </div>

      <p className="flex items-start gap-2 px-1 text-xs text-slate-400">
        <CheckIcon className="mt-0.5 shrink-0" />
        <span>
          Tu llave no se guarda en ningún servidor: viaja con cada consulta, se
          usa y se descarta. Por eso Claude ve exactamente lo mismo que tú.
        </span>
      </p>

      <Modal open={manual !== null} onClose={() => setManual(null)} title="Copia esto">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Tu navegador no dejó copiarlo solo. Mantén pulsado el texto,
            selecciónalo todo y cópialo.
          </p>
          <textarea
            readOnly
            value={manual ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            className="input h-40 w-full break-all font-mono text-[10px]"
          />
        </div>
      </Modal>
    </div>
  );
}
