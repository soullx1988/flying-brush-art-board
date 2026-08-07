export interface AllowedUser { openId: string; name: string; department?: string; position?: string }
export interface AllowedUserDirectory { findByOpenId(openId: string): Promise<AllowedUser | undefined>; checkHealth(): Promise<'ok' | 'error'>; close(): Promise<void> }
export class UserNotAllowedError extends Error { code = 'USER_NOT_ALLOWED' }
