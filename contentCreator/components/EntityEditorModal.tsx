
import React, { useState, useEffect, useMemo } from 'react';
import type { EditableEntity } from '../types';
import { PlusCircleIcon } from './icons/PlusCircleIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ContentType } from '../types';

interface EntityEditorModalProps {
  isOpen: boolean;
  items: EditableEntity[];
  onConfirm: (updatedItems: EditableEntity[]) => void;
  onCancel: () => void;
}

const EntityItem: React.FC<{
    item: EditableEntity;
    onItemChange: (id: string, field: keyof EditableEntity, value: string) => void;
    onItemRemove: (id: string) => void;
}> = ({ item, onItemChange, onItemRemove }) => {
    const isSocial = item.type === ContentType.SOCIAL_MEDIA_POST;
    const socialPlatforms = ['Instagram', 'Twitter / X', 'Facebook', 'LinkedIn'];

    return (
        <div className="flex flex-col gap-1.5 p-3 bg-slate-700/50 rounded-md border border-slate-600/50">
            <div className="flex items-start gap-2">
                <div className="flex-grow space-y-2">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={item.name}
                            onChange={(e) => onItemChange(item.id, 'name', e.target.value)}
                            placeholder={isSocial ? "Post Topic" : "Entity Name"}
                            className="flex-grow bg-slate-700 border border-slate-600 rounded-md py-1.5 px-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                        <input
                            type="text"
                            value={item.day || ''}
                            onChange={(e) => onItemChange(item.id, 'day', e.target.value)}
                            placeholder="Day (e.g., 第一天)"
                            className="w-32 bg-slate-700 border border-slate-600 rounded-md py-1.5 px-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                        />
                    </div>
                    {isSocial && (
                        <select 
                            value={item.socialPlatform} 
                            onChange={(e) => onItemChange(item.id, 'socialPlatform', e.target.value)}
                            className="w-full bg-slate-600 border border-slate-500 rounded-md py-1.5 px-3 text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 text-sm"
                        >
                            {socialPlatforms.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    )}
                </div>
                <button onClick={() => onItemRemove(item.id)} className="p-1.5 text-slate-400 hover:text-red-400 rounded-md hover:bg-slate-600 transition-colors">
                    <TrashIcon className="w-5 h-5" />
                </button>
            </div>
            
            <div className="space-y-1.5 mt-1">
                {isSocial && (
                    <textarea
                        value={item.talkingPoints}
                        onChange={(e) => onItemChange(item.id, 'talkingPoints', e.target.value)}
                        placeholder="Key talking points..."
                        className="w-full bg-slate-600 border border-slate-500 rounded-md py-1 px-3 text-sm text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500 min-h-[60px]"
                    />
                )}
                <input
                    type="text"
                    value={item.disambiguationQuery}
                    onChange={(e) => onItemChange(item.id, 'disambiguationQuery', e.target.value)}
                    placeholder="Search query for Web Research"
                    className="w-full bg-slate-600 border border-slate-500 rounded-md py-1 px-3 text-sm text-slate-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
            </div>
        </div>
    );
};

export const EntityEditorModal: React.FC<EntityEditorModalProps> = ({ isOpen, items, onConfirm, onCancel }) => {
  const [editableItems, setEditableItems] = useState<EditableEntity[]>([]);

  useEffect(() => {
    if (isOpen) {
      setEditableItems(items);
    }
  }, [isOpen, items]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, EditableEntity[]> = {};
    editableItems.forEach(item => {
      const day = item.day || 'General / Unscheduled';
      if (!groups[day]) groups[day] = [];
      groups[day].push(item);
    });
    return groups;
  }, [editableItems]);

  if (!isOpen) return null;

  const handleItemChange = (id: string, field: keyof EditableEntity, value: string) => {
    setEditableItems(currentItems =>
      currentItems.map(item => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleItemRemove = (id: string) => {
    setEditableItems(currentItems => currentItems.filter(item => item.id !== id));
  };
  
  const handleItemAdd = (type: ContentType, day?: string) => {
    const newItem: EditableEntity = {
      id: crypto.randomUUID(),
      name: '',
      type,
      day: day || '',
      disambiguationQuery: '',
      ...(type === ContentType.SOCIAL_MEDIA_POST && {
          socialPlatform: 'Instagram',
          talkingPoints: ''
      })
    };
    setEditableItems(currentItems => [...currentItems, newItem]);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-800 rounded-lg shadow-2xl p-6 w-full max-w-3xl border border-slate-600 flex flex-col gap-4 max-h-[90vh]">
        <header>
            <h2 className="text-xl font-bold text-cyan-400">Review Itinerary Items</h2>
            <p className="text-sm text-slate-400">Items identified from your document. You can adjust the days and details before generating content.</p>
        </header>
        
        <div className="flex-grow overflow-y-auto pr-2 space-y-6">
            {/* Fixed type inference for Object.entries */}
            {(Object.entries(groupedItems) as [string, EditableEntity[]][]).map(([day, items]) => (
                <section key={day} className="space-y-3">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider border-b border-slate-700 pb-1 flex items-center justify-between">
                        <span>{day}</span>
                        <span className="text-xs font-normal lowercase">{items.length} items</span>
                    </h3>
                    <div className="space-y-3">
                        {items.map(item => (
                            <EntityItem 
                                key={item.id} 
                                item={item} 
                                onItemChange={handleItemChange} 
                                onItemRemove={handleItemRemove} 
                            />
                        ))}
                    </div>
                    <div className="flex gap-4 px-1">
                        <button onClick={() => handleItemAdd(ContentType.ATTRACTION, day !== 'General / Unscheduled' ? day : undefined)} className="text-xs text-cyan-500 hover:text-cyan-400 flex items-center gap-1">
                            <PlusCircleIcon className="w-4 h-4" /> Add Attraction
                        </button>
                        <button onClick={() => handleItemAdd(ContentType.MEAL_DESCRIPTION, day !== 'General / Unscheduled' ? day : undefined)} className="text-xs text-cyan-500 hover:text-cyan-400 flex items-center gap-1">
                            <PlusCircleIcon className="w-4 h-4" /> Add Meal
                        </button>
                        <button onClick={() => handleItemAdd(ContentType.SOCIAL_MEDIA_POST, day !== 'General / Unscheduled' ? day : undefined)} className="text-xs text-cyan-500 hover:text-cyan-400 flex items-center gap-1">
                            <PlusCircleIcon className="w-4 h-4" /> Add Social Post
                        </button>
                    </div>
                </section>
            ))}
            
            {Object.keys(groupedItems).length === 0 && (
                <div className="text-center py-10 text-slate-500">
                    <p>No items found. Add some items manually above or check your document.</p>
                </div>
            )}
        </div>

        <div className="flex justify-end gap-3 mt-4 border-t border-slate-700 pt-4 flex-shrink-0">
          <button onClick={onCancel} className="bg-slate-600 hover:bg-slate-500 text-slate-200 font-bold py-2 px-4 rounded-md transition-colors">
            Cancel
          </button>
          <button onClick={() => onConfirm(editableItems.filter(i => i.name.trim()))} className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 px-4 rounded-md transition-colors">
            Confirm & Generate
          </button>
        </div>
      </div>
    </div>
  );
};
