import { FunctionsHttpError, type FunctionInvokeOptions } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { normalizeServiceError } from "../errors";

export const EdgeFunctionService = {
  invoke<T = unknown>(functionName: string, options?: FunctionInvokeOptions) {
    return supabase.functions.invoke<T>(functionName, options);
  },

  async getErrorMessage(error: unknown, fallback: string) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null) as { error?: unknown } | null;
      if (payload && typeof payload.error === "string") return payload.error;
    }

    return normalizeServiceError(error)?.message ?? fallback;
  }
};
