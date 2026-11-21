import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { AskInput, categories, ProfileSearch, ToolArgs, type RequesterView } from "@team-31/protocol";
import { silentTelemetry, type Telemetry } from "@team-31/telemetry";
import { continueIntent, grounded } from "./intent.js";
import { matchesPerson, normalized, resolveRecipients, type Prompt } from "./recipients.js";
import {
  Intent, MessageInput, type Field, type InterpretMessage, type MessageReply, type ReadPlan, type ReceiptRef, type Relation,
  type RoutedAsk, type TurnContext, type TurnSession, type TurnStore,
} from "./types.js";

type Observability = Pick<Telemetry, "span" | "emit" | "error">;
export interface FlowDependencies { interpret: InterpretMessage; store: TurnStore; telemetry?: Observability }
const questions: Partial<Record<Field, string>> = {
  date: "¿Para qué fecha?", start: "¿A qué hora empieza? Indica la hora en formato de 24 horas.",
  durationMinutes: "¿Cuántos minutos duraría?", timezone: "¿En qué zona horaria?",
  interest: "¿Qué interés quieres consultar?", text: "¿Qué pregunta quieres enviar?",
  category: "¿Sobre qué categoría quieres preguntar?", share: "¿Qué categorías quieres compartir?",
  intent: "¿Quieres consultar a una persona, revisar una solicitud, buscar un perfil, leer la bóveda de un contacto o ver la tuya?",
};
type Step = "interpret" | "read" | "resolve" | "prepare" | "dispatch" | "done";
type AskDraft = Extract<Intent, { action: "ask" }>;
const refOf = ({ to, requestId }: RequesterView): ReceiptRef => ({ to, requestId });

// Only the routing decision passes through LangGraph's state and callbacks. The private
// per-invocation context lives as long as this call, and only explicit checkpoints persist.
class Turn {
  private intent: Intent = { action: "clarify" };
  private targets: string[] = [];
  private relation?: Relation;
  private circleId?: string;
  private categoryId?: string;
  private invitationTag?: string | null;
  private jobs: RoutedAsk[] = [];
  private refs: ReceiptRef[] = [];
  private readonly at: string;
  private readonly timezone?: string;
  private readonly relativeDays?: number;
  reply?: MessageReply;
  constructor(
    private context: TurnContext, private input: MessageInput, private session: TurnSession,
    private interpret: InterpretMessage, private telemetry: Observability,
  ) {
    const previous = session.previous;
    this.at = previous?.phase === "clarify" ? previous.at : (context.now ?? new Date()).toISOString();
    this.timezone = previous?.phase === "clarify" ? previous.timezone : context.timezone;
    const words = normalized(input.text);
    this.relativeDays = previous?.phase === "clarify" ? previous.relativeDays
      : /\b(pasado manana|day after tomorrow)\b/.test(words) ? 2
      : /\b(manana|tomorrow)\b/.test(words) && !/\b(por|de) la manana\b/.test(words) ? 1
      : /\b(hoy|today)\b/.test(words) ? 0 : undefined;
    if (previous?.phase === "requests" || previous?.phase === "dispatch") this.refs = previous.refs;
  }

  private get identity() { return { userId: this.context.userId, agentId: this.context.agentId }; }
  private finish(reply: MessageReply): Step { this.reply = reply; return "done"; }
  private unavailable(reason: Extract<MessageReply, { kind: "unavailable" }>["reason"]) {
    return this.finish({ kind: "unavailable", reason });
  }
  private async clarify(prompt: Prompt): Promise<Step> {
    const choices = prompt.choices?.length ? prompt.choices : undefined;
    await this.session.save({ phase: "clarify", at: this.at, relativeDays: this.relativeDays, intent: this.intent, field: prompt.field,
      choices, circleId: this.circleId, invitationTag: this.invitationTag, refs: this.refs, timezone: this.timezone });
    return this.finish({ kind: "clarification", question: prompt.question, choices, continuationId: this.session.continuationId });
  }

  async interpretTurn(): Promise<Step> {
    const previous = this.session.previous;
    if (previous?.phase === "dispatch") { this.jobs = previous.jobs; return "dispatch"; }
    if (previous?.phase === "read" && this.session.replay) return this.readPlan(previous.plan);
    if (previous?.phase === "requests" && this.session.replay) {
      // Retrying an ask requires only its original scope. Private answers retrieved by
      // a status read are reauthorized; the turn stores only their references.
      if (previous.receipts) {
        const known = new Set(previous.receipts.map(item => item.requestId));
        const confirmed = previous.refs.filter(ref => !known.has(ref.requestId));
        return this.finish({ kind: "requests", items: previous.receipts, unconfirmedCount: 0,
          ...(confirmed.length && { confirmed }), continuationId: this.session.continuationId });
      }
      const views = await Promise.all(previous.refs.map(r => this.context.ops.status(r.requestId)));
      return this.requests(views);
    }
    const parse: InterpretMessage = (text, expected) => this.telemetry.span("message.interpret", this.identity, async () =>
      Intent.parse(await this.interpret(text, expected)));
    if (previous?.phase === "clarify") {
      this.refs = previous.refs ?? [];
      const selection = await continueIntent(this.input.text, previous, parse);
      this.intent = selection.intent;
      this.circleId = selection.circleId;
      this.categoryId = selection.categoryId;
      this.invitationTag = selection.invitationTag;
    } else {
      this.intent = grounded(await parse(this.input.text, { at: this.at, timezone: this.timezone }), this.input.text);
    }
    this.telemetry.emit("message.interpreted", { ...this.identity, attrs: { action: this.intent.action } });
    if (this.intent.action === "clarify") return this.clarify({ field: "intent", question: questions.intent! });
    return this.intent.action === "ask" || this.intent.action === "vault" ? "resolve" : "read";
  }

  private async requests(items: RequesterView[]) {
    await this.session.save({ phase: "requests", refs: items.map(refOf) });
    return this.finish({ kind: "requests", items, unconfirmedCount: 0, continuationId: this.session.continuationId });
  }

  // Read plans contain only holder selections and references. On delivery replay the
  // broker reconstructs the result from the current directory and permissions.
  private async readPlan(plan: ReadPlan): Promise<Step> {
    const ops = this.context.ops;
    if (plan.action === "profiles" && !ops.searchProfiles || plan.action === "vault" && !ops.queryVault ||
      plan.action === "own_vault" && !ops.ownVault) return this.unavailable("unsupported");
    await this.session.save({ phase: "read", plan });
    if (plan.action === "contacts") return this.finish({ kind: "contacts", data: await ops.contacts() });
    if (plan.action === "own_vault") return this.finish({ kind: "own_vault", data: await ops.ownVault!(plan.categoryId) });
    if (plan.action === "profiles") return this.finish({ kind: "profiles", items: await ops.searchProfiles!(plan.query) });
    if (plan.empty) return this.finish({ kind: "vault", data: { categories: [] } });
    if (this.session.replay) {
      const current = await resolveRecipients(plan.selector, () => ops.contacts(), plan.circleId, true);
      if (current.kind !== "resolved") return this.finish({ kind: "vault", data: { categories: [] } });
    }
    return this.finish({ kind: "vault", data: await ops.queryVault!({ to: plan.selector.person!, categoryId: plan.categoryId }) });
  }

  // The single category named or chosen by the holder, or the options to ask about.
  private matchCategory(categories: { id: string; name: string }[], name?: string) {
    const matches = categories.filter(c => this.categoryId ? c.id === this.categoryId : normalized(c.name) === normalized(name!));
    return matches.length === 1 ? matches[0]!.id : (matches.length ? matches : categories).map(c => ({ label: c.name, value: c.id }));
  }

  async read(): Promise<Step> {
    const ops = this.context.ops;
    const intent = this.intent;
    if (intent.action === "contacts") return this.readPlan(intent);
    if (intent.action === "own_vault") {
      if (!ops.ownVault) return this.unavailable("unsupported");
      if (!this.categoryId && !intent.categoryName) return this.readPlan({ action: "own_vault" });
      const { categories } = await ops.ownVault();
      if (!categories.length) return this.readPlan({ action: "own_vault" });
      const match = this.matchCategory(categories, intent.categoryName);
      if (typeof match !== "string") return this.clarify({ field: "categoryId", question: "¿Cuál de tus bóvedas quieres abrir?", choices: match });
      return this.readPlan({ action: "own_vault", categoryId: match });
    }
    if (intent.action === "profiles") {
      if (!ops.searchProfiles) return this.unavailable("unsupported");
      const query = ProfileSearch.safeParse({ query: intent.query });
      if (!query.success) return this.clarify({ field: "query", question: "¿Qué nombre o dirección quieres buscar en los perfiles públicos?" });
      return this.readPlan({ action: "profiles", query: query.data.query });
    }
    if (intent.action !== "status") throw new Error("Invalid read transition");
    if (intent.requestId) return this.requests([await ops.status(intent.requestId)]);
    let candidates = this.refs.length ? this.refs : await ops.recentSent?.() ?? [];
    const person = intent.recipient;
    if (person) candidates = candidates.filter(ref => matchesPerson(person, ref.to));
    const refs = [...new Map(candidates.map(ref => [ref.requestId, ref])).values()];
    if (refs.length === 1) return this.requests([await ops.status(refs[0]!.requestId)]);
    this.refs = refs;
    return this.clarify({ field: "requestId", question: refs.length ? "¿Qué solicitud quieres revisar?" : "¿Cuál es el ID de la solicitud?",
      choices: refs.map(r => ({ value: r.requestId, label: r.to + " (" + r.requestId + ")" })) });
  }

  async resolve(): Promise<Step> {
    const intent = this.intent;
    if (intent.action !== "ask" && intent.action !== "vault") throw new Error("Invalid resolution transition");
    if (intent.action === "vault" && !this.context.ops.queryVault) return this.unavailable("unsupported");
    const result = await resolveRecipients(intent.selector, () => this.context.ops.contacts(), this.circleId, intent.action === "vault");
    this.telemetry.emit("message.recipients.resolved", { ...this.identity, attrs: {
      scope: intent.selector.scope, count: result.kind === "resolved" ? result.targets.length : 0,
    } });
    if (result.kind === "clarify") return this.clarify(result.prompt);
    if (result.kind !== "resolved") return this.unavailable(result.kind === "empty" ? "empty_selection" : "unsupported");
    this.targets = result.targets;
    this.relation = result.relation;
    if (this.relation?.kind === "circle") this.circleId = this.relation.circleId;
    if (intent.selector.count === "one") intent.selector.person = this.targets[0];
    return "prepare";
  }

  async prepare(): Promise<Step> {
    const intent = this.intent;
    if (intent.action === "vault") {
      const to = this.targets[0]!;
      const query = this.context.ops.queryVault!;
      const plan: ReadPlan = { action: "vault", selector: intent.selector, circleId: this.circleId };
      if (!this.categoryId && !intent.categoryName) return this.readPlan(plan);
      const catalog = await query({ to });
      if (!catalog.categories.length) {
        // A missing named category stays empty on replay, even if a new category is later shared.
        return this.readPlan({ ...plan, empty: true });
      }
      const match = this.matchCategory(catalog.categories, intent.categoryName);
      if (typeof match !== "string") return this.clarify({ field: "categoryId", question: "¿Qué categoría compartida quieres leer?", choices: match });
      return this.readPlan({ ...plan, categoryId: match });
    }
    if (intent.action !== "ask") throw new Error("Invalid ask transition");
    const args = this.validateArgs(intent);
    if ("field" in args) return this.clarify(args);
    if (intent.tool === "connect" && this.invitationTag === undefined) {
      const catalog = await this.context.ops.invitationTags?.();
      const tags = catalog?.tags ?? [];
      const sharing = tags.map(tag => {
        const names = [...tag.categories.map(c => categories[c].label),
          ...catalog!.categories.filter(c => c.tags.includes(tag.id)).map(c => c.name)];
        return tag.name + " — " + (names.join(", ") || "no comparte nada");
      });
      return this.clarify({ field: "invitationTag", question: ["¿Qué etiqueta le pones al contacto?", ...sharing].join("\n"),
        choices: [{ label: "Sin etiqueta", value: "none" }, ...tags.map(t => ({ label: t.name, value: t.id }))] });
    }
    this.jobs = this.targets.map(to => {
      const idempotencyKey = createHash("sha256").update(JSON.stringify([this.session.id, to])).digest("hex");
      const input = AskInput.parse({ to, tool: intent.tool, args: args.value, idempotencyKey, requireRelation: this.relation,
        ...(intent.tool === "connect" && { tags: this.invitationTag ? [this.invitationTag] : [] }) });
      return { ...input, idempotencyKey };
    });
    this.refs = [];
    await this.session.save({ phase: "dispatch", jobs: this.jobs, refs: [] });
    return "dispatch";
  }

  private validateArgs(intent: AskDraft): Prompt | { value: unknown } {
    const args = { ...intent.args };
    if (intent.tool === "availability") {
      args.timezone ??= this.timezone;
      if (this.relativeDays !== undefined) {
        if (!ToolArgs.availability.shape.timezone.safeParse(args.timezone).success) return { field: "timezone", question: questions.timezone! };
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: args.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(this.at));
        const number = (field: "year" | "month" | "day") => Number(parts.find(part => part.type === field)!.value);
        const date = new Date(Date.UTC(number("year"), number("month") - 1, number("day") + this.relativeDays));
        args.date = date.toISOString().slice(0, 10);
      }
    }
    if (intent.tool === "question" && !args.category) return { field: "category", question: questions.category! };
    const schema = ToolArgs[intent.tool];
    const relevant = Object.fromEntries(Object.entries(args).filter(([key]) => Object.hasOwn(schema.shape, key)));
    const parsed = schema.safeParse(relevant);
    if (parsed.success) return { value: parsed.data };
    const field = parsed.error.issues[0]?.path[0] as Field;
    return { field, question: questions[field] ?? "¿Puedes precisar ese dato?" };
  }

  async dispatch(): Promise<Step> {
    const previous = this.session.previous;
    const items: RequesterView[] = previous?.phase === "dispatch" ? [...previous.receipts ?? []] : [];
    const refs = new Map(this.refs.map(r => [r.to, r]));
    const pending = new Map(this.jobs.filter(j => !refs.has(j.to)).map(j => [j.to, j]));
    const jobs = [...pending.values()];
    let errorId: string | undefined;
    let terminalError: unknown;
    let accepted = 0;
    for (let start = 0; start < jobs.length; start += 4) {
      const batch = jobs.slice(start, start + 4);
      const results = await Promise.allSettled(batch.map(input => this.context.ops.ask(input)));
      let stop = false;
      for (const [index, result] of results.entries()) {
        const job = batch[index]!;
        if (result.status === "fulfilled") {
          items.push(result.value);
          refs.set(job.to, refOf(result.value));
          pending.delete(job.to);
          accepted++;
        } else {
          const error: unknown = result.reason;
          const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
          if (code === "not_found" && job.requireRelation) { pending.delete(job.to); continue; }
          if (code === "forbidden" || code === "unauthorized" || code === "conflict" || code === "invalid_input") terminalError = error;
          if (code === "rate_limited" || terminalError) stop = true;
          errorId = this.telemetry.error("message.dispatch", error, this.identity);
        }
      }
      // Confirmed writes never consume ask quota again. Only opaque refs survive
      // for answers carrying private data; other initial receipts are safe to replay.
      await this.session.save({ phase: "dispatch", jobs: [...pending.values()], refs: [...refs.values()],
        receipts: items.filter(item => item.decision !== "allow") });
      if (stop) break;
    }
    if (terminalError && !accepted) throw terminalError;
    if (!pending.size && !refs.size) return this.unavailable("empty_selection");
    if (!pending.size) await this.session.save({ phase: "requests", refs: [...refs.values()],
      receipts: items.filter(item => item.decision !== "allow") });
    const included = new Set(items.map(v => v.requestId));
    const confirmed = [...refs.values()].filter(ref => !included.has(ref.requestId));
    return this.finish({ kind: "requests", items, ...(confirmed.length && { confirmed }),
      unconfirmedCount: pending.size, ...(errorId && { errorId }), continuationId: this.session.continuationId });
  }
}

const graphState = Annotation.Root({ step: Annotation<Step>() });
export function createMessageFlow({ interpret, store, telemetry = silentTelemetry("mcp") }: FlowDependencies) {
  const active = new AsyncLocalStorage<Turn>();
  const node = (fn: (turn: Turn) => Promise<Step>) => async () => ({ step: await fn(active.getStore()!) });
  const graph = new StateGraph(graphState)
    .addNode("interpret", node(t => t.interpretTurn()))
    .addNode("read", node(t => t.read()))
    .addNode("resolve", node(t => t.resolve()))
    .addNode("prepare", node(t => t.prepare()))
    .addNode("dispatch", node(t => t.dispatch()))
    .addEdge(START, "interpret")
    .addConditionalEdges("interpret", s => s.step, { read: "read", resolve: "resolve", dispatch: "dispatch", done: END })
    .addEdge("read", END)
    .addConditionalEdges("resolve", s => s.step, { prepare: "prepare", done: END })
    .addConditionalEdges("prepare", s => s.step, { dispatch: "dispatch", done: END })
    .addEdge("dispatch", END).compile();
  return { async handleMessage(context: TurnContext, raw: MessageInput): Promise<MessageReply> {
    const input = MessageInput.parse(raw);
    const result = await store.run(context, input.continuationId, async session => {
      const turn = new Turn(context, input, session, interpret, telemetry);
      await active.run(turn, () => graph.invoke({ step: "interpret" }));
      if (!turn.reply) throw new Error("Missing message reply");
      return turn.reply;
    }) ?? { kind: "unavailable", reason: "expired" } as const;
    telemetry.emit("message.turn.completed", { userId: context.userId, agentId: context.agentId, attrs: { outcome: result.kind } });
    return result;
  } };
}
