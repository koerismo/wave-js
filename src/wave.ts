// Referenced from:
// - https://web.archive.org/web/20141101112743/http:/www.sonicspot.com/guide/wavefiles.html
// - https://web.archive.org/web/20250811161747/https://www.recordingblogs.com/wiki/list-chunk-of-a-wave-file
//   - Original link still works as of Sept. 2025: https://www.recordingblogs.com/wiki/list-chunk-of-a-wave-file


const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function tagToString(tag: number) {
	return String.fromCharCode(
		(tag >> 24) & 0xff,
		(tag >> 16) & 0xff,
		(tag >> 8)  & 0xff,
		(tag >> 0)  & 0xff,
	)
}

export interface Chunk {
	length(): number;
	pack(into: DataView): void;
	tag: number;
}

export const enum ChunkTagsBE {
	RIFF = 0x52494646,
	WAVE = 0x57415645,
	FMT  = 0x666D7420,
	DATA = 0x64617461,
	CUE  = 0x63756520,
	SMPL = 0x736D706C,
	LIST = 0x4C495354,
	adtl = 0x6164746C,
	labl = 0x6C61626C,
	INFO = 0x494E464F,
}

export interface ChunkStatic {
	unpack(from: DataView, tag: number): Chunk;
}

export class UnknownChunk implements Chunk {
	constructor(
		public tag: number,
		public data: Uint8Array,
	) {}

	length(): number {
		return this.data.length;
	}

	pack(into: DataView): void {
		new Uint8Array(into.buffer, into.byteOffset, into.byteLength)
			.set(this.data, 0);
	}

	toString() {
		return `UnknownChunk<${tagToString(this.tag)}>`;
	}

	static unpack(from: DataView, tag: number): UnknownChunk {
		return new UnknownChunk(
			tag,
			new Uint8Array(from.buffer, from.byteOffset, from.byteLength)
		);
	}
}

export class FormatChunk implements Chunk {
	tag = ChunkTagsBE.FMT;

	constructor(
		public compressionCode: number,
		public channelCount: number,
		public sampleRate: number,
		public avgBytesPerSecond: number,
		public blockAlign: number,
		public sigBitsPerSample: number,
		public extraFormatBytes?: Uint8Array,
	) {}

	length(): number {
		if (this.compressionCode <= 1) return 16;
		return 18 + this.extraFormatBytes!.length;
	}

	pack(into: DataView): void {
		into.setUint16(0, this.compressionCode, true);
		into.setUint16(2, this.channelCount, true);
		into.setUint32(4, this.sampleRate, true);
		into.setUint32(8, this.avgBytesPerSecond, true);
		into.setUint16(12, this.blockAlign, true);
		into.setUint16(14, this.sigBitsPerSample, true);

		if (this.compressionCode > 1) {
			into.setUint16(16, this.extraFormatBytes?.length || 0, true);
			if (this.extraFormatBytes)
				new Uint8Array(into.buffer, into.byteOffset, into.byteLength)
					.set(this.extraFormatBytes!, 18);
		}
	}

	toString() {
		return `FormatChunk<channels=${this.channelCount},samplerate=${this.sampleRate}>`;
	}

	static unpack(from: DataView, tag: number): FormatChunk {
		const compressionCode = from.getUint16(0, true);

		let extraFormatBytes: Uint8Array | undefined;
		if (compressionCode > 1) {
			const extraFormatBytesLength = from.getUint16(16, true);
			extraFormatBytes = new Uint8Array(
				from.buffer,
				from.byteOffset + 18,
				extraFormatBytesLength
			);
		}

		return new FormatChunk(
			compressionCode,
			from.getUint16(2, true),	// number of channels
			from.getUint32(4, true),	// sample rate
			from.getUint32(8, true),	// average bps
			from.getUint16(12, true),	// block align
			from.getUint16(14, true),	// significant bps
			extraFormatBytes
		);
	}

}

export class Cue {
	constructor(
		public id: number,
		public position: number,
		public chunkId: number,
		public chunkStart: number,
		public blockStart: number,
		public sampleOffset: number,
	) {}

	pack(into: DataView, idx: number) {
		into.setUint32(idx + 0, this.id, true);
		into.setUint32(idx + 4, this.position, true);
		into.setUint32(idx + 8, this.chunkId, true);
		into.setUint32(idx + 12, this.chunkStart, true);
		into.setUint32(idx + 16, this.blockStart, true);
		into.setUint32(idx + 20, this.sampleOffset, true);
	}

	static unpack(from: DataView, idx: number): Cue {
		return new Cue(
			from.getUint32(idx + 0, true),	// id
			from.getUint32(idx + 4, true),	// position
			from.getUint32(idx + 8, true),	// data chunk id
			from.getUint32(idx + 12, true),	// chunk start
			from.getUint32(idx + 16, true),	// block start
			from.getUint32(idx + 20, true),	// sample offset
		);
	}
}

export class CueChunk implements Chunk {
	tag = ChunkTagsBE.CUE;

	constructor(
		public cues: Cue[],
	) {}

	length(): number {
		return 4 + this.cues.length * 24;
	}

	pack(into: DataView): void {
		into.setUint32(0, this.cues.length, true);

		for (let i=0, idx=4; i<this.cues.length; i++, idx+=24) {
			this.cues[i].pack(into, idx);
		}
	}

	toString() {
		return `CueChunk<size=${this.cues.length}>`;
	}

	static unpack(from: DataView, tag: number) {
		const count = from.getUint32(0, true);
		const cues: Cue[] = new Array(count);

		for (let i=0, idx=4; i<count; i++, idx+=24) {
			cues[i] = Cue.unpack(from, idx);
		}

		return new CueChunk(cues);
	}
}

export const enum SampleLoopType {
	Forward = 0,
	ForwardReverse = 1,
	Reverse = 2,
}

export class SampleLoop {
	constructor(
		public id: number,
		public type: number,
		public start: number,
		public end: number,
		public fraction: number,
		public playCount: number,
	) {}

	pack(into: DataView, idx: number) {
		into.setUint32(idx + 0, this.id, true);
		into.setUint32(idx + 4, this.type, true);
		into.setUint32(idx + 8, this.start, true);
		into.setUint32(idx + 12, this.end, true);
		into.setUint32(idx + 16, this.fraction, true);
		into.setUint32(idx + 20, this.playCount, true);
	}

	static unpack(from: DataView, idx: number): SampleLoop {
		return new SampleLoop(
			from.getUint32(idx + 0, true),	// id
			from.getUint32(idx + 4, true),	// type
			from.getUint32(idx + 8, true),	// start
			from.getUint32(idx + 12, true),	// end
			from.getUint32(idx + 16, true),	// fraction
			from.getUint32(idx + 20, true),	// play count
		);
	}
}

export class SampleChunk implements Chunk {
	tag = ChunkTagsBE.SMPL;

	constructor(
		public samplePeriod: number,
		public samplerData: Uint8Array | undefined,
		public sampleLoops: SampleLoop[],
		public manufacturer: number = 0,
		public product: number = 0,
		public midiUnityNote: number = 0,
		public midiPitchFraction: number = 0,
		public smpteFormat: number = 0,
		public smpteOffset: number = 0,
	) {}

	length(): number {
		return 36 + this.sampleLoops.length * 24 + (this.samplerData?.length ?? 0);
	}

	pack(into: DataView): void {
		into.setUint32(0,  this.manufacturer, true);		// manufacturer
		into.setUint32(4,  this.product, true);				// product
		into.setUint32(8, this.samplePeriod, true);			// samplePeriod
		into.setUint32(12, this.midiUnityNote, true);		// unity note
		into.setUint32(16, this.midiPitchFraction, true);	// pitch frac
		into.setUint32(20, this.smpteFormat, true);			// SMPTE format
		into.setUint32(24, this.smpteOffset, true);			// SMPTE offset
		into.setUint32(28, this.sampleLoops.length, true);
		into.setUint32(32, this.samplerData?.length ?? 0, true);

		for (let i=0, idx=36; i<this.sampleLoops.length; i++, idx+=24) {
			this.sampleLoops[i].pack(into, idx);
		}

		if (this.samplerData) {
			new Uint8Array(into.buffer, into.byteOffset, into.byteLength)
				.set(this.samplerData, 36 + this.sampleLoops.length * 24)
		}
	}

	toString() {
		return `SampleChunk<size=${this.sampleLoops.length}>`;
	}

	static unpack(from: DataView, tag: number) {
		const sampleLoopCount = from.getUint32(28, true);
		const samplerDataSize = from.getUint32(32, true);

		let samplerData: Uint8Array | undefined;
		if (samplerDataSize) {
			samplerData = new Uint8Array(
				from.buffer,
				from.byteOffset + 36 + sampleLoopCount * 24,
				samplerDataSize
			);
		}

		const sampleLoops: SampleLoop[] = new Array(sampleLoopCount);
		for (let i=0, idx=36; i<sampleLoopCount; i++, idx+=24) {
			sampleLoops[i] = SampleLoop.unpack(from, idx);
		}

		return new SampleChunk(
			from.getUint32(8, true),	// samplePeriod
			samplerData,				// samplerData
			sampleLoops,				// sampleLoops
			from.getUint32(0, true),	// manufacturer
			from.getUint32(4, true),	// product
			from.getUint32(12, true),	// unity note
			from.getUint32(16, true),	// pitch frac
			from.getUint32(20, true),	// SMPTE format
			from.getUint32(24, true),	// SMPTE offset
		);
	}
}

export class ListChunk_ADTL_LABL implements Chunk {
	tag = ChunkTagsBE.labl;

	constructor(
		public cueId: number,
		public cueLabel: string,
	) {}

	length(): number {
		// Add a null character and then add up to nearest 2-byte alignment.
		let length = 4 + this.cueLabel.length + 1;
		if (length & 1) length ++;
		return length;
	}

	pack(into: DataView): void {
		into.setUint32(0, this.cueId, true);
		textEncoder.encodeInto(this.cueLabel, new Uint8Array(into.buffer, into.byteOffset + 4, into.byteLength));
	}

	toString() {
		return `Labl<${this.cueId}="${this.cueLabel}">`;
	}

	static unpack(from: DataView, tag: number): ListChunk_ADTL_LABL {
		const cueId = from.getUint32(0, true);

		let cueLabelBytes = from.buffer.slice(from.byteOffset + 4, from.byteOffset + from.byteLength);
		const byteLength = new Uint8Array(cueLabelBytes).indexOf(0);
		if (byteLength !== -1) cueLabelBytes = cueLabelBytes.slice(0, byteLength);

		return new ListChunk_ADTL_LABL(
			cueId,
			textDecoder.decode(cueLabelBytes)
		);
	}
}

export class ListChunk_ADTL implements Chunk {
	tag: number = ChunkTagsBE.adtl;
	
	constructor(
		public chunks: Chunk[],
	) {}
	
	length(): number {
		return this.chunks.reduce((a, b) => a + 8 + b.length(), 0);
	}

	pack(into: DataView): void {
		let idx = 0;
		for (let i=0; i<this.chunks.length; i++) {
			const chunkSize = this.chunks[i].length();

			into.setUint32(idx, this.chunks[i].tag, false);
			into.setUint32(idx + 4, chunkSize, true);
			idx += 8;

			const chunkView = new DataView(into.buffer, into.byteOffset + idx, chunkSize);
			this.chunks[i].pack(chunkView);
			idx += chunkSize;
		}
	}

	toString() {
		return `ADT(${this.chunks.length} items)`;
	}

	static chunkRegistry: Record<number, ChunkStatic> = {
		[ChunkTagsBE.labl]: ListChunk_ADTL_LABL,
	};

	static unpack(from: DataView, tag: number): ListChunk_ADTL {
		const chunks: Chunk[] = [];
		let idx = 0;

		while (idx < from.byteLength) {
			const chunkTag = from.getUint32(idx, false);
			const chunkSize = from.getUint32(idx + 4, true);
			idx += 8;

			const chunkType = this.chunkRegistry[chunkTag] ?? UnknownChunk;
			const chunkView = new DataView(from.buffer, from.byteOffset + idx, chunkSize);
			const chunk = chunkType.unpack(chunkView, chunkTag);
			chunks.push(chunk);

			idx += chunkSize;
			if (idx & 1) idx ++;
		}

		return new ListChunk_ADTL(chunks);
	}
}

export class ListChunk implements Chunk {
	tag = ChunkTagsBE.LIST;

	constructor(
		public body: Chunk,
	) {}

	length(): number {
		return 4 + this.body.length();
	}

	pack(into: DataView): void {
		into.setUint32(0, this.body.tag, false);
		const bodyView = new DataView(into.buffer, into.byteOffset + 4, into.byteLength - 4);
		this.body.pack(bodyView);
	}

	static chunkRegistry: Record<number, ChunkStatic> = {
		[ChunkTagsBE.adtl]: ListChunk_ADTL,
	};

	static unpack(from: DataView, tag: number): ListChunk {
		const bodyTag = from.getUint32(0, false);
		const bodyView = new DataView(from.buffer, from.byteOffset + 4, from.byteLength - 4);
		const bodyType = this.chunkRegistry[bodyTag] ?? UnknownChunk;
		const body = bodyType.unpack(bodyView, bodyTag);
		return new ListChunk(body);
	}
}

export class DataChunk implements Chunk {
	tag = ChunkTagsBE.DATA;

	constructor(
		public data: Uint8Array
	) {}

	length(): number {
		return this.data.length;
	}

	pack(into: DataView): void {
		new Uint8Array(into.buffer, into.byteOffset, into.byteLength)
			.set(this.data, 0);
	}

	reinterpret(bits: number): Uint8Array | Int16Array | Int32Array | never {
		switch (bits) {
			case 8:		return this.data;
			case 16:	return new Int16Array(this.data.buffer, this.data.byteOffset, Math.floor(this.data.byteLength / 2));
			case 32:	return new Int32Array(this.data.buffer, this.data.byteOffset, Math.floor(this.data.byteLength / 4));
			default:
				throw Error(`Cannot reinterpret to bit depth ${bits}!`);
		}
	}

	static unpack(from: DataView, tag: number): DataChunk {
		return new DataChunk(
			new Uint8Array(from.buffer, from.byteOffset, from.byteLength)
		);
	}
}

export class Wave {
	cached_fmt?: FormatChunk;
	cached_data?: DataChunk;

	constructor(
		public chunks: Chunk[] = [],
	) {
		this.updateCache();
	}

	/**
	 * Updates the internal cache used by the ease-of-access methods.
	 * This only needs to be called when replacing the format or data chunks!
	*/
	updateCache() {
		this.cached_fmt = this.getChunk(ChunkTagsBE.FMT);
		this.cached_data = this.getChunk(ChunkTagsBE.DATA);
	}

	encode(): ArrayBuffer {
		let fileLength = 12;
		for (const chunk of this.chunks) {
			fileLength += 8 + chunk.length();
			if (fileLength & 1) fileLength++;
		}

		const buffer = new ArrayBuffer(fileLength);
		const file = new DataView(buffer);

		file.setUint32(0x0, ChunkTagsBE.RIFF, false);
		file.setUint32(0x4, fileLength - 0x8, true);
		file.setUint32(0x8, ChunkTagsBE.WAVE, false);

		let idx = 12;

		for (const chunk of this.chunks) {
			const chunkLength = chunk.length();
			file.setUint32(idx + 0x0, chunk.tag, false);
			file.setUint32(idx + 0x4, chunkLength, true);
			idx += 8;

			chunk.pack(new DataView(file.buffer, idx, chunkLength));
			idx += chunkLength;

			// Short-align
			if (idx & 1) idx ++;
		}

		return buffer;
	}

	getLengthSamples() {
		const fmt = this.cached_fmt!;
		return this.cached_data!.data.length / fmt.channelCount / (fmt.sigBitsPerSample / 8);
	}

	getLengthSeconds() {
		return this.getLengthSamples() / this.cached_fmt!.sampleRate;
	}

	getChunk<T extends Chunk>(tag: number): T | undefined {
		for (let i=0; i<this.chunks.length; i++) {
			if (this.chunks[i].tag === tag) return this.chunks[i] as T;
		}
		return;
	}

	removeChunk(tag: number): Chunk | undefined {
		for (let i=0; i<this.chunks.length; i++) {
			if (this.chunks[i].tag === tag) return this.chunks[i];
		}
		return;
	}

	addChunk(chunk: Chunk): void {
		this.chunks.push(chunk);
	}

	static chunkRegistry: Record<number, ChunkStatic> = {
		[ChunkTagsBE.FMT]: FormatChunk,
		[ChunkTagsBE.DATA]: DataChunk,
		[ChunkTagsBE.CUE]: CueChunk,
		[ChunkTagsBE.SMPL]: SampleChunk,
		[ChunkTagsBE.LIST]: ListChunk,
	};

	static decode(buffer: ArrayBuffer) {
		const file = new DataView(buffer);
		
		if (file.getUint32(0x0, false) !== ChunkTagsBE.RIFF)
			throw Error('Invalid magic string (RIFF)! Is this a .wav file?');
		
		if (file.getUint32(0x8, false) !== ChunkTagsBE.WAVE)
			throw Error('Invalid magic string (WAVE)! Is this a .wav file?');

		const fileLength = file.getUint32(0x4, true);
		if (fileLength + 8 > buffer.byteLength)
			throw Error(`Invalid file length! (Bigger than buffer.)`);

		const chunks: Chunk[] = [];
		let idx = 12;

		while (idx < fileLength) {
			const chunkTag    = file.getUint32(idx + 0x0, false);
			const chunkLength = file.getUint32(idx + 0x4, true);
			idx += 8;

			const chunkType = this.chunkRegistry[chunkTag] ?? UnknownChunk;
			const chunkView = new DataView(buffer, idx, chunkLength);
			idx += chunkLength;

			chunks.push(chunkType.unpack(chunkView, chunkTag));

			// Short-align
			if (idx & 1) idx ++;
		}

		return new Wave(chunks);
	}
}
