
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ClipboardIcon } from './icons/ClipboardIcon';
import { ExternalLinkIcon } from './icons/ExternalLinkIcon';
import { DownloadIcon } from './icons/DownloadIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import type { GeneratedItem, Language } from '../types';
import { 
    exportAsTxt, 
    exportAsMarkdown, 
    exportAsDocx,
    exportAllAsTxt,
    exportAllAsMarkdown,
    exportAllAsDocx
} from '../services/exportService';
import { MapView, type MapLocation } from './MapView';
import type { LatLng, RouteLegResult } from '../services/mapService';

interface ContentDisplayProps {
  items: GeneratedItem[];
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  onItemContentChange: (id: string, newContent: string) => void;
  isLoading: boolean;
  error: string | null;
  isAnalyzing: boolean;
  generationProgress: string;
  outputLanguage: Language;
  onRetry?: () => void;
  onResume?: () => void;
  onRegenerate?: (id: string) => void;
  onRemoveItem?: (id: string) => void;
  itemCoords?: Record<string, LatLng>;
  routeLegs?: RouteLegResult[];
}

const LoadingState: React.FC<{isAnalyzing: boolean; generationProgress: string}> = ({ isAnalyzing, generationProgress }) => {
    let text = 'Generating your content...';
    let subtext = 'The AI is crafting a masterpiece, please wait.';

    if (isAnalyzing) {
        text = 'Analyzing Document...';
        subtext = 'Identifying cities and attractions to generate content for.';
    } else if (generationProgress) {
        text = 'Creating Content...';
        subtext = generationProgress;
    }
  
  return (
    <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
      <div className="p-8 bg-slate-700/50 rounded-lg">
        <svg className="animate-spin h-12 w-12 text-cyan-400 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="mt-4 text-lg font-semibold">{text}</p>
        <p className="text-sm">{subtext}</p>
      </div>
    </div>
  );
};

const PlaceholderState: React.FC = () => (
    <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 p-4">
       <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <h3 className="text-xl font-medium text-slate-300">Your AI-generated content will appear here.</h3>
      <p className="mt-1">Upload an itinerary document and click "Analyze & Generate".</p>
    </div>
);

const QuotaErrorDisplay: React.FC<{ message: string; onRetry?: () => void; }> = ({ message, onRetry }) => {
    const parts = message.replace('QUOTA_EXCEEDED::', '').split('|');
    const mainMessage = parts[0].trim();
    const links = parts.slice(1).map(part => {
        const i = part.indexOf(':');
        if (i === -1) return null;
        const text = part.substring(0, i).trim();
        const url = part.substring(i + 1).trim();
        return { text, url };
    }).filter((link): link is { text: string; url: string } => link !== null);

    return (
        <div className="bg-red-900/50 border border-red-700 p-6 rounded-lg max-w-lg mx-auto text-center">
            <p className="font-semibold text-red-300">API Quota Exceeded</p>
            <p className="text-sm mt-2 text-red-400">{mainMessage}</p>
            {links.length > 0 && (
                <div className="mt-4 space-y-2 text-sm text-left inline-block">
                    {links.map((link, index) => (
                        <a key={index} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-cyan-400 hover:text-cyan-300 hover:underline">
                            <ExternalLinkIcon className="w-4 h-4 flex-shrink-0" />
                            <span>{link.text}</span>
                        </a>
                    ))}
                </div>
            )}
            {onRetry && (
                <button onClick={onRetry} className="mt-6 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-4 rounded-md transition-colors">
                    Retry Last Action
                </button>
            )}
        </div>
    );
};


export const ContentDisplay: React.FC<ContentDisplayProps> = ({ 
    items, 
    selectedItemId, 
    onSelectItem, 
    onItemContentChange, 
    isLoading, 
    error, 
    isAnalyzing, 
    generationProgress,
    outputLanguage,
    onRetry,
    onResume,
    onRegenerate,
    onRemoveItem,
    itemCoords,
    routeLegs,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isAllExportMenuOpen, setIsAllExportMenuOpen] = useState(false);
  const allExportMenuRef = useRef<HTMLDivElement>(null);
  const [viewTab, setViewTab] = useState<'text' | 'map'>('text');

  const mapLocations: MapLocation[] = useMemo(() => {
    if (!itemCoords) return [];
    return items
      .map(it => {
        const c = itemCoords[it.id];
        if (!c) return null;
        return {
          id: it.id,
          name: it.name,
          day: it.day,
          lat: c.lat,
          lng: c.lng,
        } as MapLocation;
      })
      .filter((x): x is MapLocation => x !== null);
  }, [items, itemCoords]);

  // Index legs by `toId` so the sidebar can show the inbound distance/time
  // banner above each item ("↓ 5 km · 12 min from previous stop").
  const routeByToId = useMemo(() => {
    const m = new Map<string, RouteLegResult>();
    for (const leg of routeLegs || []) m.set(leg.toId, leg);
    return m;
  }, [routeLegs]);

  const formatLegLabel = (leg: RouteLegResult): string => {
    const km = typeof leg.distanceKm === 'number'
      ? (leg.distanceKm < 10 ? leg.distanceKm.toFixed(1) : Math.round(leg.distanceKm).toString())
      : null;
    const min = typeof leg.durationMinutes === 'number'
      ? Math.max(1, Math.round(leg.durationMinutes))
      : null;
    if (km == null || min == null) return '';
    const time = min < 60
      ? `${min} min`
      : (min % 60 === 0 ? `${Math.floor(min / 60)}h` : `${Math.floor(min / 60)}h ${min % 60}m`);
    const approx = leg.estimated ? '~' : '';
    return `${approx}${km} km · ${time}`;
  };

  const selectedItem = items.find(item => item.id === selectedItemId);
  
  const groupedItems = useMemo(() => {
    const groups: Record<string, GeneratedItem[]> = {};
    items.forEach(item => {
      const day = item.day || 'General';
      if (!groups[day]) groups[day] = [];
      groups[day].push(item);
    });
    return groups;
  }, [items]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (allExportMenuRef.current && !allExportMenuRef.current.contains(event.target as Node)) {
        setIsAllExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleCopy = () => {
    if (selectedItem) {
        navigator.clipboard.writeText(selectedItem.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExport = async (format: 'txt' | 'md' | 'docx') => {
    if (!selectedItem) return;
    setIsExportMenuOpen(false);
    switch (format) {
        case 'txt': exportAsTxt(selectedItem); break;
        case 'md': exportAsMarkdown(selectedItem); break;
        case 'docx': await exportAsDocx(selectedItem); break;
    }
  };

  const handleExportAll = async (format: 'txt' | 'md' | 'docx') => {
    if (items.length === 0) return;
    setIsAllExportMenuOpen(false);
    switch (format) {
        case 'txt': exportAllAsTxt(items); break;
        case 'md': exportAllAsMarkdown(items); break;
        case 'docx': await exportAllAsDocx(items); break;
    }
  };
  
  const hasContent = items.length > 0;
  const totalItems = items.length;
  const completedItems = items.filter(item => item.status === 'completed').length;
  const hasPendingItems = items.some(item => item.status !== 'completed');
  const progressPercentage = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return (
    <div className="bg-slate-800 rounded-lg shadow-lg h-full flex flex-col md:flex-row border border-slate-700 overflow-hidden">
        <div className="flex-grow flex flex-col relative min-w-0 min-h-0">
          {(error || (hasPendingItems && !isLoading)) && hasContent && (
            <div className={`border-b p-3 flex items-center justify-between z-20 flex-shrink-0 ${error ? 'bg-red-900/90 border-red-700' : 'bg-amber-900/90 border-amber-700'}`}>
              <div className={`text-sm ${error ? 'text-red-200' : 'text-amber-200'}`}>
                {error ? (
                  <>
                    <span className="font-bold mr-2">Error:</span>
                    {error.startsWith('QUOTA_EXCEEDED::') ? 'API Quota Exceeded' : error}
                  </>
                ) : (
                  <>
                    <span className="font-bold mr-2">Interrupted:</span>
                    Generation was interrupted. You have {totalItems - completedItems} pending items.
                  </>
                )}
              </div>
              {onResume && (
                <button onClick={onResume} className={`${error ? 'bg-red-800 hover:bg-red-700' : 'bg-amber-800 hover:bg-amber-700'} text-white text-xs font-bold py-1 px-3 rounded transition-colors`}>
                  Resume Generation
                </button>
              )}
            </div>
          )}
          {isLoading && hasContent && (
            <div className="bg-slate-800 border-b border-slate-700 p-3 z-20 flex-shrink-0 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-3.5 w-3.5 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>{totalItems > 1 ? `Generating items (${completedItems}/${totalItems})...` : generationProgress || 'Generating...'}</span>
                </div>
                {totalItems > 1 && <span className="font-medium text-cyan-400">{progressPercentage}%</span>}
              </div>
              {totalItems > 1 && (
                <div className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-cyan-500 h-1.5 rounded-full transition-all duration-300 ease-out" 
                    style={{ width: `${progressPercentage}%` }}
                  ></div>
                </div>
              )}
            </div>
          )}
          {isLoading && !hasContent ? (
            <LoadingState isAnalyzing={isAnalyzing} generationProgress={generationProgress} />
          ) : error && !hasContent ? (
            <div className="flex items-center justify-center h-full text-red-400 text-center p-4">
              {error.startsWith('QUOTA_EXCEEDED::') ? (
                <QuotaErrorDisplay message={error} onRetry={onRetry} />
              ) : (
                <div className="bg-red-900/50 border border-red-700 p-6 rounded-lg">
                  <p className="font-semibold">An Error Occurred</p>
                  <p className="text-sm mt-1">{error}</p>
                  {onRetry && (
                    <button onClick={onRetry} className="mt-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-4 rounded-md transition-colors">
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : !hasContent ? (
            <PlaceholderState />
          ) : selectedItem ? (
            <>
              <div className="flex-grow p-4 pt-0 flex flex-col min-h-0">
                  <header className="py-4 flex items-center justify-between sticky top-0 bg-slate-800 z-10 border-b border-slate-700/50 mb-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                           <h2 className="text-lg font-bold text-slate-100 truncate">{selectedItem.name}</h2>
                           {selectedItem.day && <span className="text-[10px] bg-cyan-900/50 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-800/50 uppercase font-bold">{selectedItem.day}</span>}
                           {selectedItem.status === 'generating' && (
                             <svg className="animate-spin h-4 w-4 text-cyan-400 ml-2 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                             </svg>
                           )}
                        </div>
                        <p className="text-sm text-slate-400">{selectedItem.type}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex rounded-md overflow-hidden border border-slate-700 text-xs">
                          <button
                            type="button"
                            onClick={() => setViewTab('text')}
                            className={`px-2.5 py-1.5 transition-colors ${viewTab === 'text' ? 'bg-cyan-700 text-white' : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700'}`}
                            title="Show generated text"
                          >
                            Text
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewTab('map')}
                            className={`px-2.5 py-1.5 transition-colors ${viewTab === 'map' ? 'bg-cyan-700 text-white' : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700'}`}
                            title="Show itinerary on a map"
                          >
                            Map
                          </button>
                        </div>
                        {onRegenerate && (
                          <button
                              onClick={() => onRegenerate(selectedItem.id)}
                              disabled={selectedItem.status === 'generating'}
                              className={`flex items-center gap-2 font-medium py-1.5 px-3 rounded-md transition-colors text-sm border ${
                                selectedItem.status === 'generating' 
                                  ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed' 
                                  : 'bg-cyan-900/50 hover:bg-cyan-800/50 text-cyan-400 border-cyan-800/50'
                              }`}
                              title="Regenerate this item"
                          >
                              <SparklesIcon className="w-4 h-4" />
                              Regenerate
                          </button>
                        )}
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-1.5 px-3 rounded-md transition-colors text-sm"
                        >
                            <ClipboardIcon />
                            {copied ? 'Copied!' : 'Copy'}
                        </button>
                        <div className="relative" ref={exportMenuRef}>
                            <button
                                onClick={() => setIsExportMenuOpen(prev => !prev)}
                                className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-1.5 px-3 rounded-md transition-colors text-sm"
                            >
                                <DownloadIcon />
                                Export
                            </button>
                            {isExportMenuOpen && (
                                <div className="absolute right-0 mt-2 w-48 bg-slate-600 border border-slate-500 rounded-md shadow-lg z-20 py-1">
                                    <button onClick={() => handleExport('txt')} className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-500 transition-colors">as Text (.txt)</button>
                                    <button onClick={() => handleExport('md')} className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-500 transition-colors">as Markdown (.md)</button>
                                    <button onClick={() => handleExport('docx')} className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-500 transition-colors">as Word (.docx)</button>
                                </div>
                            )}
                        </div>
                      </div>
                  </header>
                  
                  {viewTab === 'map' ? (
                    <div className="w-full flex-grow min-h-0">
                      <MapView
                        locations={mapLocations}
                        routes={routeLegs || []}
                        selectedId={selectedItemId}
                        onSelect={onSelectItem}
                        totalItems={items.length}
                      />
                    </div>
                  ) : selectedItem.status === 'pending' ? (
                    <div className="w-full flex-grow flex flex-col items-center justify-center text-slate-500 space-y-3">
                      <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                        <span className="text-xl">⏳</span>
                      </div>
                      <p className="text-sm">Waiting in queue...</p>
                    </div>
                  ) : selectedItem.status === 'generating' && !selectedItem.content ? (
                    <div className="w-full flex-grow flex flex-col items-center justify-center text-slate-400 space-y-4">
                      <svg className="animate-spin h-8 w-8 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <p className="text-sm animate-pulse">Gathering information and generating content...</p>
                    </div>
                  ) : (
                    <textarea
                        value={selectedItem.content}
                        onChange={(e) => onItemContentChange(selectedItem.id, e.target.value)}
                        className="w-full flex-grow bg-transparent text-slate-200 resize-none focus:outline-none text-sm leading-relaxed font-anuphan"
                        placeholder={selectedItem.status === 'error' ? "An error occurred generating this item." : "Generated content..."}
                    />
                  )}
              </div>
              {selectedItem.sources.length > 0 && (
                <div className="flex-shrink-0 border-t border-slate-700 p-4 max-h-40 overflow-y-auto">
                  <h3 className="text-sm font-semibold text-slate-300 mb-2">Sources</h3>
                  <ul className="space-y-1.5">
                    {selectedItem.sources.map((source, index) => (
                      <li key={index}>
                        <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 text-xs flex items-center gap-1.5 group transition-colors">
                          <ExternalLinkIcon className="w-3.5 h-3.5 flex-shrink-0 text-slate-400 group-hover:text-cyan-300" />
                          <span className="truncate" title={source.title}>{source.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
        </div>

        {hasContent && (
            <aside className="w-full md:w-64 flex-shrink-0 border-t md:border-t-0 md:border-l border-slate-700 h-1/3 md:h-full flex flex-col bg-slate-900/30">
                <div className="p-3 border-b border-slate-700 flex-shrink-0 flex items-center justify-between bg-slate-800">
                    <h3 className="text-sm font-semibold text-slate-300">Itinerary Items</h3>
                    <div className="relative" ref={allExportMenuRef}>
                        <button onClick={() => setIsAllExportMenuOpen(prev => !prev)} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-700 hover:text-cyan-400 transition-colors" title="Export all">
                            <DownloadIcon />
                        </button>
                        {isAllExportMenuOpen && (
                            <div className="absolute right-0 mt-2 w-48 bg-slate-600 border border-slate-500 rounded-md shadow-lg z-20 py-1">
                                <button onClick={() => handleExportAll('txt')} className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-500 transition-colors">as Text (.txt)</button>
                                <button onClick={() => handleExportAll('md')} className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-500 transition-colors">as Markdown (.md)</button>
                                <button onClick={() => handleExportAll('docx')} className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-500 transition-colors">as Word (.docx)</button>
                            </div>
                        )}
                    </div>
                </div>
                <nav className="flex-grow overflow-y-auto p-2 space-y-4">
                    {/* Fixed type inference for Object.entries */}
                    {(Object.entries(groupedItems) as [string, GeneratedItem[]][]).map(([day, dayItems]) => (
                        <div key={day} className="space-y-1">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-1 border-b border-slate-700/30">{day}</h4>
                            <ul className="space-y-0.5">
                              {dayItems.map((item, idx) => {
                                const leg = idx > 0 ? routeByToId.get(item.id) : undefined;
                                const legLabel = leg ? formatLegLabel(leg) : '';
                                return (
                                <li key={item.id}>
                                  {legLabel && (
                                    <div
                                      className={`flex items-center gap-2 px-2 py-0.5 text-[10px] ${leg?.suspicious ? 'text-rose-400' : 'text-slate-500'}`}
                                      title={
                                        leg?.suspicious
                                          ? 'Likely wrong location — one of these stops geocoded far from its day\u2019s city. Click \u2715 to remove a bad entry.'
                                          : leg?.estimated
                                            ? 'Approximate (straight-line estimate)'
                                            : 'Driving distance via OSRM'
                                      }
                                    >
                                      <span className="flex-shrink-0 leading-none">{leg?.suspicious ? '?' : '↓'}</span>
                                      <span className={`flex-grow border-t border-dashed ${leg?.suspicious ? 'border-rose-500/40' : 'border-slate-700/70'}`} />
                                      <span
                                        className={`flex-shrink-0 ${
                                          leg?.suspicious
                                            ? 'italic text-rose-400'
                                            : leg?.estimated
                                              ? 'text-slate-500/70 italic'
                                              : 'text-slate-400'
                                        }`}
                                      >
                                        {legLabel}
                                      </span>
                                    </div>
                                  )}
                                  <div
                                    className={`group flex items-center justify-between rounded-md text-sm transition-colors ${selectedItemId === item.id ? 'bg-cyan-800/60 text-white' : 'text-slate-300 hover:bg-slate-700/80'}`}
                                  >
                                    <button
                                      onClick={() => onSelectItem(item.id)}
                                      className="flex-grow min-w-0 text-left p-2 pr-1"
                                    >
                                      <span className="font-medium truncate block leading-tight">{item.name}</span>
                                      <span className={`text-[10px] ${selectedItemId === item.id ? 'text-cyan-300' : 'text-slate-500 group-hover:text-slate-400'}`}>{item.type}</span>
                                    </button>
                                    <div className="flex items-center gap-1.5 pr-2 flex-shrink-0">
                                      {item.status === 'generating' && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse block" title="Generating"></span>}
                                      {item.status === 'error' && <span className="w-2 h-2 rounded-full bg-red-500 block" title="Error"></span>}
                                      {item.status === 'completed' && <span className="w-2 h-2 rounded-full bg-green-500 block" title="Completed"></span>}
                                      {item.status === 'pending' && <span className="w-2 h-2 rounded-full bg-slate-600 block" title="Pending"></span>}
                                      {onRemoveItem && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveItem(item.id);
                                          }}
                                          className={`w-5 h-5 rounded flex items-center justify-center text-xs leading-none transition-colors ${selectedItemId === item.id ? 'text-cyan-200 hover:bg-cyan-700/60' : 'text-slate-500 hover:text-red-300 hover:bg-red-900/30 opacity-0 group-hover:opacity-100'}`}
                                          title={`Remove "${item.name}"`}
                                          aria-label={`Remove ${item.name}`}
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </li>
                                );
                              })}
                            </ul>
                        </div>
                    ))}
                </nav>
            </aside>
        )}
    </div>
  );
};
