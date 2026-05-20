
import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { ControlPanel } from './components/ControlPanel';
import { ContentDisplay } from './components/ContentDisplay';
import { EntityEditorModal } from './components/EntityEditorModal';
import { SettingsModal } from './components/SettingsModal';
import { generateTravelContent, extractEntitiesFromDocument } from './services/geminiService';
import type { Language, Tone, EditableEntity, GeneratedItem, Preset } from './types';
import { ContentType } from './types';
import { INPUT_LANGUAGES, OUTPUT_LANGUAGES } from './constants';
import { SettingsIcon } from './components/icons/SettingsIcon';


pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs`;

const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
  });
};

const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
  });
};

const App: React.FC = () => {
  const [inputLanguage, setInputLanguage] = useState<Language>(INPUT_LANGUAGES[2]);
  const [outputLanguage, setOutputLanguage] = useState<Language>(OUTPUT_LANGUAGES[0]);
  const [tone, setTone] = useState<Tone>('Default');
  const [customTone, setCustomTone] = useState<string>('');
  const [useRAG, setUseRAG] = useState<boolean>(false);
  const [includeFullContext, setIncludeFullContext] = useState<boolean>(true);
  const [documentContext, setDocumentContext] = useState<string>('');
  const [documentImages, setDocumentImages] = useState<string[]>([]);
  const [contextSource, setContextSource] = useState<string | null>(null);
  const [generatedItems, setGeneratedItems] = useState<GeneratedItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isEditingEntities, setIsEditingEntities] = useState<boolean>(false);
  const [editableEntities, setEditableEntities] = useState<EditableEntity[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);

  // Mirror of generatedItems for use inside runGenerationLoop's stable
  // useCallback closure: lets us walk back to the previous same-day item
  // when regenerating or resuming without re-creating the loop callback.
  const generatedItemsRef = useRef<GeneratedItem[]>([]);
  useEffect(() => { generatedItemsRef.current = generatedItems; }, [generatedItems]);

  const AUTOSAVE_KEY = 'travelAIAutosave_v2';
  const PRESETS_KEY = 'travelAIPresets_v2';

  const saveState = useCallback(() => {
    if (generatedItems.length === 0) {
      localStorage.removeItem(AUTOSAVE_KEY);
      return;
    }
    try {
      const dataToSave = {
        items: generatedItems,
        selectedId: selectedItemId,
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(dataToSave));
    } catch (err) {
      console.error("Failed to save state to localStorage:", err);
    }
  }, [generatedItems, selectedItemId]);


  useEffect(() => {
    try {
      const savedDataJSON = localStorage.getItem(AUTOSAVE_KEY);
      if (savedDataJSON) {
        const savedData = JSON.parse(savedDataJSON);
        if (savedData.items && Array.isArray(savedData.items) && savedData.items.length > 0) {
          setGeneratedItems(savedData.items);
          if (savedData.selectedId && savedData.items.some((item: GeneratedItem) => item.id === savedData.selectedId)) {
            setSelectedItemId(savedData.selectedId);
          } else {
            setSelectedItemId(savedData.items[0].id);
          }
        }
      }
      
      const savedPresetsJSON = localStorage.getItem(PRESETS_KEY);
      if (savedPresetsJSON) {
        setPresets(JSON.parse(savedPresetsJSON));
      }

    } catch (err) {
      console.error("Failed to restore from localStorage:", err);
      localStorage.removeItem(AUTOSAVE_KEY);
      localStorage.removeItem(PRESETS_KEY);
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveState();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', saveState);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', saveState);
    };
  }, [saveState]);


  const handleFileSelected = async (file: File) => {
    const fileName = file.name;
    
    setContextSource(null);
    setDocumentContext('');
    setDocumentImages([]);
    setError(null);
    setGeneratedItems([]);
    setSelectedItemId(null);

    try {
      if (file.type === 'text/plain') {
        const text = await readFileAsText(file);
        setDocumentContext(text);
        setContextSource(fileName);
      } else if (file.type === 'application/pdf') {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => ('str' in item ? item.str : '')).join(' ') + '\n';
        }
        setDocumentContext(fullText);
        setContextSource(fileName);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const result = await mammoth.extractRawText({ arrayBuffer });
        setDocumentContext(result.value);
        setContextSource(fileName);
      } else if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            if (result) {
                setDocumentImages([result]);
                setContextSource(fileName);
            }
        };
        reader.readAsDataURL(file);
      } else {
        setError('Unsupported file type. Please upload a .txt, .pdf, .docx, or image file.');
        setTimeout(() => setError(null), 5000);
        return;
      }
    } catch (err) {
      console.error(`Error processing file ${fileName}:`, err);
      setError(`Failed to process the file: ${fileName}.`);
    }
  };

  const handlePaste = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      let contentFound = false;
      
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (dataUrl) {
              setDocumentImages([dataUrl]);
              setDocumentContext('');
              setContextSource('Pasted Image');
              setGeneratedItems([]);
              setSelectedItemId(null);
              setError(null);
            }
          };
          reader.readAsDataURL(blob);
          contentFound = true;
          break;
        }
      }
  
      if (!contentFound) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setDocumentContext(text);
          setDocumentImages([]);
          setContextSource(`Pasted content (${Math.round(text.length / 1024)} KB)`);
          setGeneratedItems([]);
          setSelectedItemId(null);
          setError(null);
          contentFound = true;
        }
      }

      if (!contentFound) {
         setError('Clipboard is empty or contains unsupported content.');
         setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      setError('Failed to read from clipboard.');
      setTimeout(() => setError(null), 5000);
    }
  }, []);

  const handleTextContextSubmit = (text: string) => {
    if (text) {
      setDocumentContext(text);
      setDocumentImages([]);
      setContextSource(`Manual Input (${Math.round(text.length / 1024)} KB)`);
      setGeneratedItems([]);
      setSelectedItemId(null);
      setError(null);
    }
  };

  const handleContextRemove = () => {
    setDocumentContext('');
    setDocumentImages([]);
    setContextSource(null);
    setGeneratedItems([]);
    setSelectedItemId(null);
  };

  const handleStartAnalysis = useCallback(async () => {
    if (isLoading) return;

    if (!documentContext && documentImages.length === 0) {
      setError('Please provide a document, image, or text context before starting the analysis.');
      setTimeout(() => setError(null), 5000);
      return;
    }

    setLastAction(() => handleStartAnalysis);
    setIsLoading(true);
    setIsAnalyzing(true);
    setError(null);
    setGeneratedItems([]);
    setSelectedItemId(null);
    setGenerationProgress('');

    try {
      const analysisResult = await extractEntitiesFromDocument({
        documentText: documentContext,
        documentImages,
        inputLanguage,
      });
      
      const typeMap: { [key: string]: ContentType } = {
        'City': ContentType.CITY,
        'Attraction': ContentType.ATTRACTION,
        'Meal': ContentType.MEAL_DESCRIPTION,
      };

      const allItems: EditableEntity[] = analysisResult
        .filter(entity => typeMap[entity.type])
        .map(entity => ({
          id: crypto.randomUUID(),
          name: entity.name,
          type: typeMap[entity.type],
          day: entity.day,
          disambiguationQuery: entity.disambiguationQuery
      }));

      setEditableEntities(allItems);
      setIsEditingEntities(true);
      setIsLoading(false);
      setIsAnalyzing(false);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred during the analysis phase.';
      setError(message);
      setIsLoading(false);
      setIsAnalyzing(false);
    }
  }, [documentContext, documentImages, isLoading, inputLanguage]);

  const runGenerationLoop = useCallback(async (itemsToProcess: GeneratedItem[]) => {
    setIsLoading(true);
    setError(null);
    
    let effectiveTone = '';
    if (tone === 'Custom') {
      effectiveTone = customTone;
    } else if (tone !== 'Default') {
      effectiveTone = tone;
    }

    try {
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        setGenerationProgress(`Generating for "${item.name}" (${i + 1}/${itemsToProcess.length})...`);
        setSelectedItemId(item.id);
        
        // Brief pause between requests to avoid hitting rate limits (RPM quota)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        setGeneratedItems(prev => prev.map(p => p.id === item.id ? { ...p, status: 'generating' } : p));

        // Find the previous same-day entity (if any) to hint the OSRM route
        // lookup on the server. We resolve against the live generatedItems
        // ref (falling back to itemsToProcess on the very first run before
        // setGeneratedItems has committed) so that single-item regenerations
        // and partial resumes also find the correct predecessor.
        let previousEntity: { name: string; disambiguationQuery: string } | undefined;
        if (item.day) {
          const live = generatedItemsRef.current;
          const fullList = live.length > 0 ? live : itemsToProcess;
          let currentIdx = fullList.findIndex(p => p.id === item.id);
          if (currentIdx < 0) currentIdx = fullList.length;
          for (let j = currentIdx - 1; j >= 0; j--) {
            const candidate = fullList[j];
            if (candidate.day === item.day && candidate.id !== item.id) {
              previousEntity = {
                name: candidate.name,
                disambiguationQuery: candidate.disambiguationQuery || candidate.name,
              };
              break;
            }
          }
        }

        const result = await generateTravelContent({
          contentType: item.type,
          inputLanguage,
          outputLanguage,
          userInput: item.name,
          disambiguationQuery: item.disambiguationQuery || '',
          useRAG,
          documentContext: includeFullContext ? documentContext : '',
          documentImages: includeFullContext ? documentImages : [],
          tone: effectiveTone,
          socialPlatform: item.socialPlatform,
          talkingPoints: item.talkingPoints,
          day: item.day,
          previousEntity,
          onChunk: (text) => {
            setGeneratedItems(prev => prev.map(p => p.id === item.id ? { ...p, content: text } : p));
          }
        });
        
        setGeneratedItems(prev => prev.map(p => p.id === item.id ? { 
          ...p, 
          content: result.text,
          sources: Array.from(new Map(result.sources.map(s => [s.uri, s])).values()),
          status: 'completed'
        } : p));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred during generation.';
      setError(message);
      setGeneratedItems(prev => prev.map(p => p.status === 'generating' ? { ...p, status: 'error' } : p));
    } finally {
      setIsLoading(false);
      setGenerationProgress('');
    }
  }, [documentContext, documentImages, inputLanguage, outputLanguage, useRAG, includeFullContext, tone, customTone]);

  const handleConfirmGeneration = useCallback(async (finalItems: EditableEntity[]) => {
    setIsEditingEntities(false);
    if (finalItems.length === 0) {
      setError("No items were selected for generation.");
      setIsLoading(false);
      setIsAnalyzing(false);
      return;
    }

    setIsLoading(true);
    setIsAnalyzing(false);

    const initialItems: GeneratedItem[] = finalItems.map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      day: item.day,
      content: '',
      sources: [],
      status: 'pending',
      disambiguationQuery: item.disambiguationQuery,
      socialPlatform: item.socialPlatform,
      talkingPoints: item.talkingPoints,
    }));
    
    setGeneratedItems(initialItems);
    if (initialItems.length > 0) {
      setSelectedItemId(initialItems[0].id);
    }

    setLastAction(() => () => runGenerationLoop(initialItems));
    await runGenerationLoop(initialItems);
  }, [runGenerationLoop]);

  const handleResumeGeneration = useCallback(() => {
    const pendingItems = generatedItems.filter(i => i.status !== 'completed');
    if (pendingItems.length > 0) {
      setLastAction(() => () => runGenerationLoop(pendingItems));
      runGenerationLoop(pendingItems);
    }
  }, [generatedItems, runGenerationLoop]);

  const handleRegenerateItem = useCallback((id: string) => {
    const itemToRegenerate = generatedItems.find(i => i.id === id);
    if (itemToRegenerate) {
      setLastAction(() => () => runGenerationLoop([itemToRegenerate]));
      runGenerationLoop([itemToRegenerate]);
    }
  }, [generatedItems, runGenerationLoop]);

  const handleCancelEdit = () => {
    setIsEditingEntities(false);
    setEditableEntities([]);
    setIsLoading(false);
    setIsAnalyzing(false);
  };
  
  const handleItemContentChange = (itemId: string, newContent: string) => {
    setGeneratedItems(prevItems => 
        prevItems.map(item => 
            item.id === itemId ? { ...item, content: newContent } : item
        )
    );
  };

  const handleSavePreset = (name: string) => {
    if (!name.trim() || !contextSource) return;
    const newPreset: Preset = {
      id: crypto.randomUUID(),
      name: name.trim(),
      contextSource,
      documentContext,
      documentImages,
      createdAt: new Date().toISOString(),
    };
    const updatedPresets = [...presets, newPreset].sort((a, b) => a.name.localeCompare(b.name));
    setPresets(updatedPresets);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(updatedPresets));
  };

  const handleLoadPreset = (id: string) => {
    const presetToLoad = presets.find(p => p.id === id);
    if (presetToLoad) {
      setContextSource(presetToLoad.contextSource);
      setDocumentContext(presetToLoad.documentContext);
      setDocumentImages(presetToLoad.documentImages);
      setGeneratedItems([]);
      setSelectedItemId(null);
      setError(null);
    }
  };

  const handleDeletePreset = (id: string) => {
    const updatedPresets = presets.filter(p => p.id !== id);
    setPresets(updatedPresets);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(updatedPresets));
  };

  const handleRetry = useCallback(() => {
    if (lastAction) {
        setError(null);
        lastAction();
    }
  }, [lastAction]);

  return (
    <div className="h-screen bg-slate-900 text-slate-200 font-sans flex flex-col overflow-hidden">
      <header className="w-full p-4 border-b border-slate-700 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between flex-shrink-0">
        <div className="flex-1"></div>
        <div className="flex-1 text-center">
            <h1 className="text-2xl font-bold text-cyan-400">
            Travel Content AI Assistant
            </h1>
            <p className="text-slate-400 text-sm mt-1">
            Crafting culturally rich travel narratives with the power of AI
            </p>
        </div>
        <div className="flex-1 flex justify-end">
            <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 rounded-full text-slate-400 hover:bg-slate-700 hover:text-cyan-400 transition-colors"
                aria-label="Open settings"
            >
                <SettingsIcon className="w-6 h-6" />
            </button>
        </div>
      </header>
      
      <main className="flex-grow flex flex-col md:flex-row gap-4 p-4 lg:p-6 overflow-hidden min-h-0">
        <div className="md:w-1/3 lg:w-1/4 flex-shrink flex flex-col min-h-0 h-1/2 md:h-auto">
          <ControlPanel
            inputLanguage={inputLanguage}
            setInputLanguage={setInputLanguage}
            outputLanguage={outputLanguage}
            setOutputLanguage={setOutputLanguage}
            tone={tone}
            setTone={setTone}
            customTone={customTone}
            setCustomTone={setCustomTone}
            useRAG={useRAG}
            setUseRAG={setUseRAG}
            includeFullContext={includeFullContext}
            setIncludeFullContext={setIncludeFullContext}
            onGenerate={handleStartAnalysis}
            isLoading={isLoading || isEditingEntities}
            contextSource={contextSource}
            documentImages={documentImages}
            onFileSelected={handleFileSelected}
            onPaste={handlePaste}
            onContextRemove={handleContextRemove}
            onTextSubmit={handleTextContextSubmit}
            presets={presets}
            onSavePreset={handleSavePreset}
            onLoadPreset={handleLoadPreset}
            onDeletePreset={handleDeletePreset}
          />
        </div>
        <div className="flex-grow md:w-2/3 lg:w-3/4 min-h-0 flex flex-col">
          <ContentDisplay
            items={generatedItems}
            selectedItemId={selectedItemId}
            onSelectItem={setSelectedItemId}
            onItemContentChange={handleItemContentChange}
            isLoading={isLoading}
            error={error}
            isAnalyzing={isAnalyzing}
            generationProgress={generationProgress}
            outputLanguage={outputLanguage}
            onRetry={handleRetry}
            onResume={handleResumeGeneration}
            onRegenerate={handleRegenerateItem}
          />
        </div>
      </main>
      <footer className="w-full p-4 text-center text-slate-500 text-xs border-t border-slate-700">
        <p>this app made by Saksit Saelow</p>
      </footer>
      <EntityEditorModal
        isOpen={isEditingEntities}
        items={editableEntities}
        onConfirm={handleConfirmGeneration}
        onCancel={handleCancelEdit}
      />
      <SettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default App;