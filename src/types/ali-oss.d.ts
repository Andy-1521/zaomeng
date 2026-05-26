declare module 'ali-oss' {
  type PutOptions = {
    headers?: Record<string, string>;
  };

  type SignatureUrlOptions = {
    expires?: number;
    method?: string;
    response?: Record<string, string>;
  };

  type ClientOptions = {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    secure?: boolean;
    timeout?: string | number;
  };

  class OSS {
    constructor(options: ClientOptions);
    put(name: string, file: Buffer, options?: PutOptions): Promise<unknown>;
    signatureUrl(name: string, options?: SignatureUrlOptions): string;
  }

  export = OSS;
}
