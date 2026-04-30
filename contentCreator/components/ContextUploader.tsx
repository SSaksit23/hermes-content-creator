
import React, { useRef, useState } from 'react';
import { UploadCloudIcon } from './icons/UploadCloudIcon';
import { ClipboardPasteIcon } from './icons/ClipboardPasteIcon';
import { XCircleIcon } from './icons/XCircleIcon';
import { FileTextIcon } from './icons/FileTextIcon';

interface ContextUploaderProps {
  contextSource: string | null;
  imagePreview: string | null;
  onFileSelected: (file: File) => void;
  onPaste: () => void;
  onRemove: () => void;
  onTextSubmit: (text: string) => void;
}

export const ContextUploader: React.FC<ContextUploaderProps> = ({
  contextSource,
  imagePreview,
  onFileSelected,
  onPaste,
  onRemove,
  onTextSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualText, setManualText] = useState('');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    // Reset file input to allow uploading the same file again
    if(fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleTextSubmit = () => {
    if (manualText.trim()) {
      onTextSubmit(manualText.trim());
      setManualText('');
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1">
        Provide Context
      </label>
      <div className="bg-slate-700/50 p-3 rounded-md border border-slate-600">
        {contextSource ? (
          <div className="flex items-center justify-between bg-slate-700 p-2 rounded-md">
            <div className="flex items-center gap-2 min-w-0">
               {imagePreview ? (
                <img src={imagePreview} alt="Context preview" className="w-10 h-10 object-cover rounded-md flex-shrink-0" />
              ) : (
                <FileTextIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
              )}
              <span className="text-sm text-slate-200 truncate" title={contextSource}>
                {contextSource}
              </span>
            </div>
            <button
              onClick={onRemove}
              className="p-1 rounded-full text-slate-400 hover:bg-slate-600 hover:text-slate-200 transition-colors"
              aria-label="Remove context source"
            >
              <XCircleIcon className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
                <div className="flex flex-col sm:flex-row gap-2">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept=".txt,.pdf,.docx,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                />
                <button
                    onClick={handleUploadClick}
                    className="w-full flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-500 text-slate-200 font-semibold py-2 px-3 rounded-md transition-colors text-sm"
                >
                    <UploadCloudIcon className="w-4 h-4" />
                    Upload File
                </button>
                <button
                    onClick={onPaste}
                    className="w-full flex items-center justify-center gap-2 bg-slate-600 hover:bg-slate-500 text-slate-200 font-semibold py-2 px-3 rounded-md transition-colors text-sm"
                >
                    <ClipboardPasteIcon className="w-4 h-4" />
                    Paste from Clipboard
                </button>
                </div>
                <p className="text-xs text-slate-400 text-center mt-2">
                    Supports .txt, .pdf, .docx, and image files.
                </p>
            </div>

            <div className="flex items-center">
              <hr className="flex-grow border-slate-600" />
              <span className="px-2 text-xs text-slate-500">OR</span>
              <hr className="flex-grow border-slate-600" />
            </div>

            <div>
                 <textarea
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition placeholder-slate-400 min-h-[80px] text-sm"
                    placeholder="Write or paste content directly here..."
                />
                <button
                    onClick={handleTextSubmit}
                    disabled={!manualText.trim()}
                    className="w-full mt-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:cursor-not-allowed disabled:text-slate-500 text-slate-200 font-semibold py-2 px-3 rounded-md transition-colors text-sm"
                >
                    Use Text Above as Context
                </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
