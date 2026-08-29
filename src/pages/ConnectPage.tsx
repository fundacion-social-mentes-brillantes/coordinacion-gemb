import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/Modal';
import { ClipboardIcon, LockIcon, CheckIcon, ArrowLeftIcon } from '../components/Icons';

const URL_MCP = 'https://coordinacion-gemb.vercel.app/api/mcp';

/**
 * "Conectar con Claude".
 *
 * Ya no se copia ninguna llave. Antes esta pantalla entregaba un enlace con el
 * permiso de sesión metido dentro (…/api/mcp?k=<llave>), y eso obligaba a cada
 * persona a manejar un secreto en texto plano: pegarlo, guardarlo, quizá
 * mandárselo por WhatsApp. Ahora se entra con Google desde el propio Claude,
 * como en cualquier otro conector, y aquí solo queda una dirección pública.
 *
 * Lo que Claude podrá hacer sale del rol de cada quien en la app; no hay nada
 * que configurar por persona.
 */
export function ConnectPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [manual, setManual] = useState<string | null>(null);

  const esAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(URL_MCP);
      toast('Dirección copiada.', 'success');
    } catch {
      setManual(URL_MCP);
    }
  };

  return (
    <div className="space-y-4">
      <Link
        to="/ajustes"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500"
      >
        <ArrowLeftIcon /> Ajustes
      </Link>

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
          Se conectará como{' '}
          <strong className="text-primary-800">
            {profile?.displayName || profile?.email}
          </strong>
        </p>
        {esAdmin ? (
          <>
            <p className="mt-1 text-sm font-semibold text-primary-700">Lectura y escritura</p>
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
            <p className="mt-1 text-sm font-semibold text-primary-700">Solo lectura</p>
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
          <p className="font-semibold text-slate-800">1. Copia esta dirección</p>
          <p className="mt-1 text-sm text-slate-600">
            No es secreta y es la misma para todo el mundo: sin entrar con tu
            Google no sirve de nada.
          </p>
          <p className="mt-2 break-all rounded-lg bg-slate-100 p-2 font-mono text-[11px] leading-tight text-slate-600">
            {URL_MCP}
          </p>
          <button type="button" onClick={copiar} className="btn-primary mt-3 min-h-[52px] w-full">
            <ClipboardIcon className="text-lg" /> Copiar la dirección
          </button>
        </li>

        <li className="card p-4">
          <p className="font-semibold text-slate-800">2. Agrégala en Claude</p>
          <p className="mt-1 text-sm text-slate-600">
            En claude.ai: <strong>Personalizar</strong> → <strong>Conectores</strong>{' '}
            → <em>Agregar</em> → <em>Agregar conector personalizado</em>.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            <li>
              · Nombre: <strong>Coordinadores</strong> (o el que prefieras)
            </li>
            <li>· Dirección: la que acabas de copiar</li>
          </ul>
          <p className="mt-2 text-sm text-slate-600">
            En <em>Autenticación</em> deja marcado{' '}
            <strong>“Siempre requerido”</strong>. Si eliges “Ninguno”, el conector
            se agrega vacío, sin herramientas.
          </p>
        </li>

        <li className="card p-4">
          <p className="font-semibold text-slate-800">3. Entra con Google</p>
          <p className="mt-1 text-sm text-slate-600">
            En la lista de conectores, toca <strong>Conectar</strong>. Se abre
            esta misma app, entras con tu cuenta de siempre y tocas{' '}
            <strong>Permitir</strong>. Eso es todo: no hay nada que pegar.
          </p>
        </li>

        <li className="card p-4">
          <p className="font-semibold text-slate-800">4. Pruébalo</p>
          <p className="mt-1 text-sm text-slate-600">
            Pregúntale: <em>“¿con qué cuenta estás conectado?”</em>. Debe
            responder con tu nombre y tu rol.
          </p>
        </li>
      </ol>

      <div className="card border-amber-200 bg-amber-50/60 p-4">
        <p className="flex items-start gap-2 text-sm text-amber-900">
          <LockIcon className="mt-0.5 shrink-0 text-base" />
          <span>
            <strong>Si alguna vez quieres cortarla:</strong> sal de la app con el
            botón de salir (arriba a la derecha). Eso corta el acceso de Claude al
            instante y habrá que volver a conectar. Una administradora también
            puede desactivar tu cuenta en Usuarios.
          </span>
        </p>
      </div>

      <p className="flex items-start gap-2 px-1 text-xs text-slate-400">
        <CheckIcon className="mt-0.5 shrink-0" />
        <span>
          El permiso no se guarda en ningún servidor nuestro: viaja con cada
          consulta, se usa y se descarta. Por eso Claude ve exactamente lo mismo
          que tú, ni más ni menos.
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
            className="input h-24 w-full break-all font-mono text-[11px]"
          />
        </div>
      </Modal>
    </div>
  );
}
