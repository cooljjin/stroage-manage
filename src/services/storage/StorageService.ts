import { supabase } from "../../lib/supabase";

export const StorageService = {
  upload(bucket: string, path: string, file: File | Blob | ArrayBuffer | FormData, options?: { cacheControl?: string; contentType?: string; upsert?: boolean }) {
    return supabase.storage.from(bucket).upload(path, file, options);
  },

  download(bucket: string, path: string) {
    return supabase.storage.from(bucket).download(path);
  },

  remove(bucket: string, paths: string[]) {
    return supabase.storage.from(bucket).remove(paths);
  },

  getPublicUrl(bucket: string, path: string) {
    return supabase.storage.from(bucket).getPublicUrl(path);
  }
};
