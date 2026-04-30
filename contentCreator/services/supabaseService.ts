import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

const SUPABASE_LS_URL_KEY = 'supabaseUrl';
const SUPABASE_LS_ANON_KEY_KEY = 'supabaseAnonKey';

class SupabaseManager {
    private client: SupabaseClient | null = null;

    constructor() {
        this.initializeClient();
    }

    private initializeClient(): void {
        const { url, anonKey } = this.getCredentials();
        if (url && anonKey) {
            this.client = createClient(url, anonKey);
        } else {
            this.client = null;
        }
    }
    
    getCredentials(): { url: string | null; anonKey: string | null } {
        const url = localStorage.getItem(SUPABASE_LS_URL_KEY) || SUPABASE_URL;
        const anonKey = localStorage.getItem(SUPABASE_LS_ANON_KEY_KEY) || SUPABASE_ANON_KEY;
        return { url, anonKey };
    }

    setCredentials(url: string, anonKey: string): void {
        localStorage.setItem(SUPABASE_LS_URL_KEY, url);
        localStorage.setItem(SUPABASE_LS_ANON_KEY_KEY, anonKey);
        this.initializeClient();
    }

    clearCredentials(): void {
        localStorage.removeItem(SUPABASE_LS_URL_KEY);
        localStorage.removeItem(SUPABASE_LS_ANON_KEY_KEY);
        this.initializeClient();
    }

    getClient(): SupabaseClient | null {
        return this.client;
    }

    isConfigured(): boolean {
        return this.client !== null;
    }

    async testConnection(): Promise<{ success: boolean; error: string | null }> {
        if (!this.client) {
            return { success: false, error: 'Client not configured.' };
        }
        try {
            // Perform a lightweight query to check credentials and table access.
            const { error } = await this.client
                .from('generated_content')
                .select('id', { count: 'exact', head: true });
            
            if (error) {
                if (error.code === '42P01') {
                    return { success: false, error: 'Connection successful, but the "generated_content" table was not found. Please run the setup SQL.' };
                }
                 if (error.message.includes("new row violates row-level security policy")) {
                    return { success: false, error: `Connection successful, but Row Level Security (RLS) is preventing access. Please disable RLS or create a policy for the 'generated_content' table.` };
                }
                return { success: false, error: `Supabase error: ${error.message}` };
            }
            return { success: true, error: null };
        } catch (e: any) {
            return { success: false, error: e.message || 'An unknown error occurred.' };
        }
    }
}

// Export a singleton instance of the manager.
const supabaseManager = new SupabaseManager();
export default supabaseManager;
