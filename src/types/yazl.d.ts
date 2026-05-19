declare module 'yazl' {
  import { EventEmitter } from 'events';
  import { Readable } from 'stream';

  export class ZipFile extends EventEmitter {
    outputStream: Readable;
    addBuffer(buffer: Buffer, metadataPath: string): void;
    end(): void;
  }
}
