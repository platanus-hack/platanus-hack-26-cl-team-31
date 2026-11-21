// Estilos del visualizador, sin dependencias. Todo color, sombra, fuente y curva sale de tokens
// --af-* cuyos valores por defecto leen el sistema de diseño de apps/web (globals.css): en la landing
// se hereda el tema solo; el admin redefine los --af-* con sus tokens.
import type { FlowStatus } from "./model.js";

/** Tono de cada estado: color del texto/trazo y fondo suave, como el componente Status de la web. */
export const statusTone: Record<FlowStatus, { fg: string; bg: string }> = {
  pending: { fg: "var(--af-body)", bg: "var(--af-chip)" },
  ok: { fg: "var(--af-body)", bg: "var(--af-chip)" },
  allowed: { fg: "var(--af-success)", bg: "var(--af-success-bg)" },
  delivered: { fg: "var(--af-success)", bg: "var(--af-success-bg)" },
  denied: { fg: "var(--af-danger)", bg: "var(--af-danger-bg)" },
  blocked: { fg: "var(--af-danger)", bg: "var(--af-danger-bg)" },
  failed: { fg: "var(--af-danger)", bg: "var(--af-danger-bg)" },
  sanitized: { fg: "var(--af-info)", bg: "var(--af-info-bg)" },
  escalated: { fg: "var(--af-warn)", bg: "var(--af-warn-bg)" },
  expired: { fg: "var(--af-subtle)", bg: "var(--af-chip)" },
};

export const statusColor: Record<FlowStatus, string> = Object.fromEntries(
  Object.entries(statusTone).map(([status, tone]) => [status, tone.fg]),
) as Record<FlowStatus, string>;

export const css = `
.af-root{
  --af-canvas:var(--color-canvas,#121212);--af-card:var(--color-card,#181818);--af-card-hover:var(--color-card-hover,#1c1c1c);
  --af-raised:var(--color-raised,#1a1a1a);--af-button:var(--color-button,#2a2a2a);--af-button-hover:var(--color-button-hover,#333);
  --af-stage:var(--color-stage,#131313);--af-chip:var(--color-chip,rgb(255 255 255/.04));--af-chip-hover:var(--color-chip-hover,rgb(255 255 255/.08));
  --af-chip-active:var(--color-chip-active,rgb(255 255 255/.14));--af-line:var(--color-line,rgb(255 255 255/.07));--af-line-strong:var(--color-line-strong,rgb(255 255 255/.14));
  --af-ink:var(--color-ink,#fefefe);--af-body:var(--color-body,#b5b5b5);--af-muted:var(--color-muted,#9e9e9e);--af-subtle:var(--color-subtle,#767676);
  --af-accent:var(--color-accent,#0071fc);--af-accent-ink:var(--color-accent-ink,#7db4ff);--af-accent-soft:var(--color-accent-soft,rgb(0 113 252/.18));
  --af-success:var(--color-success,#7ddba3);--af-success-bg:var(--color-success-bg,rgb(125 219 163/.1));
  --af-warn:var(--color-warn,#f2c66d);--af-warn-bg:var(--color-warn-bg,rgb(242 198 109/.1));
  --af-info:var(--color-info,#7db4ff);--af-info-bg:var(--color-info-bg,rgb(0 113 252/.18));
  --af-danger:var(--color-danger,#ff8f80);--af-danger-bg:var(--color-danger-bg,rgb(255 120 100/.1));
  --af-ease:var(--ease-smooth-out,cubic-bezier(.22,1,.36,1));
  --af-font:var(--font-inter,var(--font-sans,Inter)),-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --af-mono:var(--font-roboto-mono,"Roboto Mono"),ui-monospace,SFMono-Regular,Menlo,monospace;
  --af-surface-shadow:0 1px 3px 0 rgb(0 0 0/.04),inset 0 1px 0 0 rgb(255 255 255/.04),inset 0 0 0 1px rgb(0 0 0/.06),inset 0 -1px 0 0 rgb(0 0 0/.06),inset 0 0 0 1px rgb(196 196 196/.07);
  --af-raised-shadow:0 1px 3px 0 rgb(0 0 0/.04),inset 0 1px 0 0 rgb(255 255 255/.04),inset 0 0 0 1px rgb(255 255 255/.06);
  --af-stage-shadow:inset 0 0 0 1px rgb(255 255 255/.02),inset 0 0 0 1px rgb(191 192 203/.08);
  position:relative;min-width:0;color:var(--af-ink);font-family:var(--af-font);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.af-frame{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0;transform-origin:0 0}
.af-fill{height:100%;overflow:hidden}
.af-fill .af-frame{height:100%;grid-template-rows:minmax(0,1fr);padding:16px}
.af-fill .af-frame.af-has-bar{grid-template-rows:auto minmax(0,1fr)}
.af-fill .af-layout{min-height:0;height:100%}
.af-fill .af-stage{transition:none}
.af-root:fullscreen{background:var(--af-canvas);width:100vw;height:100vh}
.af-expanded{position:fixed;inset:0;z-index:2147483000;background:var(--af-canvas)}
.af-root *,.af-root *::before,.af-root *::after{box-sizing:border-box}
.af-root :where(button){font:inherit;color:inherit}
.af-root :focus-visible{outline:2px solid var(--af-ink);outline-offset:2px}
.af-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.af-mono{font-family:var(--af-mono);font-variant-numeric:tabular-nums}
.af-eyebrow{margin:0;font-family:var(--af-mono);font-size:11px;font-weight:400;line-height:16px;letter-spacing:.08em;text-transform:uppercase;color:var(--af-subtle)}

/* Barra */
.af-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;max-width:100%}
.af-bar-spacer{flex:1 1 auto}
.af-wide .af-bar{flex-wrap:nowrap}

.af-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border:0;border-radius:999px;background:var(--af-button);box-shadow:var(--af-raised-shadow);color:#fff;font-size:13px;font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;transition:background-color .15s var(--af-ease)}
.af-btn:hover{background:var(--af-button-hover)}
.af-btn svg{flex:none}
.af-btn-icon{width:36px;padding:0}
.af-seg{display:inline-flex;align-items:center;gap:2px;height:36px;padding:3px;border-radius:999px;background:var(--af-button);box-shadow:var(--af-raised-shadow)}
.af-seg button{appearance:none;height:30px;min-width:40px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:var(--af-body);font-family:var(--af-mono);font-size:12px;cursor:pointer;transition:background-color .15s var(--af-ease),color .15s var(--af-ease)}
.af-seg button:hover{color:var(--af-ink)}
.af-seg button[aria-pressed=true]{background:var(--af-chip-active);color:var(--af-ink)}
.af-count{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:999px;background:var(--af-chip-active);font-family:var(--af-mono);font-size:11px;color:var(--af-ink)}
.af-tag{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 10px;border-radius:999px;font-size:11px;font-weight:500;line-height:1;white-space:nowrap}
.af-dot{width:6px;height:6px;border-radius:999px;flex:none;background:currentColor}

/* Filtro */
.af-filter{position:relative}
.af-filter>summary{list-style:none}
.af-filter>summary::-webkit-details-marker{display:none}
.af-menu{position:absolute;z-index:20;left:0;top:44px;width:min(296px,calc(100vw - 32px));max-height:380px;overflow:auto;padding:8px;border-radius:16px;background:var(--af-card);box-shadow:var(--af-surface-shadow),0 16px 40px rgb(0 0 0/.5)}
.af-menu fieldset{border:0;margin:0;padding:0;display:grid;gap:2px}
.af-menu .af-eyebrow{padding:6px 8px 4px}
.af-check{display:flex;align-items:center;gap:10px;min-height:32px;padding:4px 8px;border-radius:10px;font-size:13px;color:var(--af-ink);cursor:pointer}
.af-check:hover{background:var(--af-chip-hover)}
.af-check.af-sub{padding-left:34px;color:var(--af-body);font-size:12.5px}
.af-check input{accent-color:var(--af-accent);width:14px;height:14px;margin:0}
.af-check input:disabled+span{opacity:.5}
.af-menu-actions{display:flex;justify-content:flex-end;padding:8px 4px 2px;border-top:1px solid var(--af-line);margin-top:6px}
.af-menu-actions button{appearance:none;border:0;background:none;padding:4px;font-size:13px;font-weight:500;color:var(--af-accent-ink);cursor:pointer}

/* Escenario */
.af-layout{display:grid;gap:12px;grid-template-columns:minmax(0,1fr);min-width:0}
.af-wide .af-layout{grid-template-columns:minmax(0,1fr) 336px}
.af-stage{position:relative;overflow:hidden;min-width:0;border-radius:24px;background:var(--af-stage);box-shadow:var(--af-stage-shadow);transition:height .5s var(--af-ease)}
.af-stage::before{content:"";position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(var(--af-line) 1px,transparent 1px);background-size:24px 24px;background-position:12px 12px;opacity:.55;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 78%)}
.af-svg{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:visible;pointer-events:none}
.af-mode{position:absolute;z-index:3;top:12px;left:12px;display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 12px;border-radius:999px;background:var(--af-card);box-shadow:var(--af-raised-shadow);font-family:var(--af-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--af-muted)}
.af-mode .af-dot{color:var(--af-subtle)}
.af-mode[data-state=live] .af-dot{color:var(--af-success);animation:af-breathe 2s var(--af-ease) infinite}
.af-mode[data-state=playing] .af-dot{color:var(--af-accent-ink)}
.af-mode[data-state=paused] .af-dot{color:var(--af-warn)}

/* Aristas */
.af-edge{fill:none;stroke:var(--af-line-strong);stroke-width:1;transition:stroke .4s var(--af-ease)}
.af-edge[data-human]{stroke-dasharray:2 4}
.af-edge[data-hot]{stroke-width:1.5}
.af-edge[data-dim]{opacity:.35}

/* Tarjetas de titular */
.af-card{position:absolute;z-index:2;top:0;left:0;display:flex;flex-direction:column;gap:4px;padding:8px;border-radius:20px;background:var(--af-card);box-shadow:var(--af-surface-shadow);transition:transform .7s var(--af-ease),height .5s var(--af-ease);will-change:transform,opacity}
.af-card>*{transition:opacity .6s var(--af-ease)}
.af-card[data-passive]>*{opacity:.55}
.af-card[data-passive] .af-avatar{background:var(--af-chip-active);color:var(--af-body)}
.af-head-chip{margin-left:auto;flex:none;height:20px;padding:0 8px;font-size:10.5px}
.af-row[data-left]{opacity:.4}
/* Red densa: un avatar por titular */
.af-dotnode{position:absolute;z-index:2;top:0;left:0;display:flex;flex-direction:column;align-items:center;gap:6px;transition:transform .7s var(--af-ease);will-change:transform,opacity}
.af-dotnode>*{transition:opacity .6s var(--af-ease)}
.af-dotnode[data-passive]>*{opacity:.55}
.af-dot-avatar{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;background:var(--af-card);box-shadow:var(--af-surface-shadow);color:var(--af-ink);font-size:13px;font-weight:600;cursor:pointer;transition:box-shadow .3s var(--af-ease)}
.af-dot-avatar[data-activity=thinking]{box-shadow:var(--af-surface-shadow),0 0 0 2px var(--af-info)}
.af-dot-avatar[data-activity=waiting]{box-shadow:var(--af-surface-shadow),0 0 0 2px var(--af-line-strong)}
.af-dot-avatar[data-activity=deciding]{box-shadow:var(--af-surface-shadow),0 0 0 2px var(--af-warn)}
.af-dot-avatar[data-flash]{box-shadow:var(--af-surface-shadow),0 0 0 2px var(--af-flash)}
.af-dot-avatar[aria-pressed=true]{box-shadow:var(--af-surface-shadow),0 0 0 2px var(--af-ink)}
.af-dot-count{position:absolute;right:-4px;bottom:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--af-raised);box-shadow:var(--af-raised-shadow);font-family:var(--af-mono);font-size:10px;line-height:16px;color:var(--af-body)}
.af-dot-label{max-width:100%;font-size:11px;font-weight:500;line-height:16px;color:var(--af-body);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-dotnode[data-quiet] .af-dot-label{opacity:0}
.af-dotnode[data-quiet]:hover .af-dot-label,.af-dotnode[data-quiet]:focus-within .af-dot-label{opacity:1}
.af-dot-chip{position:absolute;top:-26px;white-space:nowrap}
.af-dot-chip .af-tag{height:20px;padding:0 8px;font-size:10.5px}
/* Efectos de presencia (SVG) */
.af-ripple{fill:none;stroke:var(--af-accent);stroke-width:1.5}
.af-ghost{fill:none;stroke:var(--af-line-strong);stroke-width:1;stroke-dasharray:4 4}
.af-discovery{fill:none;stroke:var(--af-accent-ink);stroke-width:1.25;stroke-dasharray:2 6;stroke-linecap:round}
/* Contador de la red */
.af-net{position:absolute;z-index:3;top:12px;right:12px;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;background:var(--af-card);box-shadow:var(--af-raised-shadow);font-size:12px;color:var(--af-muted);transition:box-shadow .4s var(--af-ease),color .4s var(--af-ease)}
.af-net .af-dot{color:var(--af-success)}
.af-net[data-bump]{color:var(--af-ink);box-shadow:var(--af-raised-shadow),0 0 0 1px var(--af-accent-ink)}
.af-card[data-dim],.af-dotnode[data-dim]{filter:saturate(.2) brightness(.45)}
.af-card,.af-dotnode{transition:transform .7s var(--af-ease),height .5s var(--af-ease),filter .4s var(--af-ease)}
.af-edge[data-dim]{opacity:.18}
.af-inspect{display:inline-flex;flex:0 1 auto;align-items:center;gap:10px;min-width:0;width:max-content;max-width:min(560px,100%);height:36px;padding:0 4px 0 14px;border-radius:999px;background:var(--af-accent-soft);box-shadow:inset 0 0 0 1px rgb(125 180 255/.35);color:var(--af-ink);font-size:13px;animation:af-in .35s var(--af-ease)}
.af-inspect .af-dot{color:var(--af-accent-ink)}
.af-inspect-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--af-body)}
.af-inspect-text b{color:var(--af-ink);font-weight:500;font-size:12px}
.af-inspect-back{appearance:none;flex:none;height:28px;padding:0 12px;border:0;border-radius:999px;background:var(--af-accent);color:#fff;font-size:12.5px;font-weight:500;cursor:pointer}
.af-inspect-back:hover{filter:brightness(1.1)}
.af-link{appearance:none;border:0;background:none;padding:0;font-size:12.5px;font-weight:500;color:var(--af-accent-ink);cursor:pointer}
.af-link:hover{text-decoration:underline;text-underline-offset:3px}
.af-seeking .af-card,.af-seeking .af-dotnode,.af-seeking .af-hub,.af-seeking .af-stage{transition:none!important}
.af-net-inline{position:static;height:36px}
.af-roll{display:inline-block;min-width:1ch;font-family:var(--af-mono);font-variant-numeric:tabular-nums;color:var(--af-ink);animation:af-roll .45s var(--af-ease)}
@keyframes af-roll{from{opacity:0;transform:translateY(60%)}to{opacity:1;transform:none}}
.af-group-names{display:block;color:var(--af-muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-card-head{display:flex;align-items:center;gap:10px;min-width:0;height:var(--af-head);padding:0 6px}
.af-avatar{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:999px;background:var(--af-accent-soft);color:var(--af-accent-ink);font-size:12px;font-weight:600;letter-spacing:-.01em}
.af-who{min-width:0;display:grid;line-height:1.2}
.af-who b{font-size:13px;font-weight:500;color:var(--af-ink);letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-who small{font-family:var(--af-mono);font-size:11px;color:var(--af-subtle);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-row{appearance:none;position:relative;display:flex;align-items:center;gap:8px;width:100%;height:var(--af-row);padding:0 6px 0 4px;border:0;border-radius:12px;background:var(--af-chip);text-align:left;cursor:pointer;transition:background-color .15s var(--af-ease),box-shadow .3s var(--af-ease)}
.af-row:hover{background:var(--af-chip-hover)}
.af-row[aria-pressed=true]{background:var(--af-chip-active);box-shadow:inset 0 0 0 1px var(--af-line-strong)}
.af-row[data-flash]{box-shadow:inset 0 0 0 1px var(--af-flash)}
.af-row[data-human]{background:var(--af-warn-bg)}
.af-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:8px;background:var(--af-raised);box-shadow:var(--af-raised-shadow);color:var(--af-body)}
.af-row[data-human] .af-icon{color:var(--af-warn)}
.af-row-label{flex:1 1 auto;min-width:56px;font-size:12.5px;font-weight:500;color:var(--af-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-row .af-tag{height:20px;padding:0 8px;font-size:10.5px;flex:none}
.af-row-dot{width:8px;height:8px;margin-right:4px;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 18%,transparent)}
.af-thinking{display:inline-flex;gap:2px}
.af-thinking i{width:3px;height:3px;border-radius:999px;background:currentColor;animation:af-dots 1.2s var(--af-ease) infinite}
.af-thinking i:nth-child(2){animation-delay:.15s}
.af-thinking i:nth-child(3){animation-delay:.3s}

/* Broker */
.af-hub{position:absolute;z-index:2;top:0;left:0;display:flex;flex-direction:column;align-items:center;gap:8px;transition:transform .7s var(--af-ease)}
.af-seal{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:30%;background:var(--af-raised);box-shadow:var(--af-surface-shadow),0 0 0 6px var(--af-stage),0 0 0 7px var(--af-line);color:var(--af-accent-ink);cursor:pointer;transition:box-shadow .3s var(--af-ease)}
.af-seal[aria-pressed=true]{box-shadow:var(--af-surface-shadow),0 0 0 6px var(--af-stage),0 0 0 7px var(--af-line-strong)}
.af-seal[data-flash]{box-shadow:var(--af-surface-shadow),0 0 0 6px var(--af-stage),0 0 0 7px var(--af-flash)}
.af-hub-label{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:72px;min-width:132px;max-width:100%;padding:6px 10px;border-radius:16px;background:var(--af-card);box-shadow:var(--af-surface-shadow)}
.af-hub-name{display:grid;justify-items:center;gap:0;line-height:1.2}
.af-hub-name b{font-size:13px;font-weight:500;letter-spacing:-.01em;color:var(--af-ink)}
.af-hub-slot{height:22px;min-width:0;display:flex;align-items:center;justify-content:center;max-width:var(--af-hub-w)}
.af-hub-slot .af-tag{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.af-hub-hint{font-size:12px;color:var(--af-subtle);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-burst{fill:none;stroke-width:1.5}

/* Paneles */
.af-side{display:grid;gap:12px;grid-template-rows:auto auto;min-width:0}
.af-wide .af-side{height:var(--af-stage-h);grid-template-rows:minmax(0,1fr) minmax(0,46%)}
.af-detail{overflow:auto;scrollbar-width:thin;scrollbar-color:var(--af-line-strong) transparent;height:260px}
.af-wide .af-detail{height:auto}
.af-panel{min-height:0;min-width:0;border-radius:24px;background:var(--af-card);box-shadow:var(--af-surface-shadow);padding:16px}
.af-panel>.af-eyebrow{margin-bottom:12px}
.af-detail{display:grid;gap:12px;align-content:start}
.af-panel.af-detail>.af-eyebrow{margin-bottom:0}
.af-detail-title{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.af-detail-title h4{margin:0;font-size:15px;font-weight:500;letter-spacing:-.01em;line-height:1.3}
.af-detail p{margin:0;font-size:13px;line-height:1.6;color:var(--af-muted)}
.af-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;margin:0;font-size:12.5px}
.af-dl dt{color:var(--af-muted)}
.af-dl dd{margin:0;font-family:var(--af-mono);font-size:12px;color:var(--af-ink);overflow-wrap:anywhere}
.af-timeline{display:flex;flex-direction:column;min-height:0;overflow:hidden;padding-bottom:8px}
.af-list{list-style:none;margin:0 -8px;padding:0;overflow:auto;min-height:0;display:grid;gap:2px;align-content:start;height:320px;scrollbar-width:thin;scrollbar-color:var(--af-line-strong) transparent}
.af-wide .af-list{height:auto;flex:1 1 auto}
.af-item{appearance:none;width:100%;display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px;border:0;border-radius:12px;background:transparent;text-align:left;cursor:pointer;transition:background-color .15s var(--af-ease)}
.af-item:hover{background:var(--af-chip-hover)}
.af-item[aria-current=true]{background:var(--af-chip-active)}
.af-item time{font-family:var(--af-mono);font-size:11px;color:var(--af-subtle);font-variant-numeric:tabular-nums}
.af-item-main{min-width:0;display:grid;line-height:1.3}
.af-item-main b{font-size:13px;font-weight:500;color:var(--af-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-item-main small{font-size:12px;color:var(--af-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.af-new{animation:af-in .5s var(--af-ease)}
.af-chain{list-style:none;margin:0 -8px;padding:0;display:grid;gap:2px}
.af-chain .af-item{grid-template-columns:52px minmax(0,1fr) auto}
.af-placeholder{font-size:13px;color:var(--af-muted);margin:0}
.af-legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.af-legend .af-tag{height:22px}

@keyframes af-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@keyframes af-pop{from{opacity:0}to{opacity:1}}
@keyframes af-breathe{50%{opacity:.35}}
@keyframes af-dots{0%,100%{opacity:.25}40%{opacity:1}}
.af-paused .af-thinking i,.af-paused .af-mode .af-dot{animation-play-state:paused}
.af-reduced *{animation:none!important;transition:none!important}
@media (prefers-reduced-motion:reduce){.af-root *{animation:none!important;transition:none!important}}
`;
