import { Resolver } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REQUEST_MS = 10_000;
const LOCAL_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i;

const deniedIPv4 = new BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  deniedIPv4.addSubnet(prefix, bits);
}

const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");
const deniedIPv6 = new BlockList();
for (const [prefix, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  deniedIPv6.addSubnet(prefix, bits, "ipv6");
}

function isPublic(address: string): boolean {
  switch (isIP(address)) {
    case 4: return !deniedIPv4.check(address);
    case 6: return globalIPv6.check(address, "ipv6") && !deniedIPv6.check(address, "ipv6");
    default: return false;
  }
}

async function resolveHost(hostname: string, signal: AbortSignal): Promise<string[]> {
  const resolver = new Resolver();
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });

  const emptyIfNoRecord = (error: NodeJS.ErrnoException) => {
    if (error.code === "ENODATA") return [];
    throw error;
  };

  try {
    const families = await Promise.all([
      resolver.resolve4(hostname).catch(emptyIfNoRecord),
      resolver.resolve6(hostname).catch(emptyIfNoRecord),
    ]);
    return families.flat();
  } finally {
    signal.removeEventListener("abort", cancel);
    resolver.cancel();
  }
}

export interface SafePost {
  url: string;
  pathSuffix?: string;
  body: string;
  headers?: Record<string, string>;
}

type FetchFailure = "https_required" | "blocked_address" | "timeout" | "network_error";
type FetchResponse = { status: number; body?: Buffer };
type FetchResult = FetchResponse | { failure: FetchFailure };

export type SafeFetch = (post: SafePost) => Promise<FetchResult>;

export function createSafeFetch(
  allowInsecure: boolean,
  resolve = resolveHost,
): SafeFetch {
  return async (post) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<FetchResult>((finish) => {
      timer = setTimeout(() => {
        finish({ failure: "timeout" });
        controller.abort();
      }, MAX_REQUEST_MS);
    });

    try {
      return await Promise.race([postToValidatedHost(post, allowInsecure, resolve, controller.signal), deadline]);
    } catch {
      return { failure: "network_error" };
    } finally {
      clearTimeout(timer);
    }
  };
}

async function postToValidatedHost(
  post: SafePost,
  allowInsecure: boolean,
  resolve: typeof resolveHost,
  signal: AbortSignal,
): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(post.url);
  } catch {
    return { failure: "blocked_address" };
  }

  const localHttp = allowInsecure && url.protocol === "http:" && LOCAL_HTTP.test(post.url);
  if (url.protocol !== "https:" && !localHttp) return { failure: "https_required" };
  if (url.username || url.password) return { failure: "blocked_address" };

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalIp = isIP(hostname) !== 0;
  // The development exception pins explicit localhost URLs to IPv4 loopback.
  const addresses = localHttp
    ? ["127.0.0.1"]
    : literalIp ? [hostname] : await resolve(hostname, signal);
  const address = addresses[0];
  if (!address || (!localHttp && !addresses.every(isPublic))) {
    return { failure: "blocked_address" };
  }
  signal.throwIfAborted();

  const pathname = post.pathSuffix
    ? url.pathname.replace(/\/+$/, "") + post.pathSuffix
    : url.pathname;
  const request = localHttp ? httpRequest : httpsRequest;

  return new Promise((finish, reject) => {
    // Dial the validated IP directly. TLS still verifies the original hostname.
    const outgoing = request({
      hostname: address,
      port: url.port,
      servername: literalIp ? undefined : hostname,
      rejectUnauthorized: true,
      agent: false,
      signal,
      method: "POST",
      path: pathname + url.search,
      headers: {
        ...post.headers,
        host: url.host,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(post.body),
      },
    }, (response) => readResponse(response, finish, reject));
    outgoing.on("error", reject);
    outgoing.end(post.body);
  });
}

function readResponse(
  response: IncomingMessage,
  finish: (result: FetchResponse) => void,
  reject: (error: Error) => void,
): void {
  const status = response.statusCode ?? 0;
  response.on("error", reject);
  if (status < 200 || status >= 300) {
    finish({ status });
    response.destroy();
    return;
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  response.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) {
      finish({ status });
      response.destroy();
      return;
    }
    chunks.push(chunk);
  });
  response.on("end", () => finish({ status, body: Buffer.concat(chunks, bytes) }));
}
