
import React from 'react';
import type { Language, Tone, Preset } from '../types';
import { INPUT_LANGUAGES, OUTPUT_LANGUAGES, TONES } from '../constants';
import { SparklesIcon } from './icons/SparklesIcon';
import { ContextUploader } from './ContextUploader';
import { BookmarkIcon } from './icons/BookmarkIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

interface ControlPanelProps {
  inputLanguage: Language;
  setInputLanguage: (value: Language) => void;
  outputLanguage: Language;
  setOutputLanguage: (value: Language) => void;
  tone: Tone;
  setTone: (value: Tone) => void;
  customTone: string;
  setCustomTone: (value: string) => void;
  useRAG: boolean;
  setUseRAG: (value: boolean) => void;
  includeFullContext: boolean;
  setIncludeFullContext: (value: boolean) => void;
  onGenerate: () => void;
  isLoading: boolean;
  contextSource: string | null;
  documentImages: string[];
  onFileSelected: (file: File) => void;
  onPaste: () => void;
  onContextRemove: () => void;
  onTextSubmit: (text: string) => void;
  presets: Preset[];
  onSavePreset: (name: string) => void;
  onLoadPreset: (id: string) => void;
  onDeletePreset: (id: string) => void;
}

const SelectInput: React.FC<{
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: string[];
  id: string;
}> = ({ label, value, onChange, options, id }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1">
      {label}
    </label>
    <select
      id={id}
      value={value}
      onChange={onChange}
      className="w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </div>
);


export const ControlPanel: React.FC<ControlPanelProps> = ({
  inputLanguage,
  setInputLanguage,
  outputLanguage,
  setOutputLanguage,
  tone,
  setTone,
  customTone,
  setCustomTone,
  useRAG,
  setUseRAG,
  includeFullContext,
  setIncludeFullContext,
  onGenerate,
  isLoading,
  contextSource,
  documentImages,
  onFileSelected,
  onPaste,
  onContextRemove,
  onTextSubmit,
  presets,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
}) => {
  const handleSaveClick = () => {
    const presetName = prompt("Enter a name for this preset:", contextSource || "New Preset");
    if (presetName) {
      onSavePreset(presetName);
    }
  };

  const isContextAvailable = !!contextSource;

  return (
    <div className="bg-slate-800 p-4 rounded-lg shadow-lg h-full flex flex-col gap-4 border border-slate-700 overflow-y-auto">
      <h2 className="text-lg font-semibold text-cyan-400 border-b border-slate-700 pb-2">Content Generator</h2>
      
      <p className="text-sm text-slate-400">
        Upload a document to automatically identify cities and attractions, then generate descriptions for all of them.
      </p>
      
      <ContextUploader 
        contextSource={contextSource}
        imagePreview={documentImages[0] || null}
        onFileSelected={onFileSelected}
        onPaste={onPaste}
        onRemove={onContextRemove}
        onTextSubmit={onTextSubmit}
      />

      <div className="relative">
        <details className="group">
          <summary className="w-full flex items-center justify-between bg-slate-700 hover:bg-slate-600 cursor-pointer list-none p-2 rounded-md transition-colors text-slate-200 font-medium text-sm">
            <span>Context Presets ({presets.length})</span>
            <ChevronDownIcon className="w-5 h-5 text-slate-400 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="absolute top-full left-0 right-0 mt-1 bg-slate-700 border border-slate-600 rounded-md shadow-lg z-20 p-2 space-y-1">
            <button
              onClick={handleSaveClick}
              disabled={!isContextAvailable}
              className="w-full flex items-center gap-2 p-2 text-sm rounded-md text-slate-200 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <BookmarkIcon className="w-4 h-4" />
              Save current context...
            </button>
            {presets.length > 0 && <hr className="border-slate-600 my-1" />}
            {presets.length > 0 ? (
              <div className="max-h-40 overflow-y-auto pr-1">
                {presets.map(preset => (
                  <div key={preset.id} className="group/item flex items-center justify-between p-2 text-sm rounded-md text-slate-300 hover:bg-slate-600">
                    <button onClick={() => onLoadPreset(preset.id)} className="flex-grow text-left truncate" title={preset.name}>
                      {preset.name}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Are you sure you want to delete the preset "${preset.name}"?`)) {
                          onDeletePreset(preset.id);
                        }
                      }}
                      className="ml-2 p-1 text-slate-400 opacity-0 group-hover/item:opacity-100 hover:text-red-400 transition-all"
                      aria-label={`Delete preset ${preset.name}`}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-2 text-xs text-slate-400 text-center">No presets saved yet.</p>
            )}
          </div>
        </details>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <SelectInput
          id="input-language"
          label="Input Language"
          value={inputLanguage}
          onChange={(e) => setInputLanguage(e.target.value as Language)}
          options={INPUT_LANGUAGES}
        />
        <SelectInput
          id="output-language"
          label="Output Language"
          value={outputLanguage}
          onChange={(e) => setOutputLanguage(e.target.value as Language)}
          options={OUTPUT_LANGUAGES}
        />
      </div>

       <div>
        <SelectInput
          id="tone-select"
          label="Tone of Voice"
          value={tone}
          onChange={(e) => setTone(e.target.value as Tone)}
          options={TONES}
        />
        {tone === 'Custom' && (
          <div className="mt-2">
            <label htmlFor="custom-tone" className="sr-only">Custom Tone</label>
            <input
              type="text"
              id="custom-tone"
              value={customTone}
              onChange={(e) => setCustomTone(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition placeholder-slate-400"
              placeholder="e.g., Witty and sarcastic"
            />
          </div>
        )}
      </div>

      <div className="space-y-4 bg-slate-700/50 p-3 rounded-md">
        <div>
          <label htmlFor="rag-toggle" className="flex items-center justify-between cursor-pointer">
              <span className="font-medium text-slate-200">Web Research (RAG)</span>
              <div className="relative">
                  <input
                      id="rag-toggle"
                      type="checkbox"
                      className="sr-only peer"
                      checked={useRAG}
                      onChange={(e) => setUseRAG(e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-slate-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-offset-2 peer-focus:ring-offset-slate-800 peer-focus:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-600"></div>
              </div>
          </label>
          <p className="text-xs text-slate-400 mt-1">
              Enhance results with up-to-date information from the web.
          </p>
        </div>

        <div className="pt-3 border-t border-slate-600">
          <label htmlFor="full-context-toggle" className="flex items-center justify-between cursor-pointer">
              <span className="font-medium text-slate-200 text-sm">Include Full Document Context</span>
              <div className="relative">
                  <input
                      id="full-context-toggle"
                      type="checkbox"
                      className="sr-only peer"
                      checked={includeFullContext}
                      onChange={(e) => setIncludeFullContext(e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-slate-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-offset-2 peer-focus:ring-offset-slate-800 peer-focus:ring-cyan-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-600"></div>
              </div>
          </label>
          <p className="text-xs text-slate-400 mt-1">
              If disabled, only extracted entities are used for generation.
          </p>
        </div>
      </div>

      <div className="mt-auto pt-4">
        <button
          onClick={onGenerate}
          disabled={isLoading || !contextSource}
          className="w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-md shadow-md transition-all duration-300 transform hover:scale-105 disabled:scale-100"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </>
          ) : (
            <>
              <SparklesIcon />
              Analyze & Generate
            </>
          )}
        </button>
      </div>
    </div>
  );
};
