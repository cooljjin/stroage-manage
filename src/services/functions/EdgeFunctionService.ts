import type { FunctionInvokeOptions } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";

export const EdgeFunctionService = {
  invoke<T = unknown>(functionName: string, options?: FunctionInvokeOptions) {
    return supabase.functions.invoke<T>(functionName, options);
  }
};
