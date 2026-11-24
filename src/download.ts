/** Result of a download written to disk. */
export interface DownloadedFile {
	/** The path the file was written to (as given). */
	path: string;
	/** Size written, in bytes. */
	bytes: number;
}

interface FileHandleLike {
	write(chunk: Uint8Array): Promise<unknown>;
	close(): Promise<void>;
}
interface FsPromisesLike {
	open(path: string, flags: string, mode: number): Promise<FileHandleLike>;
	rename(from: string, to: string): Promise<void>;
	rm(path: string, options: { force: boolean }): Promise<void>;
}

// Specifiers in variables keep browser bundlers from resolving Node built-ins this SDK only touches in the Node-only file helpers.
const FS_MODULE = "node:fs/promises";
const CRYPTO_MODULE = "node:crypto";

/**
 * Writes `stream` to `path` as the bytes arrive (constant memory) through a temporary file next to it, renamed to `path` only when the stream ends (mode 0600: a snapshot can hold secrets). A failure or
 * cancellation removes the temporary file; `path` never holds a partial file. Node.js only (`node:fs`, loaded on demand).
 */
export async function writeStreamToFile(stream: ReadableStream<Uint8Array>, path: string): Promise<DownloadedFile> {
	const { open, rename, rm } = (await import(/* @vite-ignore */ /* webpackIgnore: true */ FS_MODULE)) as FsPromisesLike;
	const { randomBytes } = (await import(/* @vite-ignore */ /* webpackIgnore: true */ CRYPTO_MODULE)) as { randomBytes(size: number): { toString(encoding: "hex"): string } };
	const temp = `${path}.${randomBytes(6).toString("hex")}.part`;
	const reader = stream.getReader();
	const handle = await open(temp, "wx", 0o600).catch(async (error: unknown) => {
		await reader.cancel(error).catch(() => undefined);
		throw error;
	});
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			await handle.write(value);
			bytes += value.byteLength;
		}
		await handle.close();
		await rename(temp, path);
		return { path, bytes };
	} catch (error) {
		void reader.cancel(error).catch(() => undefined);
		await handle.close().catch(() => undefined);
		await rm(temp, { force: true });
		throw error;
	}
}
