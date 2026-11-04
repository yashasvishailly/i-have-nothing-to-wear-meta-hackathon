import { ProviderError, pngDimensions } from './meta';
export function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const b of bytes) {
    c ^= b;
    for (let j = 0; j < 8; j++)
        c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
} return (c ^ 0xffffffff) >>> 0; }
// Browser canvas normalizes uploads to non-interlaced RGB/RGBA PNG. Reject everything else server-side.
export async function validatePng(bytes: Uint8Array, minimumSide=32) { const size = pngDimensions(bytes,minimumSide), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0)
    throw new ProviderError('input'); let offset = 8, ended = false, count = 0; const chunks: Uint8Array[] = []; while (offset + 12 <= bytes.length) {
    if (++count > 10000)
        throw new ProviderError('input');
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12)
        throw new ProviderError('input');
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length))
        throw new ProviderError('input');
    if (count === 1 && (type !== 'IHDR' || length !== 13) || count > 1 && type === 'IHDR')
        throw new ProviderError('input');
    if (type === 'IDAT')
        chunks.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') {
        if (length !== 0 || offset !== bytes.length)
            throw new ProviderError('input');
        ended = true;
        break;
    }
} if (!ended || !chunks.length)
    throw new ProviderError('input'); const stream = new Blob(chunks.map(c => new Uint8Array(c).buffer)).stream().pipeThrough(new DecompressionStream('deflate')); const reader = stream.getReader(), stride = size.width * (bytes[25] === 6 ? 4 : 3) + 1, expected = stride * size.height; let total = 0; try {
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        for (let i = 0; i < value.length; i++)
            if ((total + i) % stride === 0 && value[i] > 4)
                throw new ProviderError('input');
        total += value.length;
        if (total > expected)
            throw new ProviderError('input');
    }
    if (total !== expected)
        throw new ProviderError('input');
}
catch {
    throw new ProviderError('input');
}
finally {
    await reader.cancel().catch(() => { });
    reader.releaseLock();
} return size; }
