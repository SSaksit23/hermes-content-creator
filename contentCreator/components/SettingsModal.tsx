
import React, { useState, useEffect } from 'react';
import supabaseManager from '../services/supabaseService';
import { XCircleIcon } from './icons/XCircleIcon';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Status = 'idle' | 'testing' | 'success' | 'error';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  // Supabase state
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Supabase setup
      const creds = supabaseManager.getCredentials();
      setUrl(creds.url || '');
      setAnonKey(creds.anonKey || '');
      setIsConfigured(supabaseManager.isConfigured());
      setStatus('idle');
      setMessage('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setStatus('testing');
    setMessage('Testing connection...');
    supabaseManager.setCredentials(url, anonKey);
    const result = await supabaseManager.testConnection();
    if (result.success) {
      setStatus('success');
      setMessage('Connection successful! Caching is enabled.');
      setIsConfigured(true);
    } else {
      setStatus('error');
      setMessage(result.error || 'An unknown error occurred.');
      setIsConfigured(false);
    }
  };
  
  const handleSave = () => {
      supabaseManager.setCredentials(url, anonKey);
      setIsConfigured(supabaseManager.isConfigured());
      setStatus('success');
      setMessage('Credentials saved. Please test the connection to enable caching.');
  };
  
  const handleClear = () => {
      supabaseManager.clearCredentials();
      setUrl('');
      setAnonKey('');
      setIsConfigured(false);
      setStatus('idle');
      setMessage('Credentials cleared. Caching is disabled.');
  };

  const statusColor = {
    idle: 'text-slate-400',
    testing: 'text-cyan-400',
    success: 'text-green-400',
    error: 'text-red-400',
  };

  return (
    <div 
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      onClick={onClose}
    >
      <div 
        className="bg-slate-800 rounded-lg shadow-2xl p-6 w-full max-w-2xl border border-slate-600 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
            <h2 id="dialog-title" className="text-xl font-bold text-cyan-400">Settings</h2>
            <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-700">
                <XCircleIcon className="w-6 h-6" />
            </button>
        </div>
        
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2">Supabase Caching</h3>
            <p className="text-sm text-slate-400">
                Enable caching to save results and reduce API usage. Get your credentials from your Supabase project dashboard under Project Settings &gt; API.
            </p>

             <div>
                <label htmlFor="supabase-url" className="block text-sm font-medium text-slate-300 mb-1">Project URL</label>
                <input
                    type="text"
                    id="supabase-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-md py-1.5 px-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="https://<your-project-ref>.supabase.co"
                />
            </div>

            <div>
                <label htmlFor="supabase-key" className="block text-sm font-medium text-slate-300 mb-1">Project API Key (anon public)</label>
                <input
                    type="text"
                    id="supabase-key"
                    value={anonKey}
                    onChange={(e) => setAnonKey(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-md py-1.5 px-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="ey..."
                />
            </div>
            
            <div className="flex items-center gap-2">
                <p className="text-sm">
                    Status: <span className={`font-semibold ${statusColor[status]}`}>
                        {isConfigured && status !== 'error' ? 'Enabled' : 'Disabled'}
                    </span>
                </p>
                {message && <p className={`text-xs ${statusColor[status]}`}>{message}</p>}
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={handleSave}
                    disabled={!url || !anonKey}
                    className="bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-200 font-bold py-2 px-4 rounded-md transition-colors text-sm"
                >
                    Save
                </button>
                <button
                    onClick={handleTest}
                    disabled={!url || !anonKey || status === 'testing'}
                    className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-800 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-md transition-colors text-sm"
                >
                    {status === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>
                 <button
                    onClick={handleClear}
                    className="ml-auto bg-red-800/50 hover:bg-red-700/50 text-red-300 font-medium py-2 px-4 rounded-md transition-colors text-sm"
                >
                    Clear
                </button>
            </div>

            <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2 pt-2">Setup Instructions</h3>
             <div className="text-sm text-slate-300 space-y-2">
                <p>1. Go to the <span className="font-semibold text-cyan-400">SQL Editor</span> in your Supabase project.</p>
                <p>2. Run the following SQL to create the table:</p>
                <pre className="bg-slate-900 p-3 rounded-md text-xs text-slate-300 overflow-x-auto">
                    {`CREATE TABLE generated_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  query_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  input_language TEXT NOT NULL,
  output_language TEXT NOT NULL,
  tone TEXT,
  use_rag BOOLEAN NOT NULL,
  content TEXT NOT NULL,
  sources JSONB
);

-- Optional: Create an index for faster lookups
CREATE INDEX idx_query_hash ON generated_content (query_hash);`}
                </pre>
                <p>3. Go to <span className="font-semibold text-cyan-400">Authentication &gt; Policies</span>, select the <code className="bg-slate-700 text-xs p-1 rounded">generated_content</code> table, and click <span className="font-semibold">"Disable RLS"</span>. This is required for caching to work.</p>
            </div>
        </div>

        <div className="flex justify-end gap-3 mt-4 border-t border-slate-700 pt-4">
          <button
            onClick={onClose}
            className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-4 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
