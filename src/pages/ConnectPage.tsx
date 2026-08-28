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
  // La pantalla de conectores de Claude solo pide una dirección: no tiene
  // dónde poner cabeceras. Por eso se entrega ya con la llave dentro.
  const enlace = llave ? `${URL_MCP}?k=${encodeURIComponent(llave)}` : '';

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
        {esAdmin ? (
          <>
            <p className="mt-1 text-sm font-semibold text-primary-700">
              Lectura y escritura
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Podrá consultar todo lo que tú ves (reuniones, asistencia, personas,
              bandeja de revisión) y además <strong>registrar y corregir</strong>:
              crear reuniones, marcar o quitar asistencia, cerrar o reabrir, y
              aprobar personas nuevas.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Nada se guarda de golpe: cada cambio te lo muestra primero como
              borrador y espera tu aprobación.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm font-semibold text-primary-700">
              Solo lectura
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Podrá consultar las reuniones y cómo va el grupo. <strong>No puede
              cambiar nada</strong>: ni marcar asistencia, ni crear reuniones, ni
              tocar fichas. El historial de una persona concreta y la bandeja de
              revisión también son de administración.
            </p>
          </>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Nunca ve teléfonos ni las notas privadas de las fichas.
        </p>
      </div>

      {/* Pasos */}
      <ol className="space-y-3">
        <li className="card p-4">
          <p className="font-semibold text-slate-800">1. Copia tu enlace personal</p>
          <p className="mt-1 text-sm text-slate-600">
            Lleva tu llave dentro: es lo que le dice a Claude que eres tú.
          </p>

          <button
            type="button"
            onClick={() => copiar(enlace, 'Tu enlace')}
            className="btn-primary mt-3 min-h-[52px] w-full"
            disabled={!enlace}
          >
            <ClipboardIcon className="text-lg" /> Copiar mi enlace
          </button>

          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="mt-2 w-full text-xs font-medium text-primary-600"
          >
            {visible ? 'Ocultar' : 'Ver el enlace'}
          </button>
          {visible && (
            <p className="mt-2 break-all rounded-lg bg-slate-100 p-2 font-mono text-[10px] leading-tight text-slate-600">
              {enlace || 'No disponible: cierra sesión y vuelve a entrar.'}
            </p>
          )}

          <p className="mt-3 text-xs text-amber-700">
            ⚠️ Trátalo como una contraseña: quien lo tenga entra como tú. No lo
            publiques ni lo mandes a grupos.
          </p>
        </li>

        <li className="card p-4">
          <p className="font-semibold text-slate-800">2. Pégalo en Claude</p>
          <p className="mt-1 text-sm text-slate-600">
            claude.ai → Configuración → <strong>Conectores</strong> →{' '}
            <em>Agregar conector personalizado</em> → pega el enlace → Agregar.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Si ya lo agregaste sin la llave, desconéctalo primero y vuelve a
            agregarlo con este enlace.
          </p>
        </li>

        <li className="card p-4">
          <p className="font-semibold text-slate-800">3. Pruébalo</p>
          <p className="mt-1 text-sm text-slate-600">
            Pregúntale: <em>“¿con qué cuenta estás conectado?”</em>. Debe
            responder con tu nombre y tu rol. Si dice que falta la llave, es que
            el enlace se pegó incompleto.
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
