import { ChunkTagsBE, FormatChunk } from '../src/wave.ts';
import assert from 'node:assert/strict';

describe('FMT Chunk', () => {

const test_data = new Uint8Array([
	0xFF, 0xFF, 0xFF, 0xFF,

	0x01, 0x00, 0x02, 0x00, 0x44, 0xac,
	0x00, 0x00, 0x10, 0xb1, 0x02, 0x00,
	0x04, 0x00, 0x10, 0x00,
]);

const test2_data = new Uint8Array([
	0xFF, 0xFF, 0xFF, 0xFF,

	0x02, 0x00, 0x02, 0x00, 0x44, 0xac,
	0x00, 0x00, 0x10, 0xb1, 0x02, 0x00,
	0x04, 0x00, 0x10, 0x00, 0x02, 0x00, 0xab, 0xcd
]);

const test_view = new DataView(test_data.buffer, 0x4);
const test2_view = new DataView(test2_data.buffer, 0x4);

it('Unpacks (PCM)', () => {
	const unpacked = FormatChunk.unpack(test_view, ChunkTagsBE.FMT);
	assert.equal(unpacked.compressionCode, 1);
	assert.equal(unpacked.channelCount, 2);
	assert.equal(unpacked.sampleRate, 44100);
	assert.equal(unpacked.avgBytesPerSecond, 44100 * 2 * 16 / 8);
	assert.equal(unpacked.blockAlign, 4);
	assert.equal(unpacked.sigBitsPerSample, 16);
});


it('Unpacks (Compressed)', () => {
	const unpacked = FormatChunk.unpack(test2_view, ChunkTagsBE.FMT);
	assert.equal(unpacked.compressionCode, 2);
	assert.equal(unpacked.channelCount, 2);
	assert.equal(unpacked.sampleRate, 44100);
	assert.equal(unpacked.avgBytesPerSecond, 44100 * 2 * 16 / 8);
	assert.equal(unpacked.blockAlign, 4);
	assert.equal(unpacked.sigBitsPerSample, 16);
	assert.deepEqual(unpacked.extraFormatBytes, new Uint8Array([0xab, 0xcd]));
});

it('Packs (PCM)', () => {
	const unpacked = new FormatChunk(
		1,
		2,
		44100,
		44100 * 2 * 16 / 8,
		4,
		16
	);

	const packed = new DataView(new ArrayBuffer(unpacked.length()));
	unpacked.pack(packed);
	assert.deepEqual(new Uint8Array(packed.buffer), test_data.slice(0x4, ));
});

it('Packs (Compressed)', () => {
	const unpacked = new FormatChunk(
		2,
		2,
		44100,
		44100 * 2 * 16 / 8,
		4,
		16,
		new Uint8Array([0xab, 0xcd])
	);

	const packed = new DataView(new ArrayBuffer(unpacked.length()));
	unpacked.pack(packed);
	assert.deepEqual(new Uint8Array(packed.buffer), test2_data.slice(0x4, ));
});


});