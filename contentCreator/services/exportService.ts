
import { Packer, Document, Paragraph, HeadingLevel, TextRun, ExternalHyperlink } from 'docx';
import type { GeneratedItem } from '../types';

const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const sanitizeFilename = (name: string): string => {
    return name.replace(/[\s\\/:"*?<>|]+/g, '_');
};

const groupItemsByDay = (items: GeneratedItem[]): Record<string, GeneratedItem[]> => {
    const groups: Record<string, GeneratedItem[]> = {};
    items.forEach(item => {
        const day = item.day || 'General';
        if (!groups[day]) groups[day] = [];
        groups[day].push(item);
    });
    return groups;
};


export const exportAsTxt = (item: GeneratedItem) => {
    const filename = `${sanitizeFilename(item.name)}_${sanitizeFilename(item.type)}.txt`;
    const blob = new Blob([item.content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, filename);
};

export const exportAsMarkdown = (item: GeneratedItem) => {
    const filename = `${sanitizeFilename(item.name)}_${sanitizeFilename(item.type)}.md`;
    let markdownContent = `# ${item.name}\n\n`;
    if (item.day) markdownContent += `**Day:** ${item.day}\n\n`;
    markdownContent += `**Type:** ${item.type}\n\n`;
    markdownContent += `${item.content}\n\n`;

    if (item.sources && item.sources.length > 0) {
        markdownContent += `## Sources\n\n`;
        item.sources.forEach(source => {
            markdownContent += `- [${source.title || source.uri}](${source.uri})\n`;
        });
    }

    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(blob, filename);
};

export const exportAsDocx = async (item: GeneratedItem) => {
    const filename = `${sanitizeFilename(item.name)}_${sanitizeFilename(item.type)}.docx`;
    
    const paragraphs = item.content.split('\n').filter(p => p.trim() !== '').map(p => new Paragraph({ children: [new TextRun(p)] }));
    
    const sourceChildren: Paragraph[] = [];
    if (item.sources && item.sources.length > 0) {
        sourceChildren.push(new Paragraph({
            children: [new TextRun({ text: "Sources", bold: true })],
            spacing: { before: 400, after: 200 },
        }));
        item.sources.forEach(source => {
             sourceChildren.push(new Paragraph({
                children: [
                    new ExternalHyperlink({
                        children: [
                            new TextRun({
                                text: source.title || source.uri,
                                style: "Hyperlink",
                            }),
                        ],
                        link: source.uri,
                    }),
                ],
                bullet: {
                    level: 0,
                },
            }));
        });
    }

    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                new Paragraph({
                    text: item.name,
                    heading: HeadingLevel.HEADING_1,
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: item.type, italics: true }),
                        ...(item.day ? [new TextRun({ text: ` | ${item.day}`, bold: true })] : [])
                    ],
                    spacing: { after: 400 },
                }),
                ...paragraphs,
                ...sourceChildren
            ],
        }],
    });

    const blob = await Packer.toBlob(doc);
    triggerDownload(blob, filename);
};

export const exportAllAsTxt = (items: GeneratedItem[]) => {
    const filename = `Itinerary_Content_Full.txt`;
    const groups = groupItemsByDay(items);
    
    let content = `TRAVEL ITINERARY CONTENT\n==========================\n\n`;
    
    Object.entries(groups).forEach(([day, dayItems]) => {
        content += `\n[ ${day.toUpperCase()} ]\n`;
        content += `----------------------------------------\n`;
        dayItems.forEach(item => {
            content += `\nNAME: ${item.name}\nTYPE: ${item.type}\n\n${item.content}\n\n`;
        });
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, filename);
};

export const exportAllAsMarkdown = (items: GeneratedItem[]) => {
    const filename = `Itinerary_Content_Full.md`;
    const groups = groupItemsByDay(items);
    
    let content = `# Travel Itinerary Content\n\n`;
    
    Object.entries(groups).forEach(([day, dayItems]) => {
        content += `\n## ${day}\n\n`;
        dayItems.forEach(item => {
            content += `### ${item.name}\n`;
            content += `*Type: ${item.type}*\n\n`;
            content += `${item.content}\n\n`;
            if (item.sources && item.sources.length > 0) {
                content += `**Sources:**\n`;
                item.sources.forEach(s => content += `- [${s.title || s.uri}](${s.uri})\n`);
                content += `\n`;
            }
        });
        content += `\n---\n`;
    });

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(blob, filename);
};

export const exportAllAsDocx = async (items: GeneratedItem[]) => {
    const filename = `Itinerary_Content_Full.docx`;
    const groups = groupItemsByDay(items);
    const children: Paragraph[] = [];

    Object.entries(groups).forEach(([day, dayItems], dayIndex) => {
        children.push(new Paragraph({
            text: day,
            heading: HeadingLevel.HEADING_1,
            pageBreakBefore: dayIndex > 0,
        }));

        dayItems.forEach(item => {
            children.push(new Paragraph({
                text: item.name,
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 400 },
            }));
            children.push(new Paragraph({
                children: [new TextRun({ text: item.type, italics: true })],
                spacing: { after: 200 },
            }));

            item.content.split('\n').filter(p => p.trim() !== '').forEach(p => {
                children.push(new Paragraph({ children: [new TextRun(p)] }));
            });

            if (item.sources && item.sources.length > 0) {
                children.push(new Paragraph({
                    children: [new TextRun({ text: "Sources", bold: true })],
                    spacing: { before: 200, after: 100 },
                }));
                item.sources.forEach(source => {
                    children.push(new Paragraph({
                        children: [
                            new ExternalHyperlink({
                                children: [new TextRun({ text: source.title || source.uri, style: "Hyperlink" })],
                                link: source.uri,
                            }),
                        ],
                        bullet: { level: 0 },
                    }));
                });
            }
        });
    });

    const doc = new Document({
        sections: [{
            properties: {},
            children: children,
        }],
    });

    const blob = await Packer.toBlob(doc);
    triggerDownload(blob, filename);
};