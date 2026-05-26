declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      destination: string;
      filename: string;
      path: string;
      buffer?: Buffer;
    }
  }

  interface Request {
    file?: Multer.File;
  }
}

declare module "multer" {
  interface StorageEngine {}

  interface DiskStorageOptions {
    destination: string | ((req: Express.Request, file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => void);
    filename: (req: Express.Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => void;
  }

  interface Options {
    storage?: StorageEngine;
    limits?: {
      fileSize?: number;
    };
    fileFilter?: (req: Express.Request, file: Express.Multer.File, callback: (error: Error | null, acceptFile?: boolean) => void) => void;
  }

  interface Multer {
    single(fieldName: string): import("express").RequestHandler;
  }

  interface MulterFactory {
    (options?: Options): Multer;
    diskStorage(options: DiskStorageOptions): StorageEngine;
  }

  const multer: MulterFactory;
  export default multer;
}
