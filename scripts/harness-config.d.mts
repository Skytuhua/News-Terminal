export const root: string;
export function browserHarnessOptions(env?: NodeJS.ProcessEnv): {
  port: number;
  baseURL: string;
  outputDir: string;
  htmlReportDir: string;
  cacheDir: string;
  executablePath: string | undefined;
};
