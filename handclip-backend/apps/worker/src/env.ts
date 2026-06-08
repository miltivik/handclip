const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'REDIS_HOST'] as const;

export function getMissingRequiredEnvVars(env: NodeJS.ProcessEnv): string[] {
  return REQUIRED_VARS.filter((variable) => !env[variable]);
}
