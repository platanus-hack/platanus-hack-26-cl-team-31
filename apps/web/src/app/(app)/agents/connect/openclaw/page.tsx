import { secondaryText, textLink } from "../../../ui";
import { CopyBox } from "../_components/CopyBox";
import { Wizard } from "../_components/Wizard";

export default async function OpenClawPage({ searchParams }: PageProps<"/agents/connect/openclaw">) {
  return (
    <Wizard kind="openclaw" agentId={(await searchParams).agentId}
      install={<p className={secondaryText}>Agrega la entrada <code>sideband</code> a <code>mcp.servers</code> en <code>openclaw.json</code> y conserva los servidores que ya tengas. <a href="https://docs.openclaw.ai/cli/mcp/transports" className={textLink}>Guía de transportes y OAuth</a></p>}
      login={(
        <>
          <p className={secondaryText}>Con el gateway ejecutándose, corre este comando y abre el enlace que aparezca. La conexión con un gateway real está pendiente de verificar.</p>
          <CopyBox label="Comando de inicio de sesión" value="openclaw mcp login sideband" />
        </>
      )}
      wake={<p className={secondaryText}>Activa <code>hooks.enabled</code>, configura <code>hooks.token</code> y agrega <code>main</code> a <code>hooks.allowedAgentIds</code>. Ingresa el origen público del gateway. Sideband agrega <code>/hooks/agent</code>. <a href="https://docs.openclaw.ai/gateway/config-hooks" className={textLink}>Guía de hooks</a></p>} />
  );
}
