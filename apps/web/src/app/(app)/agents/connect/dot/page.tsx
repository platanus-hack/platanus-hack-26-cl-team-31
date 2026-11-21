import { secondaryText, textLink } from "../../../ui";
import { Wizard } from "../_components/Wizard";

export default async function DotPage({ searchParams }: PageProps<"/agents/connect/dot">) {
  return (
    <Wizard kind="dot" agentId={(await searchParams).agentId}
      install={<p className={secondaryText}>En <a href="https://chatgpt.com/plugins" className={textLink}>ChatGPT Plugins</a>, abre <strong>Add custom MCP server</strong>, agrega la URL con el nombre <strong>Nexo</strong> y selecciona OAuth.</p>}
      login={<p className={secondaryText}>En la personalización del Dot, abre <strong>Plugins</strong> y agrega Nexo. La conexión con un Dot real está pendiente de verificar.</p>}
      wake={<p className={secondaryText}>Copia esta instrucción para pedirle al Dot que se suscriba a los eventos de Nexo. <a href="https://developers.openai.com/plugins/build/mcp-events" className={textLink}>Guía de eventos MCP</a></p>} />
  );
}
