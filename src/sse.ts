/**
 * Parser for the `text/event-stream` response of `GET /v1/apps/:id/realtime`. Standard SSE wire
 * format: a block of `event: <name>\n` + `data: <text>\n` lines terminated by a blank line. `id:`
 * fields, if present, are tolerated but ignored. `data` is always a single opaque string
 * (`"heartbeat"`, a log line, a status note, ...), never JSON — the SDK never attempts to parse it.
 */
export interface SseEvent {
	event: string;
	data: string;
}

export interface SseParseOptions {
	/** Aborts the underlying fetch/stream read. */
	signal?: AbortSignal;
	/** Milliseconds of inactivity (no event, no keep-alive byte) before the iterator throws. */
	idleTimeoutMs?: number;
}

class SseIdleTimeoutError extends Error {
	constructor(idleTimeoutMs: number) {
		super(`No SSE event received for ${idleTimeoutMs}ms`);
		this.name = "SseIdleTimeoutError";
	}
}

/**
 * Parses a `ReadableStream<Uint8Array>` (the raw `fetch` response body) into an async iterable of
 * `SseEvent`. Supports cancellation via `options.signal` (aborts and releases the reader) and via
 * the consumer simply breaking out of a `for await` loop (the `finally` cancels the reader), plus
 * an inactivity timeout.
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>, options: SseParseOptions = {}): AsyncGenerator<SseEvent, void, unknown> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const onAbort = () => {
		reader.cancel().catch(() => {});
	};
	options.signal?.addEventListener("abort", onAbort);

	try {
		while (true) {
			if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

			let readResult: ReadableStreamReadResult<Uint8Array>;
			if (options.idleTimeoutMs) {
				readResult = await raceWithIdleTimeout(reader.read(), options.idleTimeoutMs);
			} else {
				readResult = await reader.read();
			}

			if (readResult.done) {
				if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
				// Flush a final event without a trailing blank line, if any.
				const trailing = parseEventBlock(buffer);
				if (trailing) yield trailing;
				return;
			}

			buffer += decoder.decode(readResult.value, { stream: true });

			let separatorIndex: number;
			// biome-ignore lint/suspicious/noAssignInExpressions: tight loop over repeated blank-line splits
			while ((separatorIndex = findBlockEnd(buffer)) !== -1) {
				const block = buffer.slice(0, separatorIndex);
				buffer = buffer.slice(separatorIndex).replace(/^\r?\n\r?\n/, "");
				const event = parseEventBlock(block);
				if (event) yield event;
			}
		}
	} finally {
		options.signal?.removeEventListener("abort", onAbort);
		try {
			await reader.cancel();
		} catch {
			// already closed/cancelled
		}
	}
}

function findBlockEnd(buffer: string): number {
	const lf = buffer.indexOf("\n\n");
	const crlf = buffer.indexOf("\r\n\r\n");
	if (lf === -1 && crlf === -1) return -1;
	if (lf === -1) return crlf + 4;
	if (crlf === -1) return lf + 2;
	return Math.min(lf + 2, crlf + 4);
}

function parseEventBlock(block: string): SseEvent | null {
	const lines = block.split(/\r?\n/).filter((line) => line.length > 0);
	if (lines.length === 0) return null;

	let event = "message";
	const dataLines: string[] = [];

	for (const line of lines) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trimStart();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
		// `id:` and `retry:` fields are ignored.
	}

	if (dataLines.length === 0) return null;
	return { event, data: dataLines.join("\n") };
}

async function raceWithIdleTimeout<T>(promise: Promise<T>, idleTimeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new SseIdleTimeoutError(idleTimeoutMs)), idleTimeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export { SseIdleTimeoutError };
