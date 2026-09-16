import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const viteMode = import.meta.env.MODE;
const deploymentEnv = import.meta.env.VITE_DEPLOYMENT_ENV as string | undefined;
const supabaseProjectRef = import.meta.env.VITE_SUPABASE_PROJECT_REF as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(".env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY를 설정해야 합니다.");
}

const deploymentProjectRefs = {
  staging: "nchvyxhyfatgwpvilbng",
  production: "pcvpkndyqkljgbrvssza"
} as const;

if (viteMode === "staging" || viteMode === "production") {
  if (!deploymentEnv || !supabaseProjectRef) {
    throw new Error(`${viteMode} 빌드에는 VITE_DEPLOYMENT_ENV와 VITE_SUPABASE_PROJECT_REF가 모두 필요합니다.`);
  }
  if (deploymentEnv !== viteMode) {
    throw new Error(`Vite mode(${viteMode})와 VITE_DEPLOYMENT_ENV(${deploymentEnv})가 일치하지 않습니다.`);
  }
  const expectedProjectRef = deploymentProjectRefs[viteMode];
  if (supabaseProjectRef !== expectedProjectRef) {
    throw new Error(`${viteMode} 환경의 Supabase project ref가 올바르지 않습니다.`);
  }
  if (supabaseUrl !== `https://${expectedProjectRef}.supabase.co`) {
    throw new Error(`${viteMode} 환경의 VITE_SUPABASE_URL이 올바르지 않습니다.`);
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce"
  }
});
