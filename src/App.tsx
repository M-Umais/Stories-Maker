import React, { useState, useRef, useCallback, useEffect } from 'react';
import { 
  User, 
  Type, 
  Image as ImageIcon, 
  Layout, 
  Download, 
  PlusCircle, 
  RotateCcw, 
  Save, 
  ChevronDown,
  Upload,
  Zap,
  X,
  Play,
  Film,
  Loader2,
  MoveRight,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
// import { toPng, toCanvas } from 'html-to-image';
import { cn } from './lib/utils';
import { TEMPLATE_PRESETS, TemplatePreset } from './constants';

type TabType = 'profile' | 'typography' | 'background' | 'footer';

// Helper to highlight random words
const getRandomHighlights = (text: string) => {
  const parts = text.split(/(\s+)/);
  const wordIndices: number[] = [];
  
  parts.forEach((part, i) => {
    // If it's not pure whitespace, it's a word
    if (part.trim().length > 0) {
      wordIndices.push(i);
    }
  });

  if (wordIndices.length < 3) return text;
  
  // Pick about 15-20% of words for highlighting, capping at exactly 8 max
  const targetCount = Math.min(8, Math.max(3, Math.floor(wordIndices.length * 0.15)));
  const highlightIndices = new Set<number>();
  
  // Safety break to prevent infinite loop
  let attempts = 0;
  while (highlightIndices.size < targetCount && attempts < 100) {
    const randomIndex = Math.floor(Math.random() * wordIndices.length);
    highlightIndices.add(wordIndices[randomIndex]);
    attempts++;
  }
  
  return parts.map((part, i) => highlightIndices.has(i) ? `[${part}]` : part).join('');
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [selectedPresetId, setSelectedPresetId] = useState(TEMPLATE_PRESETS[1].id);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportDuration, setExportDuration] = useState(31);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  
  // Bulk Mode State
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  
  // Profile State
  const [profileImage, setProfileImage] = useState('https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400&h=400');
  const [posterName, setPosterName] = useState('Buried Bell');
  const [subtitle, setSubtitle] = useState('Will It Ring Again?');
  const [nameSize, setNameSize] = useState(82);
  const [nameColor, setNameColor] = useState('#2D0D44');
  const [nameHasBg, setNameHasBg] = useState(false);
  const [subtitleSize, setSubtitleSize] = useState(44);
  const [subtitleColor, setSubtitleColor] = useState('#8148B0');
  const [subtitleHasBg, setSubtitleHasBg] = useState(false);
  const [avatarBorder, setAvatarBorder] = useState(true);
  const [avatarBorderColor, setAvatarBorderColor] = useState('#FFFFFF');
  const [nameFont, setNameFont] = useState('font-merriweather');
  const [subFont, setSubFont] = useState('font-merriweather');
  const [scribbleStyle, setScribbleStyle] = useState('none');
  
  // Typography State
  const [storyText, setStoryText] = useState('Aitah For Telling My Brother His [Girlfriend] Is Not Allowed In My House [Again?] I haven\'t seen my brother in [5 years] due to both of us being in the military. He finally came to [visit] with his [girlfriend] that he\'s been with for [3 years.] His [visit] it already cut from 2 weeks to 4 days because she has to go back to [work.] They also brought their dog, but [forgot] the kennel, so I...');
  const [highlightColor, setHighlightColor] = useState('#150621');
  const [textColor, setTextColor] = useState('#150621');
  const [fontFamily, setFontFamily] = useState('font-serif');
  const [fontStyle, setFontStyle] = useState('normal');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [fontSize, setFontSize] = useState(62);
  const [fontWeight, setFontWeight] = useState('700');
  const [lineHeight, setLineHeight] = useState(1.25);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [highlightUnderline, setHighlightUnderline] = useState(false);

  // Background State
  const [bgStyle, setBgStyle] = useState<'solid' | 'gradient' | 'image'>('solid');
  const [bgColor, setBgColor] = useState('#CEADE1');
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgImageOverlay, setBgImageOverlay] = useState(20);
  const [cardColor, setCardColor] = useState('#FAF2FB');
  const [gradEnd, setGradEnd] = useState('#FF6347');
  const [cardRadius, setCardRadius] = useState(36);
  const [cardPadding, setCardPadding] = useState(60);
  const [cardTransparency, setCardTransparency] = useState(100);
  const [showCard, setShowCard] = useState(true);

  // Footer State
  const [showFooter, setShowFooter] = useState(true);
  const [footerText, setFooterText] = useState("CONTINUE READING IN COMMENT");
  const [footerBgColor, setFooterBgColor] = useState('#ffffff');
  const [footerBgStyle, setFooterBgStyle] = useState<'none' | 'text' | 'card' | 'fill'>('text');
  const [footerTextColor, setFooterTextColor] = useState('#150621');
  const [footerFont, setFooterFont] = useState('font-merriweather');
  const [footerFontSize, setFooterFontSize] = useState(32);
  const [footerBorderWidth, setFooterBorderWidth] = useState(0);
  const [footerBorderColor, setFooterBorderColor] = useState('#000000');

  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bgFileInputRef = useRef<HTMLInputElement>(null);

  const handleReset = () => {
    applyPreset(TEMPLATE_PRESETS[1].id);
    setProfileImage('https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400&h=400');
    setPosterName('Buried Bell');
    setSubtitle('Will It Ring Again?');
    setStoryText('Aitah For Telling My Brother His [Girlfriend] Is Not Allowed In My House [Again?] I haven\'t seen my brother in [5 years] due to both of us being in the military. He finally came to [visit] with his [girlfriend] that he\'s been with for [3 years.] His [visit] it already cut from 2 weeks to 4 days because she has to go back to [work.] They also brought their dog, but [forgot] the kennel, so I...');
    setFooterText("CONTINUE READING IN COMMENT");
    setNameSize(82);
    setSubtitleSize(44);
    setFontSize(62);
    setFontWeight('700');
    setFooterFontSize(32);
    setFooterBorderWidth(0);
    setFooterBorderColor('#000000');
    setCardRadius(36);
    setCardPadding(60);
    setCardTransparency(100);
    setScribbleStyle('none');
    setFooterBgStyle('text');
    setFooterBgColor('#ffffff');
    setBgColor('#CEADE1');
    setBgStyle('solid');
    setCardColor('#FAF2FB');
    setNameColor('#2D0D44');
    setSubtitleColor('#8148B0');
    setTextColor('#150621');
    setHighlightColor('#150621');
    setFooterTextColor('#150621');
    setAvatarBorder(true);
    setAvatarBorderColor('#ffffff');
    setLineHeight(1.25);
    setShowCard(true);
  };

  const handleNewPoster = () => {
    setPosterName('');
    setSubtitle('');
    setStoryText('');
    setFooterText('CONTINUE READING IN COMMENT');
    const randomPreset = TEMPLATE_PRESETS[Math.floor(Math.random() * TEMPLATE_PRESETS.length)];
    applyPreset(randomPreset.id);
  };

  const applyPreset = (presetId: string) => {
    const preset = TEMPLATE_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    setSelectedPresetId(presetId);
    setBgStyle(preset.bgConfig.style);
    setBgColor(preset.bgConfig.bgColor);
    setGradEnd(preset.bgConfig.gradEnd);
    setCardColor(preset.bgConfig.cardColor);
    setTextColor(preset.typography.textColor);
    setHighlightColor(preset.typography.highlightColor);
    setFontFamily(preset.typography.fontFamily);
    setNameColor(preset.typography.textColor);
    setSubtitleColor(preset.typography.highlightColor);
    setFooterTextColor(preset.typography.textColor);
    setNameFont(preset.typography.fontFamily);
    setSubFont(preset.typography.fontFamily);
    setFooterFont(preset.typography.fontFamily);
    setScribbleStyle('none');
    setFooterBgStyle('none');
    setFooterBgColor('#ffffff');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setProfileImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setBgImage(event.target.result as string);
          setBgStyle('image');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDownload = useCallback(async (type: 'image' | 'video' = 'image') => {
    if (previewRef.current === null) return;
    const node = previewRef.current;
    
    setIsExporting(true);
    
    const { toPng, toCanvas } = await import('html-to-image');
    
    if (type === 'image') {
      setTimeout(() => {
        toPng(node, { 
          cacheBust: true,
          pixelRatio: 2,
          style: {
            transform: 'scale(1)',
          }
        })
        .then((dataUrl) => {
          const link = document.createElement('a');
          link.download = `story-image-${Date.now()}.png`;
          link.href = dataUrl;
          link.click();
          
          setTimeout(() => {
            setIsExporting(false);
            setIsExportModalOpen(false);
          }, 500);
        })
        .catch((err) => {
          console.error('Download failed', err);
          setIsExporting(false);
        });
      }, 500);
    } else {
      // Video Export (Recording capture)
      setExportProgress(0);
      
      toCanvas(node, { 
        pixelRatio: 1, // Using 1x for video stability/performance
        cacheBust: true,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          width: '1080px',
          height: '1920px'
        }
      })
        .then((canvas) => {
          const stream = canvas.captureStream(30); // 30 FPS
          
          let mimeType = 'video/webm;codecs=vp9';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
              mimeType = 'video/mp4'; // fallback
            }
          }

          const mediaRecorder = new MediaRecorder(stream, { mimeType });
          const chunks: Blob[] = [];
          
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          
          mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
            link.href = url;
            link.download = `story-video-${Date.now()}.${extension}`;
            link.click();
            
            setExportProgress(0);
            setIsExporting(false);
            setIsExportModalOpen(false);
          };
          
          mediaRecorder.start();
          
          // Ensure frames are produced for the duration even if static
          const ctx = canvas.getContext('2d');
          const startTime = Date.now();
          const totalMs = exportDuration * 1000;
          
          const intervalId = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(100, Math.floor((elapsed / totalMs) * 100));
            setExportProgress(progress);
            
            // Force frame update
            if (ctx) {
              const pixel = ctx.getImageData(0, 0, 1, 1);
              ctx.putImageData(pixel, 0, 0);
            }
            
            if (elapsed >= totalMs) {
              clearInterval(intervalId);
              mediaRecorder.stop();
            }
          }, 100);
        })
        .catch((err) => {
          console.error('Video export failed', err);
          setIsExporting(false);
          setExportProgress(0);
        });
    }
  }, [previewRef, exportDuration]);
  
  const handleRandomHighlight = () => {
    if (isBulkMode) {
      const stories = bulkInput.split('\n\n').filter(s => s.trim().length > 0);
      const highlighted = stories.map(s => getRandomHighlights(s.replace(/\[|\]/g, ''))).join('\n\n');
      setBulkInput(highlighted);
    } else {
      const cleanText = storyText.replace(/\[|\]/g, '');
      setStoryText(getRandomHighlights(cleanText));
    }
  };

  const renderStoryText = (text: string) => {
    const parts = text.split(/(\[.*?\])/);
    return parts.map((part, index) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        const content = part.slice(1, -1);
        return (
          <span 
            key={index} 
            style={{ color: highlightColor }} 
            className={cn("font-bold decoration-2 underline-offset-4", highlightUnderline ? "underline" : "")}
          >
            {content}
          </span>
        );
      }
      return part;
    });
  };

  const fonts = [
    { label: 'Roboto', value: 'font-roboto' },
    { label: 'Open Sans', value: 'font-open-sans' },
    { label: 'Lato', value: 'font-lato' },
    { label: 'Source Sans 3', value: 'font-source-sans' },
    { label: 'Nunito', value: 'font-nunito' },
    { label: 'Poppins', value: 'font-poppins' },
    { label: 'DM Sans', value: 'font-dm-sans' },
    { label: 'Work Sans', value: 'font-work-sans' },
    { label: 'Merriweather', value: 'font-merriweather' },
    { label: 'Georgia', value: 'font-georgia' },
    { label: 'Lora', value: 'font-lora' },
    { label: 'EB Garamond', value: 'font-garamond' },
    { label: 'Libre Baskerville', value: 'font-baskerville' },
    { label: 'Crimson Text', value: 'font-crimson' },
    { label: 'PT Serif', value: 'font-pt-serif' },
    { label: 'Playfair Display', value: 'font-playfair' },
  ];

  // Map through stories for bulk mode, else single
  const storiesToRender = isBulkMode 
    ? bulkInput.split('\n\n').filter(s => s.trim().length > 0).slice(0, 10)
    : [storyText];

  const posterProps = {
    bgStyle, bgColor, gradEnd, avatarBorder, avatarBorderColor, profileImage, 
    scribbleStyle, nameFont, nameHasBg, nameSize, nameColor, posterName, 
    subFont, subtitleHasBg, subtitleSize, subtitleColor, subtitle, 
    cardColor, cardTransparency, cardRadius, cardPadding, fontFamily, 
    fontSize, fontWeight, textColor, textAlign, lineHeight, letterSpacing, fontStyle, 
    showFooter, footerFont, footerBgStyle, footerBgColor, footerTextColor, 
    footerFontSize, footerText, renderStoryText, showCard, footerBorderWidth, footerBorderColor,
    bgImage, bgImageOverlay
  };

  return (
    <div className="flex h-screen bg-[#0f1115] text-white font-sans overflow-hidden">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImageUpload} 
        className="hidden" 
        accept="image/*"
      />

      {/* Hidden BG Image Input */}
      <input 
        type="file" 
        ref={bgFileInputRef} 
        onChange={handleBgImageUpload} 
        className="hidden" 
        accept="image/*"
      />

      {/* Export Modal */}
      <AnimatePresence>
        {isExportModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-[#161a20] rounded-xl border border-[#2a2d35] shadow-2xl overflow-hidden text-left"
            >
              <div className="flex items-center justify-between p-4 border-b border-[#2a2d35]">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-white text-black text-[10px] font-bold flex items-center justify-center rounded">V</div>
                  <h2 className="text-sm font-bold tracking-tight">Export Story</h2>
                </div>
                <button onClick={() => setIsExportModalOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>

                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="text-xl font-bold mb-1">Export Story</h3>
                    <p className="text-sm text-gray-400">Choose your download format</p>
                  </div>

                  {/* PNG Option */}
                  <div 
                    onClick={() => !isExporting && handleDownload('image')}
                    className={cn(
                      "flex items-center gap-4 p-4 rounded-xl border border-[#2a2d35] bg-[#1c2229] hover:bg-[#252c36] cursor-pointer transition-all group text-left",
                      isExporting && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="w-12 h-12 rounded-lg bg-[#2a2d35] flex items-center justify-center group-hover:bg-[#353941]">
                      {isExporting ? <Loader2 size={24} className="text-blue-400 animate-spin" /> : <ImageIcon size={24} className="text-blue-400" />}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold">Image (PNG)</h4>
                      <p className="text-xs text-gray-500">Single 1080p Full HD photo</p>
                    </div>
                  </div>

                  {/* Video Option */}
                  <div 
                    onClick={() => !isExporting && handleDownload('video')}
                    className={cn(
                      "p-4 rounded-xl border relative overflow-hidden",
                      isExporting ? "border-blue-500/50 bg-[#1c2229]" : "border-[#3b82f6]/40 bg-[#1c2229] ring-2 ring-blue-500/10 cursor-pointer hover:bg-[#252c36] group transition-all"
                    )}
                  >
                    {isExporting && (
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${exportProgress}%` }}
                        className="absolute bottom-0 left-0 h-1 bg-blue-500 transition-all duration-300"
                      />
                    )}
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20">
                        {isExporting ? <Loader2 size={24} className="text-blue-400 animate-spin" /> : <Film size={24} className="text-blue-400" />}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold">Video (silent · same image)</h4>
                        {isExporting && <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mt-0.5">Recording... {exportProgress}%</p>}
                      </div>
                    </div>

                    <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between items-center text-xs font-medium">
                      <span className="text-gray-400">Duration</span>
                      <span className="text-blue-400 font-mono">{exportDuration}s</span>
                    </div>
                    <input 
                      type="range" 
                      min="5" 
                      max="90" 
                      value={exportDuration} 
                      onChange={(e) => setExportDuration(parseInt(e.target.value))}
                      disabled={isExporting}
                      className="w-full accent-blue-500" 
                    />
                    <div className="flex justify-between text-[10px] text-gray-500 font-medium">
                      <span>5s</span>
                      <span>1m 30s</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => !isExporting && handleDownload('video')}
                  disabled={isExporting}
                  className="w-full flex items-center justify-center gap-2 bg-[#8ab4f8] hover:bg-[#a1c2fa] text-black font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  {isExporting ? `Exporting (${exportProgress}%)...` : 'Export Video'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sidebar Editor */}
      <div className="w-96 flex flex-col border-r border-[#2a2d35] bg-[#1a1d23]">
        {/* Header App Info */}
        <div className="p-4 border-b border-[#2a2d35]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Story Maker</h1>
              <p className="text-xs text-gray-400">Design beautiful text stories with live preview.</p>
            </div>
            <div className="bg-[#2a2d35] px-2 py-1 rounded text-[10px] text-blue-400 font-mono">
              Editing: Poster1
            </div>
          </div>
          
          <div className="flex mt-4 gap-2">
            <button 
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-1 bg-[#2a2d35] hover:bg-[#353941] text-xs py-2 rounded transition-colors"
            >
              <RotateCcw size={14} /> Reset
            </button>
            <button 
              onClick={handleNewPoster}
              className="flex-1 flex items-center justify-center gap-1 bg-[#2a2d35] hover:bg-[#353941] text-xs py-2 rounded transition-colors"
            >
              <PlusCircle size={14} /> New Poster
            </button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex p-2 gap-1 bg-[#14161b]">
          {( [
            { id: 'profile', icon: User },
            { id: 'typography', icon: Type },
            { id: 'background', icon: ImageIcon },
            { id: 'footer', icon: Layout },
          ] as const ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={cn(
                "flex-1 flex items-center justify-center py-2 rounded transition-all",
                activeTab === tab.id 
                  ? "bg-[#3b82f6] text-white shadow-lg" 
                  : "text-gray-500 hover:bg-[#2a2d35] hover:text-gray-300"
              )}
            >
              <tab.icon size={20} />
            </button>
          ))}
        </div>

        {/* Editor Controls */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <AnimatePresence mode="wait">
            {activeTab === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                {/* Template Preset */}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold block mb-2">Template Preset</label>
                  <div className="relative group">
                    <select 
                      value={selectedPresetId}
                      onChange={(e) => applyPreset(e.target.value)}
                      className="w-full bg-[#1c2229] border border-[#2a2d35] rounded-xl px-4 py-3 text-sm appearance-none outline-none focus:border-blue-500/50 transition-all hover:bg-[#212830] cursor-pointer text-gray-300"
                    >
                      {['Bold', 'Minimal', 'Warm', 'Cool', 'Dark'].map((category) => {
                        const categoryPresets = TEMPLATE_PRESETS.filter(p => p.category === category);
                        if (categoryPresets.length === 0) return null;
                        
                        return (
                          <optgroup key={category} label={category.toUpperCase()} className="bg-[#1c2229] text-gray-500 font-bold">
                            {categoryPresets.map((preset) => (
                              <option key={preset.id} value={preset.id} className="text-gray-200 py-2">
                                {preset.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                    <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none group-focus-within:text-blue-500 transition-colors" />
                  </div>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2">
                  PROFILE INFO
                </div>

                {/* Profile Image */}
                <div>
                  <label className="text-xs text-gray-400 block mb-2">Profile Image</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-1 bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-xs hover:bg-[#353941]"
                    >
                      <Upload size={14} /> CHOOSE FILE
                    </button>
                    <div className="flex-1 flex items-center gap-2 bg-[#2a2d35] border border-[#353941] rounded px-2 py-1 overflow-hidden">
                      <Zap size={14} className="text-blue-400 flex-shrink-0" />
                      <span className="text-[10px] text-gray-400 truncate">{profileImage.includes('base64') ? 'uploaded_image' : profileImage.split('/').pop()}</span>
                    </div>
                  </div>
                </div>

                {/* Poster Name & Subtitle */}
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs text-gray-400">Poster Name / Title</label>
                      <Zap size={12} className="text-blue-400" />
                    </div>
                    <input 
                      type="text" 
                      value={posterName}
                      onChange={(e) => setPosterName(e.target.value)}
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Subtitle</label>
                    <input 
                      type="text" 
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2">
                  NAME STYLE
                </div>

                {/* Name Styling */}
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Font Family</label>
                    <select 
                      value={nameFont}
                      onChange={(e) => setNameFont(e.target.value)}
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none font-serif"
                    >
                      {fonts.map(f => (<option key={f.value} value={f.value} className={f.value}>{f.label}</option>))}
                    </select>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Name / Title Size</span>
                      <span>{nameSize} px</span>
                    </div>
                    <input type="range" min="20" max="150" value={nameSize} onChange={(e) => setNameSize(parseInt(e.target.value))} className="w-full" />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1">Name Color</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={nameColor} onChange={(e) => setNameColor(e.target.value)} className="w-8 h-8 rounded border-none cursor-pointer bg-transparent" />
                        <div className="w-full h-8 rounded border border-[#353941]" style={{ backgroundColor: nameColor }}></div>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1 opacity-0">BG Toggle</label>
                      <div className="flex items-center gap-2 pt-1">
                        <div 
                          onClick={() => setNameHasBg(!nameHasBg)}
                          className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", nameHasBg ? "bg-blue-500" : "bg-[#2a2d35]")}
                        >
                          <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", nameHasBg ? "left-6" : "left-1")}></div>
                        </div>
                        <span className="text-xs text-gray-400">Name BG</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2">
                  SUBTITLE STYLE
                </div>

                {/* Subtitle Styling */}
                <div className="space-y-4">
                  <div>
                     <label className="text-xs text-gray-400 block mb-1">Font Family</label>
                      <select 
                        value={subFont}
                        onChange={(e) => setSubFont(e.target.value)}
                        className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none mb-3 font-serif"
                      >
                        {fonts.map(f => (<option key={f.value} value={f.value} className={f.value}>{f.label}</option>))}
                      </select>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Subtitle Size</span>
                      <span>{subtitleSize} px</span>
                    </div>
                    <input type="range" min="10" max="100" value={subtitleSize} onChange={(e) => setSubtitleSize(parseInt(e.target.value))} className="w-full" />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1">Sub Color</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={subtitleColor} onChange={(e) => setSubtitleColor(e.target.value)} className="w-8 h-8 rounded border-none cursor-pointer bg-transparent" />
                        <div className="w-full h-8 rounded border border-[#353941]" style={{ backgroundColor: subtitleColor }}></div>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1 opacity-0">BG Toggle</label>
                      <div className="flex items-center gap-2 pt-1">
                        <div 
                          onClick={() => setSubtitleHasBg(!subtitleHasBg)}
                          className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", subtitleHasBg ? "bg-blue-500" : "bg-[#2a2d35]")}
                        >
                          <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", subtitleHasBg ? "left-6" : "left-1")}></div>
                        </div>
                        <span className="text-xs text-gray-400">Sub BG</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2">
                  AVATAR
                </div>

                <div>
                   <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        onClick={() => setAvatarBorder(!avatarBorder)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", avatarBorder ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", avatarBorder ? "left-6" : "left-1")}></div>
                      </div>
                      <span className="text-xs text-gray-400">Avatar Border</span>
                    </div>
                    <input type="color" value={avatarBorderColor} onChange={(e) => setAvatarBorderColor(e.target.value)} className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border border-[#353941]" />
                  </div>
                </div>

                <div>
                   <label className="text-xs text-gray-400 block mb-1">Scribble Style</label>
                   <select 
                     value={scribbleStyle}
                     onChange={(e) => setScribbleStyle(e.target.value)}
                     className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                   >
                     <option value="none">None</option>
                     <option value="blur">Blur</option>
                     <option value="squiggle">Squiggle (wavy)</option>
                     <option value="solid">Solid bar</option>
                     <option value="mosaic">Mosaic</option>
                   </select>
                </div>
              </motion.div>
            )}

            {activeTab === 'typography' && (
              <motion.div
                key="typography"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">Highlight Color</label>
                    <input type="color" value={highlightColor} onChange={(e) => setHighlightColor(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">Text Color</label>
                    <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" />
                  </div>
                </div>

                <div className="grid grid-cols-1">
                  <button 
                    onClick={handleRandomHighlight}
                    className="w-full flex items-center justify-center gap-2 bg-[#8ab4f8] hover:bg-[#a1c2fa] text-black font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-[0.98] mt-2"
                  >
                    <Zap size={16} /> HIGHLIGHT TEXT
                  </button>
                  <p className="text-[10px] text-gray-500 text-center mt-2 italic px-4">Click to randomly highlight parts of your story with the selected style.</p>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  MODE SELECTION
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Bulk Mode (up to 10)</span>
                  <div 
                    onClick={() => setIsBulkMode(!isBulkMode)}
                    className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", isBulkMode ? "bg-blue-500" : "bg-[#2a2d35]")}
                  >
                    <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", isBulkMode ? "left-6" : "left-1")}></div>
                  </div>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  TYPOGRAPHY
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-gray-400">{isBulkMode ? 'Bulk Stories (Double line break between stories)' : 'Story Content'}</label>
                    <button 
                      onClick={handleRandomHighlight}
                      className="flex items-center gap-1.5 px-2 py-1 bg-[#2a2d35] hover:bg-[#353941] rounded text-[10px] text-blue-400 hover:text-blue-300 transition-all font-bold"
                    >
                      <Zap size={10} /> RANDOM HIGHLIGHT
                    </button>
                  </div>
                  {isBulkMode ? (
                    <textarea 
                      value={bulkInput}
                      onChange={(e) => setBulkInput(e.target.value)}
                      rows={10}
                      placeholder="Story 1&#10;&#10;Story 2..."
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none font-mono"
                    />
                  ) : (
                    <textarea 
                      value={storyText}
                      onChange={(e) => setStoryText(e.target.value)}
                      rows={6}
                      placeholder="Type your story here."
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none"
                    />
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Font Family</label>
                  <select 
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none font-serif"
                  >
                    {fonts.map(f => (<option key={f.value} value={f.value} className={f.value}>{f.label}</option>))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div>
                    <label className="text-xs text-gray-400 block mb-1">Style</label>
                    <select 
                      value={fontStyle}
                      onChange={(e) => setFontStyle(e.target.value)}
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none"
                    >
                      <option value="normal">Normal</option>
                      <option value="italic">Italic</option>
                    </select>
                  </div>
                   <div>
                    <label className="text-xs text-gray-400 block mb-1">Weight</label>
                    <select 
                      value={fontWeight}
                      onChange={(e) => setFontWeight(e.target.value)}
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none"
                    >
                      <option value="300">Light</option>
                      <option value="400">Normal</option>
                      <option value="700">Bold</option>
                    </select>
                  </div>
                </div>

                <div>
                   <label className="text-xs text-gray-400 block mb-1">Align</label>
                   <select 
                     value={textAlign}
                     onChange={(e) => setTextAlign(e.target.value as any)}
                     className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none"
                   >
                     <option value="left">Left</option>
                     <option value="center">Center</option>
                     <option value="right">Right</option>
                   </select>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <div 
                        onClick={() => setHighlightUnderline(!highlightUnderline)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", highlightUnderline ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", highlightUnderline ? "left-6" : "left-1")}></div>
                      </div>
                      <span className="text-xs text-gray-400">Underline Highlight</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Font Size</span>
                      <span>{fontSize} px</span>
                    </div>
                    <input type="range" min="12" max="100" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Line Height</span>
                      <span>{lineHeight}x</span>
                    </div>
                    <input type="range" min="1" max="2.5" step="0.1" value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Letter Spacing</span>
                      <span>{letterSpacing} px</span>
                    </div>
                    <input type="range" min="-2" max="10" value={letterSpacing} onChange={(e) => setLetterSpacing(parseInt(e.target.value))} className="w-full" />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'background' && (
              <motion.div
                key="background"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <div>
                  <label className="text-xs text-gray-400 block mb-2">Background Image</label>
                  <button 
                    onClick={() => bgFileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white font-bold py-3 rounded-xl transition-all shadow-lg active:scale-[0.98]"
                  >
                    <Upload size={16} /> {bgImage ? 'CHANGE BACKGROUND' : 'UPLOAD BACKGROUND'}
                  </button>
                  {bgImage && (
                    <p className="text-[10px] text-blue-400 mt-2 text-center font-bold animate-pulse">IMAGE UPLOADED & ACTIVE</p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Background Style</label>
                  <select 
                    value={bgStyle}
                    onChange={(e) => setBgStyle(e.target.value as any)}
                    className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none"
                  >
                    <option value="solid">Solid Color</option>
                    <option value="gradient">Gradient</option>
                    <option value="image">Background Image</option>
                  </select>
                </div>

                {bgStyle === 'image' && bgImage && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Dark Overlay</span>
                        <span>{bgImageOverlay}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        value={bgImageOverlay} 
                        onChange={(e) => setBgImageOverlay(parseInt(e.target.value))} 
                        className="w-full accent-blue-500" 
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">BG</label>
                    <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">Card</label>
                    <input type="color" value={cardColor} onChange={(e) => setCardColor(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 block mb-1">Grad. End</label>
                    <input type="color" value={gradEnd} onChange={(e) => setGradEnd(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" disabled={bgStyle === 'solid'} />
                  </div>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  CARD SETTINGS
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-2 bg-[#2a2d35]/30 rounded-lg">
                    <div className="flex items-center gap-2">
                       <div 
                        onClick={() => setShowCard(!showCard)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", showCard ? "bg-green-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", showCard ? "left-6" : "left-1")}></div>
                      </div>
                      <span className="text-xs text-gray-400">Card container active</span>
                    </div>
                    {!showCard && (
                       <button 
                        onClick={() => setShowCard(true)}
                        className="text-[10px] text-blue-400 hover:underline uppercase font-bold"
                       >
                         Enable
                       </button>
                    )}
                    {showCard && (
                       <button 
                        onClick={() => setShowCard(false)}
                        className="text-[10px] text-red-400 hover:underline uppercase font-bold flex items-center gap-1"
                       >
                         <Plus className="rotate-45" size={10} /> REMOVE CARD
                       </button>
                    )}
                  </div>

                  <div className={cn("space-y-4 transition-all duration-300", !showCard && "opacity-20 pointer-events-none grayscale")}>
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Card Radius</span>
                        <span>{cardRadius}px</span>
                      </div>
                      <input type="range" min="0" max="60" value={cardRadius} onChange={(e) => setCardRadius(parseInt(e.target.value))} className="w-full" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Card Padding</span>
                        <span>{cardPadding}px</span>
                      </div>
                      <input type="range" min="10" max="40" value={cardPadding} onChange={(e) => setCardPadding(parseInt(e.target.value))} className="w-full" />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Card Transparency</span>
                        <span>{cardTransparency}%</span>
                      </div>
                      <input type="range" min="0" max="100" value={cardTransparency} onChange={(e) => setCardTransparency(parseInt(e.target.value))} className="w-full" />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'footer' && (
              <motion.div
                key="footer"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                 <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  FOOTER
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Footer Text</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={footerText}
                      onChange={(e) => setFooterText(e.target.value)}
                      className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                    <Zap size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400" />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Footer BG Style</label>
                  <select 
                    value={footerBgStyle}
                    onChange={(e) => setFooterBgStyle(e.target.value as any)}
                    className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500 mb-3"
                  >
                    <option value="none">None — no background</option>
                    <option value="text">Fit to text — narrow band hugging the text</option>
                    <option value="card">Fit to card — spans card's left + right edges</option>
                    <option value="fill">Fill — full canvas, edge-to-edge to bottom</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">Footer Font</label>
                  <select 
                    value={footerFont}
                    onChange={(e) => setFooterFont(e.target.value)}
                    className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none font-serif"
                  >
                    {fonts.map(f => (<option key={f.value} value={f.value} className={f.value}>{f.label}</option>))}
                  </select>
                </div>

                <div>
                   <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Footer Font Size</span>
                      <span>{footerFontSize} px</span>
                    </div>
                    <input type="range" min="8" max="100" value={footerFontSize} onChange={(e) => setFooterFontSize(parseInt(e.target.value))} className="w-full" />
                </div>

                <div className="flex items-center gap-2">
                  <div 
                    onClick={() => setShowFooter(!showFooter)}
                    className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", showFooter ? "bg-blue-500" : "bg-[#2a2d35]")}
                  >
                    <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", showFooter ? "left-6" : "left-1")}></div>
                  </div>
                  <span className="text-xs text-gray-400">Show Footer</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Footer BG Color</label>
                    <input type="color" value={footerBgColor === 'transparent' ? '#000000' : footerBgColor} onChange={(e) => setFooterBgColor(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Footer Text Color</label>
                    <input type="color" value={footerTextColor} onChange={(e) => setFooterTextColor(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Border Width</label>
                    <div className="flex items-center gap-2">
                       <input 
                        type="range" 
                        min="0" 
                        max="20" 
                        value={footerBorderWidth} 
                        onChange={(e) => setFooterBorderWidth(parseInt(e.target.value))} 
                        className="flex-1" 
                      />
                      <span className="text-[10px] font-mono text-gray-500 w-6">{footerBorderWidth}px</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Border Color</label>
                    <input type="color" value={footerBorderColor} onChange={(e) => setFooterBorderColor(e.target.value)} className="w-full h-10 rounded border border-[#353941] cursor-pointer bg-transparent" />
                  </div>
                </div>

                <button 
                  onClick={() => setFooterBgColor('transparent')}
                  className="text-[10px] text-blue-400 hover:underline"
                >
                  Reset Footer to Transparent
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Actions */}
        <div className="p-4 bg-[#14161b] border-t border-[#2a2d35] flex flex-col gap-2">
           <div className="flex gap-2">
             <button className="flex-1 flex items-center justify-center gap-2 bg-[#2a2d35] hover:bg-[#353941] text-xs font-bold py-3 rounded transition-colors uppercase">
              <Save size={16} /> Save Template
            </button>
            <button 
              onClick={() => setIsExportModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-gray-200 text-black text-xs font-bold py-3 rounded transition-colors uppercase"
            >
              <Download size={16} /> Download
            </button>
          </div>
        </div>
      </div>

      {/* Preview Section */}
      <div className="flex-1 flex flex-col relative overflow-hidden bg-[#0a0c10]">
         {/* Preview Header */}
        <div className="p-4 border-b border-[#1a1d23] flex justify-between items-center bg-[#0f1115]">
          <div className="flex items-center gap-2">
             <div className="w-4 h-4 rounded-full border border-gray-600 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full border border-gray-300" />
             </div>
             <span className="text-sm font-medium text-gray-400">Preview</span>
          </div>
          <p className="text-xs text-gray-500 italic">Live preview — updates as you edit.</p>
        </div>

        {/* Preview Area */}
        <div className="flex-1 flex flex-col items-center p-8 overflow-auto bg-[#0a0c10] gap-12">
          {storiesToRender.map((story, index) => (
            <div key={index} className="flex flex-col items-center gap-4">
              {isBulkMode && (
                <div className="flex items-center gap-3 self-start">
                   <div className="px-3 py-1 bg-[#1a1d23] border border-[#2a2d35] rounded-full text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                    CARD #{index + 1}
                  </div>
                  <div className="h-px w-32 bg-gradient-to-r from-[#2a2d35] to-transparent" />
                </div>
              )}
              <div 
                className="relative overflow-visible shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] rounded-2xl" 
                style={{ width: '356px', height: '633px' }}
              >
                <Poster 
                  {...posterProps} 
                  storyText={story} 
                  innerRef={index === 0 ? previewRef : null} 
                />
              </div>
            </div>
          ))}
          
          {isBulkMode && storiesToRender.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 opacity-50">
              <Plus size={48} className="mb-4" />
              <p className="font-bold text-lg">Input some stories to see cards</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Sub-component for clean rendering
function Poster({ 
  innerRef, storyText, bgStyle, bgColor, gradEnd, avatarBorder, avatarBorderColor,
  profileImage, scribbleStyle, nameFont, nameHasBg, nameSize, nameColor,
  posterName, subFont, subtitleHasBg, subtitleSize, subtitleColor, subtitle,
  cardColor, cardTransparency, cardRadius, cardPadding, fontFamily, fontSize,
  fontWeight, textColor, textAlign, lineHeight, letterSpacing, fontStyle, 
  showFooter, footerFont, footerBgStyle, footerBgColor, footerTextColor, 
  footerFontSize, footerText, renderStoryText, showCard, footerBorderWidth, footerBorderColor,
  bgImage, bgImageOverlay
}: any) {
  return (
    <div 
      ref={innerRef}
      className="relative overflow-hidden flex flex-col items-center h-full w-full"
      style={{ 
        width: '1080px', 
        height: '1920px',
        background: bgStyle === 'solid' ? bgColor : 
                    bgStyle === 'gradient' ? `linear-gradient(to bottom, ${bgColor}, ${gradEnd})` : 
                    '#000',
        transform: 'scale(0.33)',
        transformOrigin: 'top left',
        position: 'absolute',
        top: 0,
        left: 0
      }}
    >
      {bgStyle === 'image' && bgImage && (
        <>
          <img 
            src={bgImage} 
            alt="Background" 
            className="absolute inset-0 w-full h-full object-cover"
            style={{ zIndex: 0 }}
          />
          <div 
            className="absolute inset-0 z-0" 
            style={{ backgroundColor: `rgba(0,0,0,${bgImageOverlay / 100})` }}
          />
        </>
      )}
      {/* Design Elements */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 4px 4px, white 2px, transparent 0)', backgroundSize: '64px 64px' }}></div>

      {/* Top Spacing */}
      <div className="h-40 w-full" />

      {/* Profile Section */}
      <div className="w-full flex items-center gap-10 mb-12 z-10 px-16 self-start">
        <div 
          className={cn("w-40 h-40 rounded-full overflow-hidden flex-shrink-0 relative shadow-2xl bg-gray-200")}
          style={{ border: avatarBorder ? `8px solid ${avatarBorderColor}` : 'none' }}
        >
          <img 
            src={profileImage} 
            alt="Profile" 
            className={cn(
              "w-full h-full object-cover",
              scribbleStyle === 'blur' && "blur-[6px] scale-110",
              scribbleStyle === 'mosaic' && "contrast-150 brightness-110 blur-[2px] opacity-70"
            )} 
            referrerPolicy="no-referrer" 
            crossOrigin="anonymous" 
          />
          {scribbleStyle === 'solid' && (
            <div className="absolute inset-0 bg-white/40 backdrop-blur-sm flex items-center justify-center">
                <div className="w-full h-[30%] bg-blue-500/80 rotate-[-15deg]"></div>
            </div>
          )}
          {scribbleStyle === 'squiggle' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                <svg className="w-full h-full text-blue-500 opacity-80" viewBox="0 0 100 100">
                    <path d="M 0 50 Q 25 30 50 50 T 100 50" fill="none" stroke="currentColor" strokeWidth="15" />
                    <path d="M 0 30 Q 25 10 50 30 T 100 30" fill="none" stroke="currentColor" strokeWidth="15" />
                    <path d="M 0 70 Q 25 50 50 70 T 100 70" fill="none" stroke="currentColor" strokeWidth="15" />
                </svg>
              </div>
          )}
        </div>
        <div className="flex flex-col justify-center">
          <div 
            className={cn("inline-block rounded px-1 text-ellipsis overflow-hidden whitespace-nowrap max-w-[800px]", nameFont, nameHasBg ? "bg-white/20 backdrop-blur-sm" : "")}
            style={{ 
              fontSize: `${nameSize}px`, 
              color: nameColor,
              fontWeight: '800',
              lineHeight: 1,
              letterSpacing: '-1px'
            }}
          >
            {posterName}
          </div>
          <div 
            className={cn("block mt-2 rounded px-1", subFont, subtitleHasBg ? "bg-white/20 backdrop-blur-sm" : "")}
            style={{ 
              fontSize: `${subtitleSize}px`, 
              color: subtitleColor,
              opacity: 0.9,
              lineHeight: 1,
              fontWeight: '500'
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      {/* Card Body */}
      <div className="w-full relative z-10 flex flex-col justify-center px-16 mb-24">
        <div 
          className="w-full"
          style={{
            backgroundColor: showCard ? `${cardColor}${Math.round(cardTransparency * 2.55).toString(16).padStart(2, '0')}` : 'transparent',
            borderRadius: `${cardRadius}px`,
            padding: `${cardPadding}px`,
            boxShadow: showCard ? '0 30px 80px -15px rgba(0,0,0,0.15)' : 'none',
          }}
        >
          <div 
            className={cn(fontFamily)}
            style={{ 
              fontSize: `${fontSize}px`,
              color: textColor,
              textAlign: textAlign,
              lineHeight: lineHeight,
              letterSpacing: `${letterSpacing}px`,
              fontWeight: fontWeight,
              fontStyle: fontStyle === 'italic' ? 'italic' : 'normal',
              whiteSpace: 'pre-wrap',
            }}
          >
            {renderStoryText(storyText)}
          </div>
        </div>
      </div>

      {/* Footer */}
      {showFooter && (
        <div className="w-full mt-auto mb-20 flex justify-center z-10">
          <div 
            className={cn(
              "py-6 px-12 rounded-lg text-center transition-all flex items-center justify-center gap-6", 
              footerFont,
              footerBgStyle === 'card' && "w-[calc(100%-128px)]",
              footerBgStyle === 'fill' && "absolute bottom-0 left-0 right-0 py-12"
            )}
            style={{ 
              backgroundColor: footerBgStyle === 'none' ? 'transparent' : 
                               footerBgStyle === 'card' ? cardColor : 
                               footerBgColor,
              color: footerTextColor,
              fontSize: `${footerFontSize}px`,
              fontWeight: '800',
              letterSpacing: '2px',
              borderRadius: footerBgStyle === 'text' ? '12px' : '0',
              border: footerBorderWidth > 0 ? `${footerBorderWidth}px solid ${footerBorderColor}` : 'none',
              textTransform: 'uppercase',
              boxShadow: footerBgStyle === 'none' ? 'none' : '0 10px 30px -5px rgba(0,0,0,0.1)'
            }}
          >
            {footerText}
            <MoveRight size={footerFontSize * 1.2} strokeWidth={3} />
          </div>
        </div>
      )}
    </div>
  );
}
