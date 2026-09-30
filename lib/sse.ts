/**
 * Splits a byte stream into server-sent events.
 *
 * Chunk boundaries fall wherever the network puts them, which is routinely in
 * the middle of a JSON payload. Holding the remainder between chunks is the
 * whole job; without it a large result drops exactly the events that matter
 * most, since those are the biggest ones.
 */
export function* parseServerEvents<T>(buffer: string): Generator<{ event: T | null; rest: string }> {
    let rest = buffer;
    let index = rest.indexOf('\n\n');

    while (index !== -1) {
        const frame = rest.slice(0, index);
        rest = rest.slice(index + 2);

        const payload = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('');

        if (payload.length > 0) {
            try {
                yield { event: JSON.parse(payload) as T, rest };
            } catch {
                // A frame we cannot parse is one lost update, not a lost
                // run. Dropping it beats tearing down a four minute stream.
                yield { event: null, rest };
            }
        }
        index = rest.indexOf('\n\n');
    }

    yield { event: null, rest };
}
