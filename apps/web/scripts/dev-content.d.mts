export const PREVIEW_HINT: string;
export const PREVIEW_NOTICE: string;
export function resolveDevContent(input: { env: Record<string, string | undefined>; previewExists: boolean }): { content: string; message: string | null };
export function devArgs(args: string[]): string[];
