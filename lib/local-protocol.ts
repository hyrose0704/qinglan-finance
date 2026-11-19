export const LOCAL_ASSISTANT_ORIGIN = "http://127.0.0.1:48791";
export const LOCAL_ASSISTANT_PORT = 48791;
export const LOCAL_WEB_ORIGINS = ["https://hyrose0704.github.io", "http://127.0.0.1:5174", "http://127.0.0.1:4174", LOCAL_ASSISTANT_ORIGIN];
export interface LocalAccount {
  id: string; email: string; plan: string; connected: boolean; sharing: boolean; lastCompletedAt: string;
}
export interface LocalStatus {
  accounts: LocalAccount[];
  login: { pending: boolean; error: string; accountId: string } | null;
}
export interface LocalModel { id: string; name: string }
