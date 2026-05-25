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
  ChevronUp,
  Copy,
  Upload,
  Zap,
  X,
  Play,
  Film,
  Loader2,
  MoveRight,
  Plus,
  Trash2,
  FileImage,
  Music,
  Volume2,
  VolumeX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng, toCanvas } from 'html-to-image';
import { cn } from './lib/utils';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { TEMPLATE_PRESETS, TemplatePreset } from './constants';

import JSZip from 'jszip';
import Papa from 'papaparse';

type TabType = 'profile' | 'typography' | 'background' | 'footer' | 'pictext';

// Background-safe high-precision delay using a singleton Web Worker to avoid browser background throttling
let timingWorker: Worker | null = null;
let timingWorkerUrl: string | null = null;
let timingNextId = 0;
const timingCallbacks = new Map<number, () => void>();

const getTimingWorker = () => {
  if (!timingWorker && typeof Worker !== 'undefined') {
    const workerCode = `
      self.onmessage = function(e) {
        if (e.data.type === 'delay') {
          setTimeout(() => {
            self.postMessage({ id: e.data.id });
          }, e.data.ms);
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'text/javascript' });
    timingWorkerUrl = URL.createObjectURL(blob);
    timingWorker = new Worker(timingWorkerUrl);
    timingWorker.onmessage = (e) => {
      const cb = timingCallbacks.get(e.data.id);
      if (cb) {
        timingCallbacks.delete(e.data.id);
        cb();
      }
    };
  }
  return timingWorker;
};

const bgDelay = (ms: number): Promise<void> => {
  if (typeof Worker === 'undefined') {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  return new Promise((resolve) => {
    const worker = getTimingWorker();
    if (!worker) {
      setTimeout(resolve, ms);
      return;
    }
    const id = timingNextId++;
    timingCallbacks.set(id, resolve);
    worker.postMessage({ type: 'delay', id, ms });
  });
};

// Helper to highlight random words while keeping double-bracket [[box backgrounds]] completely intact
const getRandomHighlights = (text: string) => {
  const segments = text.split(/(\[\[.*?\]\])/).map(part => ({
    text: part,
    isBox: part.startsWith('[[') && part.endsWith(']]')
  }));

  interface FlatPart {
    text: string;
    isWord: boolean;
  }

  const flatParts: FlatPart[] = [];
  segments.forEach(seg => {
    if (seg.isBox) {
      flatParts.push({ text: seg.text, isWord: false });
    } else {
      const subParts = seg.text.split(/(\s+)/);
      subParts.forEach(part => {
        const isWord = part.trim().length > 0;
        flatParts.push({ text: part, isWord });
      });
    }
  });

  const wordIndices: number[] = [];
  flatParts.forEach((part, i) => {
    if (part.isWord) {
      wordIndices.push(i);
    }
  });

  if (wordIndices.length < 3) {
    return flatParts.map(p => p.text).join('');
  }
  
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
  
  return flatParts.map((part, i) => highlightIndices.has(i) ? `[${part.text}]` : part.text).join('');
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [selectedPresetId, setSelectedPresetId] = useState(TEMPLATE_PRESETS[1].id);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportDuration, setExportDuration] = useState(31);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [bulkExportInfo, setBulkExportInfo] = useState('');

  const cancelExportRef = useRef(false);

  const handleCancelExport = useCallback(() => {
    cancelExportRef.current = true;
    setIsExporting(false);
    setExportProgress(0);
    setBulkExportInfo('');
    setIsExportModalOpen(false);
  }, []);

  const getSupportedMimeType = useCallback(() => {
    const types = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4;codecs=h264',
      'video/mp4',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return 'video/webm';
  }, []);

  const recordCanvasToMp4 = async (canvas: HTMLCanvasElement, duration: number, onProgress?: (p: number) => void, videoUrl?: string | null, overlayOpacity: number = 0) => {
    // Check for WebCodecs support
    if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
      throw new Error('WebCodecs API not supported');
    }

    // H.264 encoders often require even dimensions
    let width = canvas.width;
    let height = canvas.height;
    if (width % 2 !== 0) width--;
    if (height % 2 !== 0) height--;

    const fps = 30;
    const totalFrames = duration * fps;

    // Create a recording canvas that we will draw into
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not get offscreen canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Create a temporary video element for source frames if a video URL is provided
    let video: HTMLVideoElement | null = null;
    if (videoUrl) {
      video = document.createElement('video');
      video.src = videoUrl;
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.style.position = 'fixed';
      video.style.left = '-9999px';
      video.style.top = '-9999px';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0.001';
      video.style.pointerEvents = 'none';
      document.body.appendChild(video);
      
      video.play().catch(e => console.log('Video background play started: ', e)); // Start playing so we can capture frames
      await new Promise((resolve) => {
        video!.onloadeddata = resolve;
      });
    }

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height
      },
      audio: uploadedMusicBuffer ? {
        codec: 'aac',
        numberOfChannels: uploadedMusicBuffer.numberOfChannels,
        sampleRate: uploadedMusicBuffer.sampleRate
      } : undefined,
      fastStart: 'in-memory'
    });

    let encoderError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error('VideoEncoder error:', e);
        encoderError = e;
      }
    });

    // Try multiple H.264 profiles for compatibility
    const codecProfiles = [
      'avc1.42E01E', // Baseline Level 3.0
      'avc1.4D401E', // Main Level 3.0
      'avc1.4d002e', // Main Level 4.6
      'avc1.640028'  // High Level 4.0
    ];

    let config: VideoEncoderConfig | null = null;

    for (const codec of codecProfiles) {
      const testConfig: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate: 16_000_000, // 16 Mbps for high-quality distortion-free videos
        latencyMode: 'quality', // Trade compression latency for absolute visual clarity and sharpness
        avc: { format: 'avc' } // 'avc' (AVCC) is standard for MP4
      };
      
      try {
        const support = await VideoEncoder.isConfigSupported(testConfig);
        if (support.supported) {
          config = testConfig;
          break;
        }
      } catch (e) {
        console.warn(`Codec ${codec} support check failed:`, e);
      }
    }

    if (!config) {
      // Fallback to a very basic string if needed, or error out
      config = {
        codec: 'avc1.42E01E',
        width,
        height,
        bitrate: 6_000_000,
        avc: { format: 'avc' }
      };
    }

    try {
      encoder.configure(config);
    } catch (e) {
      console.error('Failed to configure encoder with primary config, trying fallback:', e);
      config.codec = 'avc1.42E01E'; // Try baseline if main failed
      encoder.configure(config);
    }

    try {
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (cancelExportRef.current) {
          throw new Error('Export cancelled');
        }
        if (encoderError) throw encoderError;
        if (encoder.state === 'closed') throw new Error('Encoder closed unexpectedly');

        const timestamp = (frameIndex * 1000000) / fps;
        
        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // 1. Draw video background
        if (video) {
          // Sync video time
          video.currentTime = (frameIndex / fps) % video.duration;
          
          await new Promise(r => {
            let done = false;
            const onSeeked = () => {
              if (done) return;
              done = true;
              video!.removeEventListener('seeked', onSeeked);
              r(null);
            };
            video!.addEventListener('seeked', onSeeked);
            // Safety timeout using background-safe delay
            bgDelay(100).then(() => {
              if (done) return;
              done = true;
              video!.removeEventListener('seeked', onSeeked);
              r(null);
            });
          });
          
          // Draw video with "cover" logic
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = width / height;
          let drawW = width;
          let drawH = height;
          let drawX = 0;
          let drawY = 0;

          if (videoAspect > canvasAspect) {
            drawW = height * videoAspect;
            drawX = (width - drawW) / 2;
          } else {
            drawH = width / videoAspect;
            drawY = (height - drawH) / 2;
          }
          ctx.drawImage(video, drawX, drawY, drawW, drawH);

          // Apply overlay if needed
          if (overlayOpacity > 0) {
            ctx.fillStyle = `rgba(0, 0, 0, ${overlayOpacity / 100})`;
            ctx.fillRect(0, 0, width, height);
          }
        }

        // 2. Draw UI snapshot on top
        ctx.drawImage(canvas, 0, 0, width, height);

        // We create a new VideoFrame using the offscreen canvas. 
        const frame = new VideoFrame(offscreen, { 
          timestamp,
          visibleRect: { x: 0, y: 0, width, height },
          displayWidth: width,
          displayHeight: height
        });
        
        encoder.encode(frame, { keyFrame: frameIndex % 30 === 0 }); // Keyframe every second
        frame.close();

        if (onProgress) {
          onProgress(Math.floor((frameIndex / totalFrames) * 100));
        }

        // We need to wait for the encoder to process. Too much pressure can cause stalls.
        if (frameIndex % 5 === 0) {
          await bgDelay(0);
          // Also check if we need to flush to keep memory low
          if (frameIndex % 60 === 0) {
            await encoder.flush();
          }
        }
      }

      await encoder.flush();
      encoder.close(); // Close the encoder after we are done

      // Encode audio if uploaded
      let audioEncoderError: Error | null = null;
      let audioEncoder: AudioEncoder | null = null;
      if (uploadedMusicBuffer) {
        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => {
            console.error('AudioEncoder error:', e);
            audioEncoderError = e;
          }
        });

        audioEncoder.configure({
          codec: 'mp4a.40.2',
          numberOfChannels: uploadedMusicBuffer.numberOfChannels,
          sampleRate: uploadedMusicBuffer.sampleRate,
          bitrate: 128000
        });

        const sampleRate = uploadedMusicBuffer.sampleRate;
        const numberOfChannels = uploadedMusicBuffer.numberOfChannels;
        const chunkFrames = 1024;
        const totalSamples = Math.floor(duration * sampleRate);

        for (let offset = 0; offset < totalSamples; offset += chunkFrames) {
          if (cancelExportRef.current) {
            throw new Error('Export cancelled');
          }
          if (audioEncoderError) throw audioEncoderError;
          const currentChunkSize = Math.min(chunkFrames, totalSamples - offset);
          const chunkData = new Float32Array(currentChunkSize * numberOfChannels);
          
          for (let channel = 0; channel < numberOfChannels; channel++) {
            const channelData = uploadedMusicBuffer.getChannelData(channel);
            for (let i = 0; i < currentChunkSize; i++) {
              const sourceIndex = (offset + i) % channelData.length;
              chunkData[channel * currentChunkSize + i] = channelData[sourceIndex];
            }
          }

          const timestamp = Math.floor((offset / sampleRate) * 1000000); // microseconds
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: sampleRate,
            numberOfFrames: currentChunkSize,
            numberOfChannels: numberOfChannels,
            timestamp: timestamp,
            data: chunkData
          });

          audioEncoder.encode(audioData);
          audioData.close();
        }

        await audioEncoder.flush();
        audioEncoder.close();
      }

      muxer.finalize();
      
      // Convert ArrayBuffer to Blob
      const buffer = muxer.target.buffer;
      if (!buffer || buffer.byteLength === 0) {
        throw new Error('Exported video is empty');
      }
      return new Blob([buffer], { type: 'video/mp4' });

    } catch (err) {
      try {
        if (encoder.state !== 'closed') {
          encoder.close();
        }
      } catch (e) {}
      throw err;
    } finally {
      if (video) {
        video.pause();
        video.remove();
      }
    }
  };

  const recordWithFallback = async (canvas: HTMLCanvasElement, duration: number, onProgress?: (p: number) => void, videoUrl?: string | null, overlayOpacity: number = 0) => {
    if ('VideoEncoder' in window) {
      try {
        return await recordCanvasToMp4(canvas, duration, onProgress, videoUrl, overlayOpacity);
      } catch (err) {
        console.error('VideoEncoder failed, falling back to MediaRecorder:', err);
      }
    }
    return await recordCanvasMediaRecorder(canvas, duration, onProgress, videoUrl, overlayOpacity);
  };

  const recordCanvasMediaRecorder = (canvas: HTMLCanvasElement, duration: number, onProgress?: (p: number) => void, videoUrl?: string | null, overlayOpacity: number = 0): Promise<Blob> => {
    return new Promise(async (resolve, reject) => {
      const width = canvas.width;
      const height = canvas.height;
      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const ctx = offscreen.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Could not get offscreen canvas context');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      let video: HTMLVideoElement | null = null;
      let audio: HTMLAudioElement | null = null;

      try {
        if (videoUrl) {
          video = document.createElement('video');
          video.src = videoUrl;
          video.crossOrigin = 'anonymous';
          video.muted = true;
          video.playsInline = true;
          video.style.position = 'fixed';
          video.style.left = '-9999px';
          video.style.top = '-9999px';
          video.style.width = '1px';
          video.style.height = '1px';
          video.style.opacity = '0.001';
          video.style.pointerEvents = 'none';
          document.body.appendChild(video);
          
          video.play().catch(e => console.log('Video background fallback play error:', e));
          await new Promise((r) => { video!.onloadeddata = r; });
        }

        const stream = offscreen.captureStream(30);

        if (uploadedMusicUrl) {
          audio = document.createElement('audio');
          audio.src = uploadedMusicUrl;
          audio.crossOrigin = 'anonymous';
          audio.loop = true;
          audio.volume = 1.0;
          try {
            audio.play().catch(e => console.log('Autoplay blocked in media recorder:', e));
            const audioStream = (audio as any).captureStream ? (audio as any).captureStream() : (audio as any).mozCaptureStream ? (audio as any).mozCaptureStream() : null;
            if (audioStream) {
              const audioTrack = audioStream.getAudioTracks()[0];
              if (audioTrack) {
                stream.addTrack(audioTrack);
              }
            }
          } catch (e) {
            console.error("Failed to attach audio track to media recorder fallback:", e);
          }
        }

        const mimeType = getSupportedMimeType();
        const mediaRecorder = new MediaRecorder(stream, { 
          mimeType,
          videoBitsPerSecond: 16000000 // High 16 Mbps bit rate for maximum visual quality and text sharpness
        });
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        const onStopPromise = new Promise<Blob>((resolveStop) => {
          mediaRecorder.onstop = () => {
            if (audio) {
              audio.pause();
              audio.remove();
              audio = null;
            }
            resolveStop(new Blob(chunks, { type: mimeType }));
          };
        });

        mediaRecorder.start();
        
        const fps = 30;
        const totalFrames = duration * fps;
        
        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
          if (cancelExportRef.current) {
            try {
              if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
              }
            } catch (e) {}
            throw new Error('Export cancelled');
          }
          // Clear and Draw
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);

          if (video) {
            video.currentTime = (frameIndex / fps) % video.duration;
            await new Promise(r => {
              let done = false;
              const onSeeked = () => {
                if (done) return;
                done = true;
                video!.removeEventListener('seeked', onSeeked);
                r(null);
              };
              video!.addEventListener('seeked', onSeeked);
              // Use background-safe high precision timer for the safety duration
              bgDelay(100).then(() => {
                if (done) return;
                done = true;
                video!.removeEventListener('seeked', onSeeked);
                r(null);
              });
            });
            
            const videoAspect = video.videoWidth / video.videoHeight;
            const canvasAspect = width / height;
            let drawW = width;
            let drawH = height;
            let drawX = 0;
            let drawY = 0;

            if (videoAspect > canvasAspect) {
              drawW = height * videoAspect;
              drawX = (width - drawW) / 2;
            } else {
              drawH = width / videoAspect;
              drawY = (height - drawH) / 2;
            }
            ctx.drawImage(video, drawX, drawY, drawW, drawH);

            if (overlayOpacity > 0) {
              ctx.fillStyle = `rgba(0, 0, 0, ${overlayOpacity / 100})`;
              ctx.fillRect(0, 0, width, height);
            }
          }

          ctx.drawImage(canvas, 0, 0, width, height);
          
          if (onProgress) onProgress(Math.floor((frameIndex / totalFrames) * 100));
          
          // Small delay to allow stream to capture - using background safe wait
          await bgDelay(1000/fps);
        }

        mediaRecorder.stop();
        const recordedBlob = await onStopPromise;
        resolve(recordedBlob);

      } catch (error) {
        console.error("Error drawing and recording video fallbacks:", error);
        reject(error);
      } finally {
        if (video) {
          video.pause();
          video.remove();
          video = null;
        }
        if (audio) {
          audio.pause();
          audio.remove();
          audio = null;
        }
      }
    });
  };
  
  // Bulk Mode State
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkStories, setBulkStories] = useState<any[]>([
    {
      text: 'Aitah For Telling My Brother His [Girlfriend] Is Not Allowed In My House [Again?] I haven\'t seen my brother in [5 years] due to both of us being in the military. He finally came to [visit] with his [girlfriend] that he\'s been with for [3 years.] His [visit] it already cut from 2 weeks to 4 days because she has to go back to [work.] They also brought their dog, but [forgot] the kennel, so I...',
      fontSize: 62,
      highlightColor: '#150621'
    }
  ]);

  // Picture & Text Bulk State
  const [isPicTextBulk, setIsPicTextBulk] = useState(false);
  const [picTextBulkStories, setPicTextBulkStories] = useState<any[]>([
    {
      text: 'Aitah For Telling My Brother His [Girlfriend] Is Not Allowed In My House [[Again?]] I haven\'t seen my brother in [5 years] due to both of us being in the military. He finally came to [visit] with his [girlfriend] that he\'s been with for [3 years.] His [visit] it already cut from 2 weeks to 4 days because she has to go back to [work.] They also brought their dog, but [forgot] the kennel, so I...',
      image: null,
      fontSize: 62,
      highlightColor: '#150621'
    }
  ]);

  const addBulkStory = () => {
    setBulkStories(prev => [...prev, {
      text: '',
      fontSize: 62,
      highlightColor: highlightColor,
      boxHighlight: false
    }]);
  };

  const removeBulkStory = (index: number) => {
    setBulkStories(prev => prev.filter((_, i) => i !== index));
  };

  const duplicateBulkStory = (index: number) => {
    setBulkStories(prev => {
      const copy = [...prev];
      const copyOfItem = { ...copy[index] };
      copy.splice(index + 1, 0, copyOfItem);
      return copy;
    });
  };

  const moveBulkStoryUp = (index: number) => {
    if (index === 0) return;
    setBulkStories(prev => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[index - 1];
      copy[index - 1] = temp;
      return copy;
    });
  };

  const moveBulkStoryDown = (index: number) => {
    setBulkStories(prev => {
      if (index === prev.length - 1) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[index + 1];
      copy[index + 1] = temp;
      return copy;
    });
  };

  const [bulkImageUploadIndex, setBulkImageUploadIndex] = useState<number | null>(null);

  const addPicTextBulkStory = () => {
    setPicTextBulkStories(prev => [...prev, {
      text: '',
      image: null,
      fontSize: fontSize || 62,
      highlightColor: highlightColor || '#150621',
      boxHighlight: false
    }]);
  };

  const removePicTextBulkStory = (index: number) => {
    setPicTextBulkStories(prev => prev.filter((_, i) => i !== index));
  };

  const duplicatePicTextBulkStory = (index: number) => {
    setPicTextBulkStories(prev => {
      const copy = [...prev];
      const copyOfItem = { ...copy[index] };
      copy.splice(index + 1, 0, copyOfItem);
      return copy;
    });
  };

  const movePicTextBulkStoryUp = (index: number) => {
    if (index === 0) return;
    setPicTextBulkStories(prev => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[index - 1];
      copy[index - 1] = temp;
      return copy;
    });
  };

  const movePicTextBulkStoryDown = (index: number) => {
    setPicTextBulkStories(prev => {
      if (index === prev.length - 1) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[index + 1];
      copy[index + 1] = temp;
      return copy;
    });
  };
  
  // Profile State
  const [profileImage, setProfileImage] = useState('https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400&h=400');
  const [posterName, setPosterName] = useState('Buried Bell');
  const [subtitle, setSubtitle] = useState('5h ago');
  const [showPosterName, setShowPosterName] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(true);
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
  const [profileMove, setProfileMove] = useState(0);
  const [profilePosition, setProfilePosition] = useState('outside');
  const [cardMove, setCardMove] = useState(0);
  const [footerMove, setFooterMove] = useState(0);
  const [customHighlightColor, setCustomHighlightColor] = useState('#808080'); // Default grey like screenshot
  
  // Typography State
  const [storyText, setStoryText] = useState('Aitah For Telling My Brother His [Girlfriend] Is Not Allowed In My House [[Again?]] I haven\'t seen my brother in [5 years] due to both of us being in the military. He finally came to [visit] with his [girlfriend] that he\'s been with for [3 years.] His [visit] it already cut from 2 weeks to 4 days because she has to go back to [work.] They also brought their dog, but [forgot] the kennel, so I...');
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
  const [boxHighlight, setBoxHighlight] = useState(false);
  const [boldParagraphIndex, setBoldParagraphIndex] = useState<number | null>(null);
  const [storyImage, setStoryImage] = useState<string | null>(null);
  const [storyImageHeight, setStoryImageHeight] = useState<number>(750);
  const [storyImageRadius, setStoryImageRadius] = useState<number>(16);
  const [storyImageFit, setStoryImageFit] = useState<'cover' | 'contain' | 'fill'>('cover');

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
  const [showProfile, setShowProfile] = useState(true);
  const [showDots, setShowDots] = useState(true);
  const [fullImageOnly, setFullImageOnly] = useState<string | null>(null);
  const [removePaddingWhenHidden, setRemovePaddingWhenHidden] = useState(false);
  const [videoBackground, setVideoBackground] = useState<string | null>(null);
  const [previousBgStyle, setPreviousBgStyle] = useState<'solid' | 'gradient' | 'image' | null>(null);

  // Music State
  const [uploadedMusicFile, setUploadedMusicFile] = useState<File | null>(null);
  const [uploadedMusicUrl, setUploadedMusicUrl] = useState<string | null>(null);
  const [uploadedMusicBuffer, setUploadedMusicBuffer] = useState<AudioBuffer | null>(null);
  const [isMusicMuted, setIsMusicMuted] = useState<boolean>(false);
  const [isMusicDecoding, setIsMusicDecoding] = useState<boolean>(false);

  // Music Input Ref and Audio Playback Tag Ref
  const musicFileInputRef = useRef<HTMLInputElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

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

  useEffect(() => {
    if (audioElementRef.current) {
      if (uploadedMusicUrl && !isMusicMuted && !isExporting) {
        audioElementRef.current.play().catch(err => {
          console.log('Autoplay blocked. Pressing play after click will work.', err);
        });
      } else {
        audioElementRef.current.pause();
      }
    }
  }, [uploadedMusicUrl, isMusicMuted, isExporting]);

  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const videoBgInputRef = useRef<HTMLInputElement>(null);
  const fullImageInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const picTextCsvInputRef = useRef<HTMLInputElement>(null);
  const storyImageInputRef = useRef<HTMLInputElement>(null);
  const bulkStoryImageInputRef = useRef<HTMLInputElement>(null);

  const handleReset = () => {
    applyPreset(TEMPLATE_PRESETS[1].id);
    setActiveTab('profile');
    setExportDuration(31);
    setProfileImage('https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=400&h=400');
    setPosterName('Buried Bell');
    setSubtitle('5h ago');
    setShowPosterName(true);
    setShowSubtitle(true);
    setStoryText('Aitah For Telling My Brother His [Girlfriend] Is Not Allowed In My House [Again?] I haven\'t seen my brother in [5 years] due to both of us being in the military. He finally came to [visit] with his [girlfriend] that he\'s been with for [3 years.] His [visit] it already cut from 2 weeks to 4 days because she has to go back to [work.] They also brought their dog, but [forgot] the kennel, so I...');
    setBoldParagraphIndex(null);
    setStoryImage(null);
    setStoryImageHeight(750);
    setStoryImageRadius(16);
    setStoryImageFit('cover');
    setBulkStories([
      {
        text: 'Aitah For Telling My Brother His [Girlfriend] Is Not Allowed In My House [Again?] I haven\'t seen my brother in [5 years] due to both of us being in the military. He finally came to [visit] with his [girlfriend] that he\'s been with for [3 years.] His [visit] it already cut from 2 weeks to 4 days because she has to go back to [work.] They also brought their dog, but [forgot] the kennel, so I...',
        fontSize: 62,
        highlightColor: '#150621'
      }
    ]);
    setFooterText("CONTINUE READING IN COMMENT");
    setNameSize(82);
    setNameHasBg(false);
    setSubtitleSize(44);
    setSubtitleHasBg(false);
    setFontSize(62);
    setFontWeight('700');
    setTextAlign('left');
    setFontStyle('normal');
    setLineHeight(1.25);
    setLetterSpacing(0);
    setHighlightUnderline(false);
    setFooterFontSize(32);
    setFooterBorderWidth(0);
    setFooterBorderColor('#000000');
    setCardRadius(36);
    setCardPadding(60);
    setCardTransparency(100);
    setScribbleStyle('none');
    setProfileMove(0);
    setProfilePosition('outside');
    setCardMove(0);
    setFooterMove(0);
    setCustomHighlightColor('#808080');
    setFooterBgStyle('text');
    setFooterBgColor('#ffffff');
    setBgColor('#CEADE1');
    setBgStyle('solid');
    setBgImage(null);
    setBgImageOverlay(20);
    setGradEnd('#FF6347');
    setCardColor('#FAF2FB');
    setNameColor('#2D0D44');
    setSubtitleColor('#8148B0');
    setTextColor('#150621');
    setHighlightColor('#150621');
    setFooterTextColor('#150621');
    setAvatarBorder(true);
    setAvatarBorderColor('#ffffff');
    setShowCard(true);
    setShowFooter(true);
    setShowProfile(true);
    setShowDots(true);
    setFullImageOnly(null);
    setVideoBackground(null);
    setPreviousBgStyle(null);
    setRemovePaddingWhenHidden(false);
  };

  const handleNewPoster = () => {
    setPosterName('');
    setSubtitle('5h ago');
    setShowPosterName(true);
    setShowSubtitle(true);
    setStoryText('');
    setBoldParagraphIndex(null);
    setStoryImage(null);
    setFooterText('CONTINUE READING IN COMMENT');
    const randomPreset = TEMPLATE_PRESETS[Math.floor(Math.random() * TEMPLATE_PRESETS.length)];
    applyPreset(randomPreset.id);
    setShowCard(true);
    setShowFooter(true);
    setShowProfile(true);
    setShowDots(true);
    setFullImageOnly(null);
    setVideoBackground(null);
    setPreviousBgStyle(null);
    setRemovePaddingWhenHidden(false);
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

    // Apply to bulk stories as well
    setBulkStories(prev => prev.map(story => ({
      ...story,
      highlightColor: preset.typography.highlightColor
    })));
    setPicTextBulkStories(prev => prev.map(story => ({
      ...story,
      highlightColor: preset.typography.highlightColor
    })));
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

  const handleFullImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setFullImageOnly(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleStoryImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setStoryImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleVideoBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      // Only set previous style if we haven't already (e.g. if changing from one video to another)
      if (!videoBackground) {
        setPreviousBgStyle(bgStyle);
      }
      setVideoBackground(url);
      setBgStyle('image'); // Switch to image style to show media
    }
  };

  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedMusicFile(file);
      setIsMusicDecoding(true);
      const url = URL.createObjectURL(file);
      setUploadedMusicUrl(url);
      
      // Decode audio data for MP4 WebCodecs exports
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await file.arrayBuffer();
        const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        setUploadedMusicBuffer(decodedBuffer);
      } catch (err) {
        console.error("Failed to decode uploaded background music audio:", err);
      } finally {
        setIsMusicDecoding(false);
      }
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        complete: (results) => {
          const data = results.data as any[];
          // Filter out empty rows and handle different possible CSV structures
          const stories = data
            .map(row => {
              if (Array.isArray(row)) return row[0];
              if (typeof row === 'object') return Object.values(row)[0];
              return row;
            })
            .filter(text => text && text.toString().trim().length > 0);

          if (stories.length > 0) {
            const newStories = stories.map(storyText => ({
              text: storyText.toString().trim(),
              fontSize: 62,
              highlightColor: highlightColor
            }));
            setBulkStories(newStories);
          }
        },
        header: false,
        skipEmptyLines: true
      });
    }
    // Reset input so the same file can be uploaded again if needed
    e.target.value = '';
  };

  const handlePicTextCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        complete: (results) => {
          const data = results.data as any[];
          const parsed: any[] = [];
          data.forEach((row) => {
            let imgVal = '';
            let txtVal = '';
            if (Array.isArray(row)) {
              if (row.length >= 2) {
                const col0 = String(row[0] || '').trim();
                const col1 = String(row[1] || '').trim();
                const isCol0Img = /^(https?:\/\/|\/|data:image)/i.test(col0) || /\.(png|jpe?g|gif|webp|svg)/i.test(col0);
                const isCol1Img = /^(https?:\/\/|\/|data:image)/i.test(col1) || /\.(png|jpe?g|gif|webp|svg)/i.test(col1);
                if (isCol0Img && !isCol1Img) {
                  imgVal = col0;
                  txtVal = col1;
                } else if (isCol1Img && !isCol0Img) {
                  imgVal = col1;
                  txtVal = col0;
                } else {
                  // Fallbacks
                  imgVal = col0;
                  txtVal = col1;
                }
              } else if (row.length === 1) {
                txtVal = String(row[0] || '').trim();
              }
            } else if (row && typeof row === 'object') {
              const values = Object.values(row);
              if (values.length >= 2) {
                imgVal = String(values[0] || '').trim();
                txtVal = String(values[1] || '').trim();
              } else if (values.length === 1) {
                txtVal = String(values[0] || '').trim();
              }
            }
            // Skip header raw labels
            if (txtVal.toLowerCase() === 'text' || txtVal.toLowerCase() === 'story' || imgVal.toLowerCase() === 'image' || imgVal.toLowerCase() === 'url') {
              return;
            }
            if (txtVal || imgVal) {
              parsed.push({
                text: txtVal,
                image: imgVal || null,
                fontSize: fontSize || 62,
                highlightColor: highlightColor || '#150621'
              });
            }
          });
          if (parsed.length > 0) {
            setPicTextBulkStories(parsed);
          }
        },
        header: false,
        skipEmptyLines: true
      });
    }
    e.target.value = '';
  };

  const handleBulkDownload = useCallback(async () => {
    const cardElements = document.querySelectorAll('.bulk-poster-card');
    if (cardElements.length === 0) return;

    cancelExportRef.current = false;
    setIsExporting(true);
    setExportProgress(0);
    setBulkExportInfo(`Initializing bulk export...`);
    
    // Dynamically import jszip inside the handler to keep the initial bundle smaller
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const total = cardElements.length;
    
    // Wait for UI to update (hide video backgrounds)
    try {
      await new Promise(r => setTimeout(r, 500));
      if (cancelExportRef.current) throw new Error('Export cancelled');
      
      for (let i = 0; i < total; i++) {
        if (cancelExportRef.current) throw new Error('Export cancelled');
        const node = cardElements[i] as HTMLElement;
        setBulkExportInfo(`Exporting Card ${i + 1} of ${total}`);
        
        const blob = await new Promise<Blob>((resolve, reject) => {
          toCanvas(node, {
            pixelRatio: 1,
            cacheBust: true,
            width: 1080,
            height: 1920,
            style: {
              transform: 'none',
              transformOrigin: 'top left',
              width: '1080px',
              height: '1920px'
            }
          }).then(async (canvas) => {
            try {
              if (cancelExportRef.current) {
                reject(new Error('Export cancelled'));
                return;
              }
              const videoBlob = await recordWithFallback(canvas, exportDuration, (cardProgress) => {
                if (cancelExportRef.current) {
                  reject(new Error('Export cancelled'));
                  return;
                }
                const overallProgress = Math.floor(((i + (cardProgress / 100)) / total) * 100);
                setExportProgress(overallProgress);
              }, videoBackground, bgImageOverlay);
              resolve(videoBlob);
            } catch (err) {
              console.error('Bulk export error:', err);
              reject(err);
            }
          }).catch(reject);
        });

        if (cancelExportRef.current) throw new Error('Export cancelled');
        const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
        zip.file(`story-${i + 1}.${extension}`, blob);
      }
      
      if (cancelExportRef.current) throw new Error('Export cancelled');
      setBulkExportInfo('Generating ZIP file...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bulk-stories-${Date.now()}.zip`;
      link.click();
      
      setIsExporting(false);
      setExportProgress(0);
      setBulkExportInfo('');
      setIsExportModalOpen(false);
    } catch (err: any) {
      if (err instanceof Error && err.message === 'Export cancelled') {
        console.log('Bulk export cancelled by user');
      } else {
        console.error('Bulk export failed', err);
      }
      setIsExporting(false);
      setExportProgress(0);
      setBulkExportInfo('');
    }
  }, [exportDuration]);

  const handleBulkImageDownload = useCallback(async () => {
    const cardElements = document.querySelectorAll('.bulk-poster-card');
    if (cardElements.length === 0) return;

    cancelExportRef.current = false;
    setIsExporting(true);
    setExportProgress(0);
    setBulkExportInfo(`Initializing bulk image export...`);

    // Dynamically import jszip inside the handler to keep initial bundle size smaller
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const total = cardElements.length;

    try {
      await new Promise(r => setTimeout(r, 500));
      if (cancelExportRef.current) throw new Error('Export cancelled');

      for (let i = 0; i < total; i++) {
        if (cancelExportRef.current) throw new Error('Export cancelled');
        const node = cardElements[i] as HTMLElement;
        setBulkExportInfo(`Exporting Image ${i + 1} of ${total}`);

        // Generate base64 dataUrl with pixelRatio 1 for extremely sharp native 1080x1920 canvas export
        const dataUrl = await toPng(node, {
          cacheBust: true,
          pixelRatio: 1,
          width: 1080,
          height: 1920,
          style: {
            transform: 'none',
            transformOrigin: 'top left',
            width: '1080px',
            height: '1920px'
          }
        });

        if (cancelExportRef.current) throw new Error('Export cancelled');

        // Parse base64 string out of the data URL
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        zip.file(`story-${i + 1}.png`, base64Data, { base64: true });

        const overallProgress = Math.floor(((i + 1) / total) * 100);
        setExportProgress(overallProgress);
      }

      if (cancelExportRef.current) throw new Error('Export cancelled');
      setBulkExportInfo('Generating ZIP file...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bulk-images-${Date.now()}.zip`;
      link.click();

      setIsExporting(false);
      setExportProgress(0);
      setBulkExportInfo('');
      setIsExportModalOpen(false);
    } catch (err: any) {
      if (err instanceof Error && err.message === 'Export cancelled') {
        console.log('Bulk image export cancelled by user');
      } else {
        console.error('Bulk image export failed', err);
      }
      setIsExporting(false);
      setExportProgress(0);
      setBulkExportInfo('');
    }
  }, []);

  const handleDownload = useCallback(async (type: 'image' | 'video' = 'image') => {
    if (previewRef.current === null) return;
    const node = previewRef.current;
    
    cancelExportRef.current = false;
    setIsExporting(true);
    
    // const { toPng, toCanvas } = await import('html-to-image');
    
    if (type === 'image') {
      setTimeout(() => {
        if (cancelExportRef.current) return;
        toPng(node, { 
          cacheBust: true,
          pixelRatio: 1,
          width: 1080,
          height: 1920,
          style: {
            transform: 'none',
            transformOrigin: 'top left',
            width: '1080px',
            height: '1920px'
          }
        })
        .then((dataUrl) => {
          if (cancelExportRef.current) return;
          const link = document.createElement('a');
          link.download = `story-image-${Date.now()}.png`;
          link.href = dataUrl;
          link.click();
          
          setTimeout(() => {
            if (cancelExportRef.current) return;
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
      // Video Export (H.264 MP4 with proper metadata)
      setExportProgress(0);
      
      setTimeout(() => {
        if (cancelExportRef.current) return;
        toCanvas(node, { 
        pixelRatio: 1,
        cacheBust: true,
        width: 1080,
        height: 1920,
        style: {
          transform: 'none',
          transformOrigin: 'top left',
          width: '1080px',
          height: '1920px'
        }
      })
        .then(async (canvas) => {
          try {
            if (cancelExportRef.current) {
              throw new Error('Export cancelled');
            }
            const blob = await recordWithFallback(canvas, exportDuration, (p) => {
              if (cancelExportRef.current) return;
              setExportProgress(p);
            }, videoBackground, bgImageOverlay);
            
            if (cancelExportRef.current) {
              throw new Error('Export cancelled');
            }

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
            link.href = url;
            link.download = `story-video-${Date.now()}.${extension}`;
            link.click();
            
            setExportProgress(0);
            setIsExporting(false);
            setIsExportModalOpen(false);
          } catch (err: any) {
            if (err instanceof Error && err.message === 'Export cancelled') {
              console.log('Video export cancelled by user');
            } else {
              console.error('Video export failed', err);
              alert('Video export failed. Your browser might not support high-quality export or the canvas is too large.');
            }
            setIsExporting(false);
            setExportProgress(0);
          }
        })
        .catch((err: any) => {
          if (err instanceof Error && err.message === 'Export cancelled') {
            console.log('Video export cancelled');
          } else {
            console.error('Video export failed', err);
          }
          setIsExporting(false);
          setExportProgress(0);
        });
      }, 500);
    }
  }, [previewRef, exportDuration, videoBackground, bgImageOverlay]);
  
  const handleRandomHighlight = (index?: number) => {
    if (activeTab === 'pictext' && isPicTextBulk && typeof index === 'number') {
      const newStories = [...picTextBulkStories];
      const rawText = newStories[index].text;
      const parts = rawText.split(/(\[\[.*?\]\])/);
      const cleanedParts = parts.map(part => {
        if (part.startsWith('[[') && part.endsWith(']]')) {
          return part;
        }
        return part.replace(/[\[\]]/g, '');
      });
      const cleanText = cleanedParts.join('');
      newStories[index].text = getRandomHighlights(cleanText);
      setPicTextBulkStories(newStories);
    } else if (isBulkMode && typeof index === 'number') {
      const newBulk = [...bulkStories];
      const rawText = newBulk[index].text;
      const parts = rawText.split(/(\[\[.*?\]\])/);
      const cleanedParts = parts.map(part => {
        if (part.startsWith('[[') && part.endsWith(']]')) {
          return part;
        }
        return part.replace(/[\[\]]/g, '');
      });
      const cleanText = cleanedParts.join('');
      newBulk[index].text = getRandomHighlights(cleanText);
      setBulkStories(newBulk);
    } else {
      const parts = storyText.split(/(\[\[.*?\]\])/);
      const cleanedParts = parts.map(part => {
        if (part.startsWith('[[') && part.endsWith(']]')) {
          return part;
        }
        return part.replace(/[\[\]]/g, '');
      });
      const cleanText = cleanedParts.join('');
      setStoryText(getRandomHighlights(cleanText));
    }
  };

  const handleRemoveHighlight = (index?: number) => {
    if (activeTab === 'pictext' && isPicTextBulk && typeof index === 'number') {
      const newStories = [...picTextBulkStories];
      const activeEl = document.activeElement as HTMLTextAreaElement;
      if (activeEl && activeEl.tagName === 'TEXTAREA' && typeof activeEl.selectionStart === 'number') {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        if (start !== end) {
          const text = newStories[index].text;
          const selectedText = text.substring(start, end);
          const cleanSelection = selectedText.replace(/[\[\]]/g, '');
          newStories[index].text = text.substring(0, start) + cleanSelection + text.substring(end);
          setPicTextBulkStories(newStories);
          return;
        }
      }
      newStories[index].text = newStories[index].text.replace(/[\[\]]/g, '');
      setPicTextBulkStories(newStories);
    } else if (isBulkMode && typeof index === 'number') {
      const newBulk = [...bulkStories];
      const activeEl = document.activeElement as HTMLTextAreaElement;
      if (activeEl && activeEl.tagName === 'TEXTAREA' && typeof activeEl.selectionStart === 'number') {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        if (start !== end) {
          const text = newBulk[index].text;
          const selectedText = text.substring(start, end);
          const cleanSelection = selectedText.replace(/[\[\]]/g, '');
          newBulk[index].text = text.substring(0, start) + cleanSelection + text.substring(end);
          setBulkStories(newBulk);
          return;
        }
      }
      newBulk[index].text = newBulk[index].text.replace(/[\[\]]/g, '');
      setBulkStories(newBulk);
    } else {
      const activeEl = document.activeElement as HTMLTextAreaElement;
      if (activeEl && activeEl.tagName === 'TEXTAREA' && typeof activeEl.selectionStart === 'number') {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        if (start !== end) {
          const selectedText = storyText.substring(start, end);
          const cleanSelection = selectedText.replace(/[\[\]]/g, '');
          setStoryText(storyText.substring(0, start) + cleanSelection + storyText.substring(end));
          return;
        }
      }
      setStoryText(storyText.replace(/[\[\]]/g, ''));
    }
  };

  const handleApplySelectionHighlight = (index: number, style: 'standard' | 'box') => {
    const isPicText = activeTab === 'pictext' && isPicTextBulk;
    const newStories = isPicText ? [...picTextBulkStories] : [...bulkStories];
    const activeEl = document.activeElement as HTMLTextAreaElement;
    if (activeEl && activeEl.tagName === 'TEXTAREA' && typeof activeEl.selectionStart === 'number') {
      const start = activeEl.selectionStart;
      const end = activeEl.selectionEnd;
      if (start !== end) {
        const text = newStories[index].text;
        const selectedText = text.substring(start, end);
        // Clean existing brackets first
        const cleanSelection = selectedText.replace(/[\[\]]/g, '');
        // Apply new brackets
        const decorated = style === 'box' ? `[[${cleanSelection}]]` : `[${cleanSelection}]`;
        const updatedText = text.substring(0, start) + decorated + text.substring(end);
        
        if (isPicText) {
          newStories[index].text = updatedText;
          setPicTextBulkStories(newStories);
        } else {
          newStories[index].text = updatedText;
          setBulkStories(newStories);
        }
        
        // Restore focus and selection
        setTimeout(() => {
          activeEl.focus();
          activeEl.setSelectionRange(start, start + decorated.length);
        }, 50);
        return;
      }
    }
  };

  const renderStoryText = (text: string, hColor: string, useBox?: boolean) => {
    // 1. Process custom highlights [[text]] (Box Highlight)
    const parts0 = text.split(/(\[\[.*?\]\])/);
    const elements0 = parts0.map((part, i) => {
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const content = part.slice(2, -2);
        return (
          <span 
            key={`box-h-${i}`} 
            style={{ backgroundColor: hColor || '#150621', color: '#ffffff' }} 
            className="px-3 py-1 rounded-md mx-1 inline-block font-extrabold shadow-sm text-white"
          >
            {content}
          </span>
        );
      }
      return part;
    });

    const isBoxStyle = useBox !== undefined ? useBox : boxHighlight;

    // 2. Process existing highlight brackets [text] (Standard Highlight)
    return elements0.map((el, i) => {
      if (typeof el !== 'string') return el;
      
      const parts1 = el.split(/(\[.*?\])/);
      return parts1.map((part, j) => {
        if (part.startsWith('[') && part.endsWith(']')) {
          const content = part.slice(1, -1);
          if (isBoxStyle) {
            return (
              <span 
                key={`h-${i}-${j}`} 
                style={{ backgroundColor: hColor, color: '#ffffff' }} 
                className="px-3 py-0.5 rounded-lg mx-1 inline-block font-extrabold shadow-sm text-white"
              >
                {content}
              </span>
            );
          } else {
            return (
              <span 
                key={`h-${i}-${j}`} 
                style={{ color: hColor }} 
                className={cn("font-bold decoration-2 underline-offset-4", highlightUnderline ? "underline" : "")}
              >
                {content}
              </span>
            );
          }
        }
        return part;
      });
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

  const posterProps = {
    bgStyle, bgColor, gradEnd, avatarBorder, avatarBorderColor, profileImage, 
    scribbleStyle, profileMove, profilePosition, cardMove, footerMove, customHighlightColor, nameFont, nameHasBg, nameSize, nameColor, posterName, 
    subFont, subtitleHasBg, subtitleSize, subtitleColor, subtitle, showPosterName, showSubtitle,
    cardColor, cardTransparency, cardRadius, cardPadding, fontFamily, 
    fontWeight, textColor, textAlign, lineHeight, letterSpacing, fontStyle, 
    showFooter, footerFont, footerBgStyle, footerBgColor, footerTextColor, 
    footerFontSize, footerText, renderStoryText, showCard, footerBorderWidth, footerBorderColor,
    bgImage, bgImageOverlay, showProfile, showDots, fullImageOnly, removePaddingWhenHidden,
    videoBackground, isExporting, boldParagraphIndex,
    storyImage, storyImageHeight, storyImageRadius, storyImageFit,
    isPicTextMode: activeTab === 'pictext'
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

      {/* Hidden Full Image Input */}
      <input 
        type="file" 
        ref={fullImageInputRef} 
        onChange={handleFullImageUpload} 
        className="hidden" 
        accept="image/*"
      />

      {/* Hidden Video BG Input */}
      <input 
        type="file" 
        ref={videoBgInputRef} 
        onChange={handleVideoBgUpload} 
        className="hidden" 
        accept="video/*"
      />

      {/* Background Music Audio Element */}
      {uploadedMusicUrl && (
        <audio 
          ref={audioElementRef}
          src={uploadedMusicUrl} 
          loop 
          muted={isMusicMuted || isExporting}
          style={{ display: 'none' }}
        />
      )}

      {/* Hidden CSV Input */}
      <input 
        type="file" 
        ref={csvInputRef} 
        onChange={handleCsvUpload} 
        className="hidden" 
        accept=".csv,text/csv"
      />

      {/* Hidden Picture & Text CSV Input */}
      <input 
        type="file" 
        ref={picTextCsvInputRef} 
        onChange={handlePicTextCsvUpload} 
        className="hidden" 
        accept=".csv,text/csv"
      />

      {/* Hidden Story Image Input */}
      <input 
        type="file" 
        ref={storyImageInputRef} 
        onChange={handleStoryImageUpload} 
        className="hidden" 
        accept="image/*"
      />

      {/* Hidden Picture & Text Bulk Story Image Input */}
      <input 
        type="file" 
        ref={bulkStoryImageInputRef} 
        className="hidden" 
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && bulkImageUploadIndex !== null) {
            const reader = new FileReader();
            reader.onload = (event) => {
              if (event.target?.result) {
                setPicTextBulkStories(prev => {
                  const copy = [...prev];
                  copy[bulkImageUploadIndex] = {
                    ...copy[bulkImageUploadIndex],
                    image: event.target.result as string
                  };
                  return copy;
                });
              }
            };
            reader.readAsDataURL(file);
          }
          e.target.value = '';
        }}
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
                <button onClick={isExporting ? handleCancelExport : () => setIsExportModalOpen(false)} className="text-gray-500 hover:text-white transition-colors">
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

                  {(isBulkMode || (activeTab === 'pictext' && isPicTextBulk)) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Bulk Video Option */}
                      <div 
                        onClick={() => !isExporting && handleBulkDownload()}
                        className={cn(
                          "p-4 rounded-xl border relative overflow-hidden text-left",
                          isExporting ? (bulkExportInfo && !bulkExportInfo.toLowerCase().includes('image') ? "border-purple-500/50 bg-[#1c2229]" : "border-[#2a2d35] bg-[#1c2229] opacity-50 cursor-not-allowed") : "border-purple-500/40 bg-[#1c2229] ring-2 ring-purple-500/10 cursor-pointer hover:bg-[#252c36] group transition-all"
                        )}
                      >
                        {isExporting && bulkExportInfo && !bulkExportInfo.toLowerCase().includes('image') && (
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${exportProgress}%` }}
                            className="absolute bottom-0 left-0 h-1 bg-purple-500 transition-all duration-300"
                          />
                        )}
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 group-hover:bg-purple-500/20">
                            {isExporting && bulkExportInfo && !bulkExportInfo.toLowerCase().includes('image') ? (
                              <Loader2 size={24} className="text-purple-400 animate-spin" />
                            ) : (
                              <PlusCircle size={24} className="text-purple-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-purple-400 text-sm">Bulk Download Video (ZIP)</h4>
                            <p className="text-[11px] text-gray-500 leading-tight mt-0.5">Render all {activeTab === 'pictext' ? picTextBulkStories.filter(s => s.text.trim().length > 0 || s.image).length : bulkStories.filter(s => s.text.trim().length > 0).length} stories into a ZIP</p>
                            {isExporting && bulkExportInfo && !bulkExportInfo.toLowerCase().includes('image') && (
                              <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mt-1.5">{bulkExportInfo} · {exportProgress}%</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Bulk Image Option */}
                      <div 
                        onClick={() => !isExporting && handleBulkImageDownload()}
                        className={cn(
                          "p-4 rounded-xl border relative overflow-hidden text-left",
                          isExporting ? (bulkExportInfo && bulkExportInfo.toLowerCase().includes('image') ? "border-emerald-500/50 bg-[#1c2229]" : "border-[#2a2d35] bg-[#1c2229] opacity-50 cursor-not-allowed") : "border-emerald-500/40 bg-[#1c2229] ring-2 ring-emerald-500/10 cursor-pointer hover:bg-[#252c36] group transition-all"
                        )}
                      >
                        {isExporting && bulkExportInfo && bulkExportInfo.toLowerCase().includes('image') && (
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${exportProgress}%` }}
                            className="absolute bottom-0 left-0 h-1 bg-emerald-500 transition-all duration-300"
                          />
                        )}
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20">
                            {isExporting && bulkExportInfo && bulkExportInfo.toLowerCase().includes('image') ? (
                              <Loader2 size={24} className="text-emerald-400 animate-spin" />
                            ) : (
                              <ImageIcon size={24} className="text-emerald-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-emerald-400 text-sm">Bulk Download Images (ZIP)</h4>
                            <p className="text-[11px] text-gray-500 leading-tight mt-0.5">Render all {activeTab === 'pictext' ? picTextBulkStories.filter(s => s.text.trim().length > 0 || s.image).length : bulkStories.filter(s => s.text.trim().length > 0).length} pages as high-quality PNG ZIP</p>
                            {isExporting && bulkExportInfo && bulkExportInfo.toLowerCase().includes('image') && (
                              <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mt-1.5">{bulkExportInfo} · {exportProgress}%</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

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

                {isExporting ? (
                  <button 
                    onClick={handleCancelExport}
                    className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
                  >
                    <X size={18} /> Cancel Download
                  </button>
                ) : (
                  <button 
                    onClick={() => handleDownload('video')}
                    className="w-full flex items-center justify-center gap-2 bg-[#8ab4f8] hover:bg-[#a1c2fa] text-black font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-[0.98]"
                  >
                    <Download size={18} /> Export Video
                  </button>
                )}
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
            { id: 'profile', icon: User, label: 'Profile' },
            { id: 'typography', icon: Type, label: 'Typography' },
            { id: 'background', icon: ImageIcon, label: 'Background/Overlay' },
            { id: 'footer', icon: Layout, label: 'Footer Settings' },
            { id: 'pictext', icon: FileImage, label: 'Picture & Text Layout' },
          ] as const ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              title={tab.label}
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
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div className="flex items-center justify-between p-3 bg-blue-500/5 rounded-xl border border-blue-500/10">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-blue-400">Title View</span>
                      </div>
                      <div 
                        onClick={() => setShowPosterName(!showPosterName)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", showPosterName ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", showPosterName ? "left-6" : "left-1")}></div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-blue-500/5 rounded-xl border border-blue-500/10">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-blue-400">Sub-title View</span>
                      </div>
                      <div 
                        onClick={() => setShowSubtitle(!showSubtitle)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", showSubtitle ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", showSubtitle ? "left-6" : "left-1")}></div>
                      </div>
                    </div>
                  </div>
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
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">Name / Title Size</span>
                        <button onClick={() => setNameSize(82)} title="Reset to 82px" className="text-gray-500 hover:text-blue-400 transition-colors">
                          <RotateCcw size={10} />
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">{nameSize} px</span>
                    </div>
                    <input type="range" min="20" max="150" value={nameSize} onChange={(e) => setNameSize(parseInt(e.target.value))} className="w-full" />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1">Name Color</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={nameColor} onChange={(e) => setNameColor(e.target.value)} className="w-12 h-12 rounded-lg border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                        <input 
                          type="text" 
                          value={nameColor} 
                          onChange={(e) => setNameColor(e.target.value)} 
                          className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                          placeholder="#000"
                        />
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
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">Subtitle Size</span>
                        <button onClick={() => setSubtitleSize(44)} title="Reset to 44px" className="text-gray-500 hover:text-blue-400 transition-colors">
                          <RotateCcw size={10} />
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">{subtitleSize} px</span>
                    </div>
                    <input type="range" min="10" max="100" value={subtitleSize} onChange={(e) => setSubtitleSize(parseInt(e.target.value))} className="w-full" />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1">Sub Color</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={subtitleColor} onChange={(e) => setSubtitleColor(e.target.value)} className="w-12 h-12 rounded-lg border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                        <input 
                          type="text" 
                          value={subtitleColor} 
                          onChange={(e) => setSubtitleColor(e.target.value)} 
                          className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                          placeholder="#000"
                        />
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
                    <div className="flex items-center gap-3">
                      <input type="color" value={avatarBorderColor} onChange={(e) => setAvatarBorderColor(e.target.value)} className="w-12 h-12 rounded-xl cursor-pointer bg-transparent border border-[#353941]" />
                      <input 
                        type="text" 
                        value={avatarBorderColor} 
                        onChange={(e) => setAvatarBorderColor(e.target.value)} 
                        className="w-24 bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                        placeholder="#fff"
                      />
                    </div>
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
                     <option value="blur">Blur (all)</option>
                     <option value="title-blur">Title Blur</option>
                     <option value="squiggle">Squiggle (wavy)</option>
                     <option value="solid">Solid bar</option>
                     <option value="mosaic">Mosaic</option>
                   </select>
                </div>

                <div className="mt-4">
                  <label className="text-xs text-gray-400 block mb-1">Profile Position</label>
                  <select 
                    value={profilePosition}
                    onChange={(e) => setProfilePosition(e.target.value)}
                    className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500 mb-4"
                  >
                    <option value="outside">Outside Card</option>
                    <option value="inside">Inside Card</option>
                  </select>
                </div>

                <div className="mt-4">
                  <div className="flex justify-between mb-1 items-center">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-gray-400 block">Profile Move (Upward)</label>
                      <button onClick={() => setProfileMove(0)} title="Reset to 0px" className="text-gray-500 hover:text-blue-400 transition-colors">
                        <RotateCcw size={10} />
                      </button>
                    </div>
                    <span className="text-xs text-gray-500">{profileMove}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="400" 
                    step="1"
                    value={profileMove}
                    onChange={(e) => setProfileMove(parseInt(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>

                <div className="mt-4">
                  <div className="flex justify-between mb-1 items-center">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-gray-400 block">Card Move (Vertical)</label>
                      <button onClick={() => setCardMove(0)} title="Reset to 0px" className="text-gray-500 hover:text-blue-400 transition-colors">
                        <RotateCcw size={10} />
                      </button>
                    </div>
                    <span className="text-xs text-gray-500">{cardMove}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="-400" 
                    max="400" 
                    step="1"
                    value={cardMove}
                    onChange={(e) => setCardMove(parseInt(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>

                <div className="pt-4 border-t border-[#2a2d35]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Show Profile Section</span>
                    <div 
                      onClick={() => setShowProfile(!showProfile)}
                      className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", showProfile ? "bg-blue-500" : "bg-[#2a2d35]")}
                    >
                      <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", showProfile ? "left-6" : "left-1")}></div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'typography' && (
              <motion.div
                key="typography"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6 pb-20"
              >
                <div className="space-y-4">
                  <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Text Highlight Style</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-500">Highlight</label>
                        <div className="flex items-center gap-3">
                          <input 
                            type="color" 
                            value={highlightColor} 
                            onChange={(e) => {
                              const val = e.target.value;
                              setHighlightColor(val);
                              if (isBulkMode) {
                                setBulkStories(prev => prev.map(s => ({ ...s, highlightColor: val })));
                              }
                            }} 
                            className="w-12 h-12 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" 
                          />
                          <input 
                            type="text" 
                            value={highlightColor} 
                            onChange={(e) => {
                              const val = e.target.value;
                              setHighlightColor(val);
                              if (isBulkMode) {
                                setBulkStories(prev => prev.map(s => ({ ...s, highlightColor: val })));
                              }
                            }} 
                            className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                            placeholder="#000"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-gray-500">Box Background</label>
                        <div className="flex items-center gap-3">
                          <input type="color" value={customHighlightColor} onChange={(e) => setCustomHighlightColor(e.target.value)} className="w-12 h-12 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                          <input 
                            type="text" 
                            value={customHighlightColor} 
                            onChange={(e) => setCustomHighlightColor(e.target.value)} 
                            className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                            placeholder="#000"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Default Text Color</label>
                    <div className="flex items-center gap-3">
                      <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-12 h-12 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                      <input 
                        type="text" 
                        value={textColor} 
                        onChange={(e) => setTextColor(e.target.value)} 
                        className="flex-1 bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                        placeholder="#000000"
                      />
                    </div>
                  </div>
                </div>

                {!isBulkMode && (
                  <div className="space-y-2 mt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => handleRandomHighlight()}
                        className="flex items-center justify-center gap-1.5 bg-[#8ab4f8] hover:bg-[#a1c2fa] text-black font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-[0.98] text-xs"
                      >
                        <Zap size={14} /> HIGHLIGHT
                      </button>
                      <button 
                        onClick={() => handleRemoveHighlight()}
                        className="flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-[0.98] text-xs"
                      >
                        <Trash2 size={14} /> REMOVE CLR
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500 text-center italic px-4">Select text in area to remove its highlight, or click Remove with no selection to clear all highlights.</p>
                  </div>
                )}

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  MODE SELECTION
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs text-gray-400">Bulk Mode</span>
                    <span className="text-[10px] text-gray-500">Create multiple stories at once</span>
                  </div>
                  <div 
                    onClick={() => setIsBulkMode(!isBulkMode)}
                    className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", isBulkMode ? "bg-blue-500" : "bg-[#2a2d35]")}
                  >
                    <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", isBulkMode ? "left-6" : "left-1")}></div>
                  </div>
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  TYPOGRAPHY
                </div>                {!isBulkMode ? (
                  <div className="space-y-4">
                    {/* Story Inline Image Upload */}
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Inline Top Image</label>
                        {storyImage && (
                          <button 
                            onClick={() => setStoryImage(null)}
                            className="text-[10px] text-red-400 hover:text-red-300 transition-colors font-bold flex items-center gap-1"
                          >
                            <Trash2 size={12} /> REMOVE
                          </button>
                        )}
                      </div>

                      {!storyImage ? (
                        <div 
                          onClick={() => storyImageInputRef.current?.click()}
                          className="border-2 border-dashed border-[#353941] hover:border-blue-500/50 bg-[#1a1d23]/50 hover:bg-blue-500/5 rounded-xl p-4 text-center cursor-pointer transition-all space-y-1.5"
                          onDragOver={(e) => {
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files?.[0];
                            if (file && file.type.startsWith('image/')) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                if (event.target?.result) {
                                  setStoryImage(event.target.result as string);
                                }
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        >
                          <Upload className="mx-auto text-gray-500" size={24} />
                          <p className="text-xs font-bold text-gray-300">Upload inline story image</p>
                          <p className="text-[10px] text-gray-500 uppercase">Click or Drag & Drop</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 bg-[#1a1d23] p-2 rounded-lg border border-[#353941]">
                            <img 
                              src={storyImage} 
                              alt="Upload Preview" 
                              className="w-12 h-12 rounded object-cover border border-[#2a2d35]" 
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-300 font-medium truncate">Uploaded Image</p>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Top of card</p>
                            </div>
                            <button 
                              onClick={() => storyImageInputRef.current?.click()}
                              className="text-[10px] px-2.5 py-1 bg-[#2a2d35] hover:bg-[#353941] rounded font-bold text-blue-400 transition-all"
                            >
                              CHANGE
                            </button>
                          </div>

                          <div className="space-y-2 pt-1 border-t border-[#2a2d35]/50">
                            <div>
                              <div className="flex justify-between text-[10px] text-gray-500">
                                <span>IMAGE HEIGHT</span>
                                <span>{storyImageHeight}px</span>
                              </div>
                              <input 
                                type="range" 
                                min="100" 
                                max="1200" 
                                step="10"
                                value={storyImageHeight}
                                onChange={(e) => setStoryImageHeight(parseInt(e.target.value))}
                                className="w-full accent-blue-500"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-gray-500 block mb-1">IMAGE FIT</label>
                                <select 
                                  value={storyImageFit}
                                  onChange={(e: any) => setStoryImageFit(e.target.value)}
                                  className="w-full bg-[#1a1d23] border border-[#30343c] rounded p-1.5 text-xs text-gray-300 outline-none"
                                >
                                  <option value="cover">Cover (crop)</option>
                                  <option value="contain">Contain (fit)</option>
                                  <option value="fill">Fill (stretch)</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 block mb-1">CORNERS</label>
                                <select 
                                  value={storyImageRadius}
                                  onChange={(e: any) => setStoryImageRadius(parseInt(e.target.value))}
                                  className="w-full bg-[#1a1d23] border border-[#30343c] rounded p-1.5 text-xs text-gray-300 outline-none"
                                >
                                  <option value="0">Sharp (0px)</option>
                                  <option value="8">Small (8px)</option>
                                  <option value="16">Medium (16px)</option>
                                  <option value="24">Large (24px)</option>
                                  <option value="36">Card Radius</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-gray-400">Story Content</label>
                        <div className="flex items-center gap-1.5">
                          <button 
                            onClick={() => handleRandomHighlight()}
                            className="flex items-center gap-1.5 px-2 py-1 bg-[#2a2d35] hover:bg-[#353941] rounded text-[10px] text-blue-400 hover:text-blue-300 transition-all font-bold"
                          >
                            <Zap size={10} /> RANDOM HIGHLIGHT
                          </button>
                          <button 
                            onClick={() => handleRemoveHighlight()}
                            className="flex items-center gap-1.5 px-2 py-1 bg-red-950/20 border border-red-900/40 hover:bg-red-950/40 rounded text-[10px] text-red-400 hover:text-red-300 transition-all font-bold"
                          >
                            <Trash2 size={10} /> REMOVE HIGHLIGHT
                          </button>
                        </div>
                      </div>
                      <textarea 
                        value={storyText}
                        onChange={(e) => setStoryText(e.target.value)}
                        rows={6}
                        placeholder="Type your story here."
                        className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none"
                      />

                      {/* Bold Specific Paragraph Selector */}
                      <div className="mt-3 p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Bold Paragraph Only</label>
                        <select 
                          value={boldParagraphIndex === null ? 'none' : boldParagraphIndex}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBoldParagraphIndex(val === 'none' ? null : parseInt(val));
                          }}
                          className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 text-gray-300"
                        >
                          <option value="none">None (Regular Weight)</option>
                          {storyText.split('\n').map((para, idx) => {
                            const cleanPara = para.trim();
                            const displayNum = idx + 1;
                            const previewText = cleanPara.length > 30 ? cleanPara.substring(0, 30) + '...' : cleanPara;
                            return (
                              <option key={idx} value={idx}>
                                Paragraph {displayNum}: {cleanPara.length > 0 ? previewText : '(Empty Line)'}
                              </option>
                            );
                          })}
                        </select>
                        <p className="text-[9px] text-gray-500 italic font-medium">Bolds a selected paragraph only, leaving others unaffected</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* CSV Upload Button */}
                    <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <h4 className="text-xs font-bold text-blue-400">Import from CSV</h4>
                        <p className="text-[10px] text-gray-500">Upload a list of stories</p>
                      </div>
                      <button 
                        onClick={() => csvInputRef.current?.click()}
                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-bold rounded transition-colors flex items-center gap-1.5"
                      >
                        <Upload size={14} /> UPLOAD CSV
                      </button>
                    </div>

                    {bulkStories.map((story, index) => (
                      <div key={index} className="p-4 bg-[#1c2229] rounded-xl border border-[#2a2d35] space-y-4">
                         <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                           <div className="flex items-center gap-2">
                             <span className="text-[10px] font-black text-gray-500 tracking-[0.2em] uppercase">STORY #{index + 1}</span>
                             <div className="flex items-center gap-1.5 border-l border-r border-[#21252d] px-2.5 mx-1">
                               <button 
                                 onClick={() => moveBulkStoryUp(index)}
                                 disabled={index === 0}
                                 className={cn("transition-colors p-0.5 hover:bg-[#252b35] rounded", index === 0 ? "text-gray-800 cursor-not-allowed" : "text-gray-400 hover:text-blue-400")}
                                 title="Move Up"
                               >
                                 <ChevronUp size={14} />
                               </button>
                               <button 
                                 onClick={() => moveBulkStoryDown(index)}
                                 disabled={index === bulkStories.length - 1}
                                 className={cn("transition-colors p-0.5 hover:bg-[#252b35] rounded", index === bulkStories.length - 1 ? "text-gray-800 cursor-not-allowed" : "text-gray-400 hover:text-blue-400")}
                                 title="Move Down"
                               >
                                 <ChevronDown size={14} />
                               </button>
                               <button 
                                 onClick={() => duplicateBulkStory(index)}
                                 className="text-gray-400 hover:text-blue-400 p-0.5 hover:bg-[#252b35] rounded transition-colors ml-0.5"
                                 title="Duplicate Card"
                               >
                                 <Copy size={12} />
                               </button>
                             </div>
                             {bulkStories.length > 1 && (
                               <button 
                                 onClick={() => removeBulkStory(index)}
                                 className="text-gray-600 hover:text-red-400 transition-colors"
                                 title="Remove Story"
                               >
                                 <Trash2 size={12} />
                               </button>
                             )}
                           </div>
                           <div className="flex items-center gap-1.5 flex-wrap justify-end">
                             <button 
                                onClick={() => handleApplySelectionHighlight(index, 'standard')}
                                className="flex items-center gap-0.5 text-[10px] text-indigo-400 font-bold hover:text-indigo-300 transition-colors bg-[#202530] hover:bg-[#282e3c] px-1.5 py-0.5 rounded border border-indigo-950/40"
                                title="Select text in the editor below and click this to apply a standard highlight"
                             >
                               <Zap size={10} /> ⭐ HIGHLIGHT
                             </button>
                             <span className="text-gray-800 text-[10px] select-none">|</span>
                             <button 
                                onClick={() => handleApplySelectionHighlight(index, 'box')}
                                className="flex items-center gap-0.5 text-[10px] text-amber-400 font-bold hover:text-amber-300 transition-colors bg-[#252320] hover:bg-[#302c28] px-1.5 py-0.5 rounded border border-amber-950/40"
                                title="Select text in the editor below and click this to apply a solid box highlight"
                             >
                               📦 BOX
                             </button>
                             <span className="text-gray-800 text-[10px] select-none">|</span>
                             <button 
                                onClick={() => handleRandomHighlight(index)}
                                className="flex items-center gap-0.5 text-[10px] text-blue-400 font-bold hover:text-blue-300 transition-colors bg-[#112030] hover:bg-[#152a40] px-1.5 py-0.5 rounded border border-blue-950/40"
                             >
                               <Zap size={10} /> RANDOM
                             </button>
                             <span className="text-gray-800 text-[10px] select-none">|</span>
                             <button 
                                onClick={() => handleRemoveHighlight(index)}
                                className="flex items-center gap-0.5 text-[10px] text-red-400 font-bold hover:text-red-350 transition-all bg-[#2a1315] hover:bg-[#3d1a1e] px-1.5 py-0.5 rounded border border-red-950/40"
                             >
                               <Trash2 size={10} /> REMOVE
                             </button>
                           </div>
                        </div>
                        
                        <textarea 
                          value={story.text}
                          onChange={(e) => {
                            const newBulk = [...bulkStories];
                            newBulk[index].text = e.target.value;
                            setBulkStories(newBulk);
                          }}
                          rows={4}
                          placeholder={`Enter Story ${index + 1}...`}
                          className="w-full bg-[#14161b] border border-[#2a2d35] rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none"
                        />

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                              <span>Font Size</span>
                              <span>{story.fontSize}px</span>
                            </div>
                            <input 
                              type="range" 
                              min="12" 
                              max="100" 
                              value={story.fontSize} 
                              onChange={(e) => {
                                const newBulk = [...bulkStories];
                                newBulk[index].fontSize = parseInt(e.target.value);
                                setBulkStories(newBulk);
                              }} 
                              className="w-full accent-blue-500" 
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-1">Highlight</label>
                            <div className="flex items-center gap-3 text-left">
                              <input 
                                type="color" 
                                value={story.highlightColor} 
                                onChange={(e) => {
                                  const newBulk = [...bulkStories];
                                  newBulk[index].highlightColor = e.target.value;
                                  setBulkStories(newBulk);
                                }} 
                                className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-[#2a2d35] p-0 flex-shrink-0" 
                              />
                              <input 
                                type="text" 
                                value={story.highlightColor} 
                                onChange={(e) => {
                                  const newBulk = [...bulkStories];
                                  newBulk[index].highlightColor = e.target.value;
                                  setBulkStories(newBulk);
                                }} 
                                className="flex-1 bg-[#14161b] border border-[#2a2d35] rounded-lg px-3 py-2 text-[10px] font-mono outline-none focus:border-blue-500" 
                                placeholder="#000"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2.5 border-t border-[#252a32]">
                          <label className="flex items-center gap-2 cursor-pointer text-[10px] text-gray-400 hover:text-gray-300 font-bold uppercase tracking-wider">
                            <input 
                              type="checkbox" 
                              checked={!!story.boxHighlight} 
                              onChange={(e) => {
                                const newBulk = [...bulkStories];
                                newBulk[index].boxHighlight = e.target.checked;
                                setBulkStories(newBulk);
                              }}
                              className="w-3.5 h-3.5 rounded bg-[#14161b] border border-[#2a2d35] text-blue-500 focus:ring-0 cursor-pointer"
                            />
                            <span>Use Solid Box Highlight Accent</span>
                          </label>
                        </div>
                      </div>
                    ))}

                    <button 
                      onClick={addBulkStory}
                      className="w-full py-4 border-2 border-dashed border-[#2a2d35] rounded-xl text-gray-500 hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-[10px] font-black tracking-widest flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> ADD NEW STORY
                    </button>
                  </div>
                )}

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
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                       <div 
                        onClick={() => setHighlightUnderline(!highlightUnderline)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", highlightUnderline ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", highlightUnderline ? "left-6" : "left-1")}></div>
                      </div>
                      <span className="text-xs text-gray-400">Underline</span>
                    </div>

                    <div className="flex items-center gap-2">
                       <div 
                        onClick={() => setBoxHighlight(!boxHighlight)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", boxHighlight ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", boxHighlight ? "left-6" : "left-1")}></div>
                      </div>
                      <span className="text-xs text-gray-400">Solid Box</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">Font Size</span>
                        <button onClick={() => setFontSize(62)} title="Reset to 62px" className="text-gray-500 hover:text-blue-400 transition-colors">
                          <RotateCcw size={10} />
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">{fontSize} px</span>
                    </div>
                    <input type="range" min="12" max="100" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">Line Height</span>
                        <button onClick={() => setLineHeight(1.25)} title="Reset to 1.25x" className="text-gray-500 hover:text-blue-400 transition-colors">
                          <RotateCcw size={10} />
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">{lineHeight}x</span>
                    </div>
                    <input type="range" min="1" max="2.5" step="0.1" value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">Letter Spacing</span>
                        <button onClick={() => setLetterSpacing(0)} title="Reset to 0px" className="text-gray-500 hover:text-blue-400 transition-colors">
                          <RotateCcw size={10} />
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">{letterSpacing} px</span>
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
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => bgFileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white font-bold py-3 rounded-xl transition-all shadow-lg active:scale-[0.98]"
                    >
                      <Upload size={16} /> {bgImage ? 'CHANGE BACKGROUND' : 'UPLOAD BACKGROUND'}
                    </button>
                    {bgImage && (
                      <button 
                        onClick={() => {
                          setBgImage(null);
                          setBgStyle('solid');
                        }}
                        className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-bold py-2 rounded-lg transition-all border border-red-500/20 uppercase"
                      >
                        <X size={14} /> Remove Background
                      </button>
                    )}
                  </div>
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
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Dark Overlay</span>
                          <button onClick={() => setBgImageOverlay(20)} title="Reset to 20%" className="text-gray-500 hover:text-blue-400 transition-colors">
                            <RotateCcw size={10} />
                          </button>
                        </div>
                        <span className="text-xs text-gray-500">{bgImageOverlay}%</span>
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

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2">
                       <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Background Color</label>
                       <div className="flex items-center gap-2">
                         <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-14 h-14 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                         <input 
                           type="text" 
                           value={bgColor} 
                           onChange={(e) => setBgColor(e.target.value)} 
                           className="flex-1 bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-3 text-sm font-mono outline-none focus:border-blue-500" 
                           placeholder="#000000"
                         />
                       </div>
                    </div>
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2">
                       <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Card Color</label>
                       <div className="flex items-center gap-2">
                         <input type="color" value={cardColor} onChange={(e) => setCardColor(e.target.value)} className="w-14 h-14 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                         <input 
                           type="text" 
                           value={cardColor} 
                           onChange={(e) => setCardColor(e.target.value)} 
                           className="flex-1 bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-3 text-sm font-mono outline-none focus:border-blue-500" 
                           placeholder="#000000"
                         />
                       </div>
                    </div>
                  </div>
                  {bgStyle === 'gradient' && (
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                       <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Gradient End</label>
                       <div className="flex items-center gap-4">
                         <input type="color" value={gradEnd} onChange={(e) => setGradEnd(e.target.value)} className="w-12 h-12 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                         <input 
                           type="text" 
                           value={gradEnd} 
                           onChange={(e) => setGradEnd(e.target.value)} 
                           className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-blue-500" 
                           placeholder="#000000"
                         />
                         <div className="flex-1 h-px bg-[#353941]" />
                       </div>
                    </div>
                  )}
                </div>

                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  CARD SETTINGS
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-2 font-bold">Card Video Background</label>
                    <div className="flex flex-col gap-2 mb-4">
                      <button 
                        onClick={() => videoBgInputRef.current?.click()}
                        className={cn(
                          "w-full flex items-center justify-center gap-2 font-bold py-3 rounded-xl transition-all shadow-lg active:scale-[0.98]",
                          videoBackground 
                            ? "bg-purple-600 hover:bg-purple-700 text-white" 
                            : "bg-[#2a2d35] hover:bg-[#353941] text-gray-300 border border-[#353941]"
                        )}
                      >
                        <Film size={16} /> {videoBackground ? 'CHANGE CARD VIDEO' : 'UPLOAD CARD VIDEO'}
                      </button>
                      {videoBackground && (
                        <button 
                          onClick={() => {
                            setVideoBackground(null);
                            if (previousBgStyle) {
                              setBgStyle(previousBgStyle);
                              setPreviousBgStyle(null);
                            }
                          }}
                          className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-bold py-2 rounded-lg transition-all border border-red-500/20 uppercase"
                        >
                          <X size={14} /> Remove Card Video
                        </button>
                      )}
                    </div>
                  </div>

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
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Card Radius</span>
                          <button onClick={() => setCardRadius(36)} title="Reset to 36px" className="text-gray-500 hover:text-blue-400 transition-colors">
                            <RotateCcw size={10} />
                          </button>
                        </div>
                        <span className="text-xs text-gray-500">{cardRadius}px</span>
                      </div>
                      <input type="range" min="0" max="60" value={cardRadius} onChange={(e) => setCardRadius(parseInt(e.target.value))} className="w-full" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Card Padding</span>
                          <button onClick={() => setCardPadding(60)} title="Reset to 60px" className="text-gray-500 hover:text-blue-400 transition-colors">
                            <RotateCcw size={10} />
                          </button>
                        </div>
                        <span className="text-xs text-gray-500">{cardPadding}px</span>
                      </div>
                      <input type="range" min="10" max="60" value={cardPadding} onChange={(e) => setCardPadding(parseInt(e.target.value))} className="w-full" />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">Card Transparency</span>
                          <button onClick={() => setCardTransparency(100)} title="Reset to 100%" className="text-gray-500 hover:text-blue-400 transition-colors">
                            <RotateCcw size={10} />
                          </button>
                        </div>
                        <span className="text-xs text-gray-500">{cardTransparency}%</span>
                      </div>
                      <input type="range" min="0" max="100" value={cardTransparency} onChange={(e) => setCardTransparency(parseInt(e.target.value))} className="w-full" />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#2a2d35] space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs text-gray-400">Remove Padding When Hidden</span>
                        <span className="text-[10px] text-gray-500">Remove gaps when card is disabled</span>
                      </div>
                      <div 
                        onClick={() => setRemovePaddingWhenHidden(!removePaddingWhenHidden)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", removePaddingWhenHidden ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", removePaddingWhenHidden ? "left-6" : "left-1")}></div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Show Design Dots</span>
                      <div 
                        onClick={() => setShowDots(!showDots)}
                        className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", showDots ? "bg-blue-500" : "bg-[#2a2d35]")}
                      >
                        <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", showDots ? "left-6" : "left-1")}></div>
                      </div>
                    </div>
                  </div>

                  {/* Background Music Option */}
                  <div className="pt-4 border-t border-[#2a2d35] space-y-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-2">Background Music</label>
                      <input 
                        type="file" 
                        ref={musicFileInputRef} 
                        onChange={handleMusicUpload} 
                        accept="audio/*, video/mp4, video/*" 
                        className="hidden" 
                      />
                      <div className="flex flex-col gap-2">
                        <button 
                          onClick={() => musicFileInputRef.current?.click()}
                          disabled={isMusicDecoding}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 font-bold py-3 rounded-xl transition-all shadow-lg active:scale-[0.98]",
                            isMusicDecoding
                              ? "bg-amber-600 text-white animate-pulse"
                              : uploadedMusicUrl 
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white" 
                                : "bg-[#2a2d35] hover:bg-[#353941] text-gray-300 border border-[#353941]"
                          )}
                        >
                          <Music size={16} className={cn(isMusicDecoding && "animate-spin")} /> 
                          {isMusicDecoding 
                            ? 'EXTRACTING AUDIO...' 
                            : uploadedMusicUrl 
                              ? 'CHANGE BACKGROUND MUSIC' 
                              : 'ADD BACKGROUND MUSIC (MP3/MP4)'}
                        </button>
                        {uploadedMusicUrl && !isMusicDecoding && (
                          <div className="flex items-center gap-2 w-full">
                            <button 
                              onClick={() => setIsMusicMuted(!isMusicMuted)}
                              className="flex-1 flex items-center justify-center gap-2 bg-[#2a2d35] hover:bg-[#353941] text-gray-300 border border-[#353941] py-2 rounded-lg text-xs font-bold transition-all"
                              title={isMusicMuted ? "Unmute Preview" : "Mute Preview"}
                            >
                              {isMusicMuted ? (
                                <>
                                  <VolumeX size={14} className="text-red-400" />
                                  <span>UNMUTE PREVIEW</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 size={14} className="text-green-400" />
                                  <span>MUTE PREVIEW</span>
                                </>
                              )}
                            </button>
                            <button 
                              onClick={() => {
                                setUploadedMusicFile(null);
                                setUploadedMusicUrl(null);
                                setUploadedMusicBuffer(null);
                              }}
                              className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-all"
                              title="Remove Music"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      
                      {isMusicDecoding && (
                        <p className="text-[10px] text-amber-400 mt-2 text-center font-bold animate-pulse">
                          ⏳ Extracting only the audio track from the media file...
                        </p>
                      )}

                      {!isMusicDecoding && uploadedMusicFile && (
                        <div className="mt-2 p-2.5 bg-[#2a2d35]/50 rounded-lg border border-[#353941] text-center">
                          <p className="text-[10px] text-emerald-400 font-bold truncate">
                            {uploadedMusicFile.type.startsWith('video/') ? '🎬 Video Audio Extracted:' : '🎵 Audio Loaded:'} {uploadedMusicFile.name}
                          </p>
                          {uploadedMusicBuffer && (
                            <p className="text-[9px] text-gray-400 mt-0.5 font-medium">
                              {uploadedMusicFile.type.startsWith('video/') ? 'Extracted AAC Stream' : 'Mpeg Audio Stream'} • {(uploadedMusicBuffer.sampleRate / 1000).toFixed(1)}kHz • {uploadedMusicBuffer.numberOfChannels === 2 ? 'Stereo' : 'Mono'} • {Math.round(uploadedMusicBuffer.duration)}s
                            </p>
                          )}
                        </div>
                      )}

                      {!uploadedMusicFile && !isMusicDecoding && (
                        <p className="text-[9px] text-gray-500 mt-2 text-center leading-relaxed">
                          Supports MP3 audio files or any MP4 video files. Upload an MP4 and the system will instantly extract and sync its audio track as your background music!
                        </p>
                      )}
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
                   <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">Footer Font Size</span>
                        <button onClick={() => setFooterFontSize(32)} title="Reset to 32px" className="text-gray-500 hover:text-blue-400 transition-colors">
                          <RotateCcw size={10} />
                        </button>
                      </div>
                      <span className="text-xs text-gray-500">{footerFontSize} px</span>
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
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 block mb-1">Footer BG Color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={footerBgColor === 'transparent' ? '#000000' : footerBgColor} onChange={(e) => setFooterBgColor(e.target.value)} className="w-12 h-12 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                      <input 
                        type="text" 
                        value={footerBgColor === 'transparent' ? 'transparent' : footerBgColor} 
                        onChange={(e) => setFooterBgColor(e.target.value)} 
                        className="w-full bg-[#2a2d35] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                        placeholder="#000"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400 block mb-1">Footer Text Color</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={footerTextColor} onChange={(e) => setFooterTextColor(e.target.value)} className="w-12 h-12 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                      <input 
                        type="text" 
                        value={footerTextColor} 
                        onChange={(e) => setFooterTextColor(e.target.value)} 
                        className="w-full bg-[#2a2d35] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                        placeholder="#fff"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1 items-center">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-gray-400 block">Footer Move (Vertical)</label>
                      <button onClick={() => setFooterMove(0)} title="Reset to 0px" className="text-gray-500 hover:text-blue-400 transition-colors">
                        <RotateCcw size={10} />
                      </button>
                    </div>
                    <span className="text-xs text-gray-500">{footerMove}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="-400" 
                    max="400" 
                    step="1"
                    value={footerMove}
                    onChange={(e) => setFooterMove(parseInt(e.target.value))}
                    className="w-full accent-blue-500"
                  />
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
                    <div className="flex items-center gap-2">
                      <input type="color" value={footerBorderColor} onChange={(e) => setFooterBorderColor(e.target.value)} className="w-12 h-12 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" />
                      <input 
                        type="text" 
                        value={footerBorderColor} 
                        onChange={(e) => setFooterBorderColor(e.target.value)} 
                        className="w-full bg-[#2a2d35] border border-[#353941] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-blue-500" 
                        placeholder="#fff"
                      />
                    </div>
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

            {activeTab === 'pictext' && (
              <motion.div
                key="pictext"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <div className="text-center font-bold text-[10px] text-gray-600 tracking-widest border-t border-b border-[#2a2d35] py-2 uppercase">
                  Layout: Picture & Text
                </div>

                {/* Single / Bulk Mode Toggle Selector */}
                <div className="flex bg-[#1a1d23] p-1 rounded-xl border border-[#2a2d35]">
                  <button
                    onClick={() => setIsPicTextBulk(false)}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all uppercase",
                      !isPicTextBulk ? "bg-blue-500 text-white" : "text-gray-400 hover:text-white"
                    )}
                  >
                    Single Entry
                  </button>
                  <button
                    onClick={() => setIsPicTextBulk(true)}
                    className={cn(
                      "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all uppercase",
                      isPicTextBulk ? "bg-blue-500 text-white" : "text-gray-400 hover:text-white"
                    )}
                  >
                    Bulk Mode
                  </button>
                </div>

                {!isPicTextBulk ? (
                  <>
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
                      <p className="font-semibold mb-1">Picture & Text Mode Active</p>
                      Choose a template preset to style the page background and text font/color with absolutely no card outlines, borders, profile details, or dot grids.
                    </div>

                    {/* Template Preset Selector (No Card) */}
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2">
                      <label className="text-[10px] uppercase tracking-wider text-gray-500 font-bold block mb-1">Style Preset</label>
                      <div className="relative group">
                        <select 
                          value={selectedPresetId}
                          onChange={(e) => applyPreset(e.target.value)}
                          className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs appearance-none outline-none focus:border-blue-500/50 transition-all hover:bg-[#212830] cursor-pointer text-gray-300"
                        >
                          {['Bold', 'Minimal', 'Warm', 'Cool', 'Dark'].map((category) => {
                            const categoryPresets = TEMPLATE_PRESETS.filter(p => p.category === category);
                            if (categoryPresets.length === 0) return null;
                            
                            return (
                              <optgroup key={category} label={category.toUpperCase()} className="bg-[#1c2229] text-gray-400 font-bold">
                                {categoryPresets.map((preset) => (
                                  <option key={preset.id} value={preset.id} className="text-gray-200 py-1.5">
                                    {preset.name}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none group-focus-within:text-blue-500 transition-colors" />
                      </div>
                    </div>

                    {/* Inline Image Upload */}
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Core Layout Image</label>
                        {storyImage && (
                          <button 
                            onClick={() => setStoryImage(null)}
                            className="text-[10px] text-red-400 hover:text-red-300 transition-colors font-bold flex items-center gap-1"
                          >
                            <Trash2 size={12} /> REMOVE
                          </button>
                        )}
                      </div>

                      {!storyImage ? (
                        <div 
                          onClick={() => storyImageInputRef.current?.click()}
                          className="border-2 border-dashed border-[#353941] hover:border-blue-500/50 bg-[#1a1d23]/50 hover:bg-blue-500/5 rounded-xl p-4 text-center cursor-pointer transition-all space-y-1.5"
                          onDragOver={(e) => {
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files?.[0];
                            if (file && file.type.startsWith('image/')) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                if (event.target?.result) {
                                  setStoryImage(event.target.result as string);
                                }
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        >
                          <Upload className="mx-auto text-gray-500" size={24} />
                          <p className="text-xs font-bold text-gray-300">Upload primary layout image</p>
                          <p className="text-[10px] text-gray-500 uppercase">Click or Drag & Drop</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 bg-[#1a1d23] p-2 rounded-lg border border-[#353941]">
                            <img 
                              src={storyImage} 
                              alt="Upload Preview" 
                              className="w-12 h-12 rounded object-cover border border-[#2a2d35]" 
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-300 font-medium truncate">Primary Image</p>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Top of canvas</p>
                            </div>
                            <button 
                              onClick={() => storyImageInputRef.current?.click()}
                              className="text-[10px] px-2.5 py-1 bg-[#2a2d35] hover:bg-[#353941] rounded font-bold text-blue-400 transition-all"
                            >
                              CHANGE
                            </button>
                          </div>

                          <div className="space-y-2 pt-1 border-t border-[#2a2d35]/50">
                            <div>
                              <div className="flex justify-between text-[10px] text-gray-500">
                                <span>IMAGE HEIGHT</span>
                                <span>{storyImageHeight}px</span>
                              </div>
                              <input 
                                type="range" 
                                min="100" 
                                max="1200" 
                                step="10"
                                value={storyImageHeight}
                                onChange={(e) => setStoryImageHeight(parseInt(e.target.value))}
                                className="w-full accent-blue-500"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] text-gray-500 block mb-1">IMAGE FIT</label>
                              <select 
                                value={storyImageFit}
                                onChange={(e: any) => setStoryImageFit(e.target.value)}
                                className="w-full bg-[#1a1d23] border border-[#30343c] rounded p-1.5 text-xs text-gray-300 outline-none"
                              >
                                <option value="cover">Cover (crop)</option>
                                <option value="contain">Contain (fit)</option>
                                <option value="fill">Fill (stretch)</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Story Content Area */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs text-gray-400">Story Text Content</label>
                        <div className="flex items-center gap-1.5">
                          <button 
                            onClick={() => handleRandomHighlight()}
                            className="flex items-center gap-1.5 px-2 py-1 bg-[#2a2d35] hover:bg-[#353941] rounded text-[10px] text-blue-400 hover:text-blue-300 transition-all font-bold"
                          >
                            <Zap size={10} /> RANDOM HIGHLIGHT
                          </button>
                          <button 
                            onClick={() => handleRemoveHighlight()}
                            className="flex items-center gap-1.5 px-2 py-1 bg-red-950/20 border border-red-900/40 hover:bg-red-950/40 rounded text-[10px] text-red-400 hover:text-red-300 transition-all font-bold"
                          >
                            <Trash2 size={10} /> REMOVE HIGHLIGHT
                          </button>
                        </div>
                      </div>
                      <textarea 
                        value={storyText}
                        onChange={(e) => setStoryText(e.target.value)}
                        rows={6}
                        placeholder="Type your story here."
                        className="w-full bg-[#2a2d35] border border-[#353941] rounded px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none text-gray-300"
                      />
                    </div>

                    {/* Bold specific paragraph */}
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-2">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block">Bold Paragraph Only</label>
                      <select 
                        value={boldParagraphIndex === null ? 'none' : boldParagraphIndex}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBoldParagraphIndex(val === 'none' ? null : parseInt(val));
                        }}
                        className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500 text-gray-300"
                      >
                        <option value="none">None (Regular Weight)</option>
                        {storyText.split('\n').map((para, idx) => {
                          const cleanPara = para.trim();
                          const displayNum = idx + 1;
                          const previewText = cleanPara.length > 30 ? cleanPara.substring(0, 30) + '...' : cleanPara;
                          return (
                            <option key={idx} value={idx}>
                              Paragraph {displayNum}: {cleanPara.length > 0 ? previewText : '(Empty Line)'}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Typography controls */}
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-4">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block border-b border-[#2a2d35] pb-2">Typography & Style</label>
                      
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Font Family</label>
                        <select 
                          value={fontFamily}
                          onChange={(e) => setFontFamily(e.target.value)}
                          className="w-full bg-[#1a1d23] border border-[#353941] rounded px-3 py-2 text-sm outline-none text-gray-300 font-serif"
                        >
                          {fonts.map(f => (
                            <option key={f.value} value={f.value} className={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-gray-400">Font Size ({fontSize}px)</span>
                          <button onClick={() => setFontSize(62)} className="text-xs text-blue-400 hover:text-blue-300">
                            Reset (62px)
                          </button>
                        </div>
                        <input 
                          type="range" 
                          min="24" 
                          max="120" 
                          value={fontSize} 
                          onChange={(e) => setFontSize(parseInt(e.target.value))} 
                          className="w-full accent-blue-500" 
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Text Alignment</label>
                          <select 
                            value={textAlign} 
                            onChange={(e) => setTextAlign(e.target.value as any)}
                            className="w-full bg-[#1a1d23] border border-[#353941] rounded px-2 py-1.5 text-xs text-gray-300 outline-none"
                          >
                            <option value="center">Center</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="justify">Justify</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Font Color</label>
                          <div className="flex items-center gap-2">
                            <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-8 h-8 rounded border border-[#353941] cursor-pointer bg-transparent" />
                            <input type="text" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-full bg-[#1a1d23] border border-[#353941] rounded p-1 text-[10px] text-gray-300" />
                          </div>
                        </div>
                      </div>

                      <div>
                         <label className="text-xs text-gray-400 block mb-1">Highlight Color</label>
                         <div className="flex items-center gap-3">
                           <input 
                             type="color" 
                             value={highlightColor} 
                             onChange={(e) => setHighlightColor(e.target.value)} 
                             className="w-10 h-10 rounded-xl border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" 
                           />
                           <input 
                             type="text" 
                             value={highlightColor} 
                             onChange={(e) => setHighlightColor(e.target.value)} 
                             className="w-full bg-[#1a1d23] border border-[#353941] rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-blue-500 text-gray-300" 
                           />
                         </div>
                      </div>
                    </div>

                    {/* Footer Settings */}
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-4">
                      <div className="flex items-center justify-between border-b border-[#2a2d35] pb-2">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block font-bold">Footer (Optional)</label>
                        <div className="flex items-center gap-2">
                          <div 
                            onClick={() => setShowFooter(!showFooter)}
                            className={cn("w-10 h-5 rounded-full relative cursor-pointer transition-colors", showFooter ? "bg-blue-500" : "bg-[#1a1d23]")}
                          >
                            <div className={cn("absolute top-1 w-3 h-3 bg-white rounded-full transition-all", showFooter ? "left-6" : "left-1")}></div>
                          </div>
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{showFooter ? "On" : "Off"}</span>
                        </div>
                      </div>

                      {showFooter && (
                        <div className="space-y-4 pt-1">
                          <div>
                            <label className="text-xs text-gray-400 block mb-1">Footer Text</label>
                            <input 
                              type="text" 
                              value={footerText}
                              onChange={(e) => setFooterText(e.target.value)}
                              className="w-full bg-[#1a1d23] border border-[#353941] rounded px-3 py-2 text-xs outline-none focus:border-blue-500 text-gray-300"
                              placeholder="CONTINUE READING"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-gray-400 block mb-1">BG Style</label>
                              <select 
                                value={footerBgStyle}
                                onChange={(e) => setFooterBgStyle(e.target.value as any)}
                                className="w-full bg-[#1a1d23] border border-[#353941] rounded px-2 py-1.5 text-xs text-gray-300 outline-none"
                              >
                                <option value="none">None</option>
                                <option value="text">Fit to text</option>
                                <option value="card">Fit to card</option>
                                <option value="fill">Fill (to edge)</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-400 block mb-1 font-medium font-sans">Font</label>
                              <select 
                                value={footerFont}
                                onChange={(e) => setFooterFont(e.target.value)}
                                className="w-full bg-[#1a1d23] border border-[#353941] rounded px-2 py-1.5 text-xs text-gray-300 outline-none font-serif"
                              >
                                {fonts.map(f => (<option key={f.value} value={f.value} className={f.value}>{f.label}</option>))}
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="text-xs text-gray-400 block mb-1">BG Color</label>
                              <div className="flex items-center gap-1.5">
                                <input 
                                  type="color" 
                                  value={footerBgColor === 'transparent' ? '#000000' : footerBgColor} 
                                  onChange={(e) => setFooterBgColor(e.target.value)} 
                                  className="w-8 h-8 rounded border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" 
                                />
                                <input 
                                  type="text" 
                                  value={footerBgColor === 'transparent' ? 'transparent' : footerBgColor} 
                                  onChange={(e) => setFooterBgColor(e.target.value)} 
                                  className="w-full bg-[#1a1d23] border border-[#353941] rounded p-1 text-[10px] text-gray-300 font-mono" 
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-gray-400 block mb-1 font-sans">Text Color</label>
                              <div className="flex items-center gap-1.5">
                                <input 
                                  type="color" 
                                  value={footerTextColor} 
                                  onChange={(e) => setFooterTextColor(e.target.value)} 
                                  className="w-8 h-8 rounded border border-[#353941] cursor-pointer bg-transparent flex-shrink-0" 
                                />
                                <input 
                                  type="text" 
                                  value={footerTextColor} 
                                  onChange={(e) => setFooterTextColor(e.target.value)} 
                                  className="w-full bg-[#1a1d23] border border-[#353941] rounded p-1 text-[10px] text-gray-300 font-mono" 
                                />
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs text-gray-400 font-sans">Font Size ({footerFontSize}px)</span>
                              <button onClick={() => setFooterFontSize(32)} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold">
                                Reset
                              </button>
                            </div>
                            <input 
                              type="range" 
                              min="8" 
                              max="100" 
                              value={footerFontSize} 
                              onChange={(e) => setFooterFontSize(parseInt(e.target.value))} 
                              className="w-full accent-blue-500" 
                            />
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs text-gray-400 font-sans">Vertical Move ({footerMove}px)</span>
                              <button onClick={() => setFooterMove(0)} className="text-[10px] text-blue-400 hover:text-blue-300 font-bold">
                                Reset
                              </button>
                            </div>
                            <input 
                              type="range" 
                              min="-400" 
                              max="400" 
                              value={footerMove} 
                              onChange={(e) => setFooterMove(parseInt(e.target.value))} 
                              className="w-full accent-blue-500" 
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
                      <p className="font-semibold mb-1">Bulk Picture & Text Mode</p>
                      Keep the same template presets, but render multiple pages automatically with image URLs/files and text contents. No cards, borders, or backgrounds are used.
                    </div>

                    {/* CSV Upload */}
                    <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <h4 className="text-xs font-bold text-purple-400">Import CSV</h4>
                        <p className="text-[10px] text-gray-500">Row layout with [Image URL/File, Story Text]</p>
                      </div>
                      <button 
                        onClick={() => picTextCsvInputRef.current?.click()}
                        className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-[10px] font-bold rounded transition-colors flex items-center gap-1.5 shadow-md shadow-purple-500/10"
                      >
                        <Upload size={14} /> UPLOAD CSV
                      </button>
                    </div>

                    {/* Manual List of Items */}
                    <div className="space-y-6">
                      <div className="flex justify-between items-center">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pages ({picTextBulkStories.length})</h3>
                        <button 
                          onClick={() => {
                            setPicTextBulkStories([{
                              text: '',
                              image: null,
                              fontSize: 62,
                              highlightColor: highlightColor
                            }]);
                          }}
                          className="text-[10px] text-red-500 hover:text-red-400 font-bold uppercase transition-colors"
                        >
                          Clear All
                        </button>
                      </div>

                      {picTextBulkStories.map((story, index) => (
                        <div key={index} className="p-4 bg-[#1c2229] rounded-xl border border-[#2a2d35] space-y-4">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-gray-500 tracking-[0.2em] uppercase">PAGE #{index + 1}</span>
                              <div className="flex items-center gap-1.5 border-l border-r border-[#21252d] px-2.5 mx-1">
                                <button 
                                  onClick={() => movePicTextBulkStoryUp(index)}
                                  disabled={index === 0}
                                  className={cn("transition-colors p-0.5 hover:bg-[#252b35] rounded", index === 0 ? "text-gray-800 cursor-not-allowed" : "text-gray-400 hover:text-blue-400")}
                                  title="Move Up"
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button 
                                  onClick={() => movePicTextBulkStoryDown(index)}
                                  disabled={index === picTextBulkStories.length - 1}
                                  className={cn("transition-colors p-0.5 hover:bg-[#252b35] rounded", index === picTextBulkStories.length - 1 ? "text-gray-800 cursor-not-allowed" : "text-gray-400 hover:text-blue-400")}
                                  title="Move Down"
                                >
                                  <ChevronDown size={14} />
                                </button>
                                <button 
                                  onClick={() => duplicatePicTextBulkStory(index)}
                                  className="text-gray-400 hover:text-blue-400 p-0.5 hover:bg-[#252b35] rounded transition-colors ml-0.5"
                                  title="Duplicate Card"
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                              {picTextBulkStories.length > 1 && (
                                <button 
                                  onClick={() => removePicTextBulkStory(index)}
                                  className="text-gray-500 hover:text-red-400 transition-colors p-1 hover:bg-[#212830] rounded-lg"
                                  title="Remove Page"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              <button 
                                 onClick={() => handleApplySelectionHighlight(index, 'standard')}
                                 className="flex items-center gap-0.5 text-[10px] text-indigo-400 font-bold hover:text-indigo-300 transition-colors bg-[#202530] hover:bg-[#282e3c] px-1.5 py-0.5 rounded border border-indigo-950/40"
                                 title="Select text in the editor below and click this to apply a standard highlight"
                              >
                                <Zap size={10} /> ⭐ HIGHLIGHT
                              </button>
                              <span className="text-gray-800 text-[10px] select-none">|</span>
                              <button 
                                 onClick={() => handleApplySelectionHighlight(index, 'box')}
                                 className="flex items-center gap-0.5 text-[10px] text-amber-400 font-bold hover:text-amber-300 transition-colors bg-[#252320] hover:bg-[#302c28] px-1.5 py-0.5 rounded border border-amber-950/40"
                                 title="Select text in the editor below and click this to apply a solid box highlight"
                              >
                                📦 BOX
                              </button>
                              <span className="text-gray-800 text-[10px] select-none">|</span>
                              <button 
                                 onClick={() => handleRandomHighlight(index)}
                                 className="flex items-center gap-0.5 text-[10px] text-blue-400 font-bold hover:text-blue-300 transition-colors bg-[#112030] hover:bg-[#152a40] px-1.5 py-0.5 rounded border border-blue-950/40"
                              >
                                <Zap size={10} /> RANDOM
                              </button>
                              <span className="text-gray-800 text-[10px] select-none">|</span>
                              <button 
                                 onClick={() => handleRemoveHighlight(index)}
                                 className="flex items-center gap-0.5 text-[10px] text-red-400 font-bold hover:text-red-350 transition-all bg-[#2a1315] hover:bg-[#3d1a1e] px-1.5 py-0.5 rounded border border-red-950/40"
                              >
                                <Trash2 size={10} /> REMOVE
                              </button>
                            </div>
                          </div>

                          {/* Image Selector (File or URL) */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Page Image (File or URL)</label>
                            
                            <div className="grid grid-cols-[auto_1fr] gap-3 items-center">
                              {/* Local file drag & drop trigger */}
                              <div 
                                onClick={() => {
                                  setBulkImageUploadIndex(index);
                                  setTimeout(() => {
                                    bulkStoryImageInputRef.current?.click();
                                  }, 50);
                                }}
                                className="w-16 h-16 rounded-xl border border-dashed border-[#353941] bg-[#14161b] hover:bg-blue-500/5 hover:border-blue-500/50 cursor-pointer overflow-hidden flex flex-col items-center justify-center transition-all flex-shrink-0"
                                title="Upload local image file"
                              >
                                {story.image ? (
                                  <img src={story.image} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <>
                                    <Upload size={14} className="text-gray-500 mb-1" />
                                    <span className="text-[8px] text-gray-500 font-bold uppercase">FILE</span>
                                  </>
                                )}
                              </div>

                              {/* Input URL alternate */}
                              <div className="space-y-1 flex-1">
                                <input 
                                  type="text"
                                  placeholder="Or paste external image URL..."
                                  value={story.image && !story.image.startsWith('data:') ? story.image : ''}
                                  onChange={(e) => {
                                    const newStories = [...picTextBulkStories];
                                    newStories[index].image = e.target.value.trim() || null;
                                    setPicTextBulkStories(newStories);
                                  }}
                                  className="w-full bg-[#14161b] border border-[#2a2d35] rounded px-2.5 py-1.5 text-xs outline-none focus:border-blue-500 text-gray-300"
                                />
                                <div className="flex justify-between items-center text-[9px] text-gray-600 uppercase font-medium">
                                  <span>LOCAL FILE OR IMAGE URL</span>
                                  {story.image && (
                                    <button 
                                      onClick={() => {
                                        const newStories = [...picTextBulkStories];
                                        newStories[index].image = null;
                                        setPicTextBulkStories(newStories);
                                      }}
                                      className="text-red-500 hover:text-red-400 font-semibold"
                                    >
                                      Remove image
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Story Textarea */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">Story Text Content</label>
                            <textarea 
                              rows={4}
                              placeholder="Type your page story content here..."
                              value={story.text}
                              onChange={(e) => {
                                const newStories = [...picTextBulkStories];
                                newStories[index].text = e.target.value;
                                setPicTextBulkStories(newStories);
                              }}
                              className="w-full bg-[#14161b] border border-[#2a2d35] rounded px-3 py-2 text-xs outline-none focus:border-blue-500 resize-none text-gray-300 font-sans"
                            />
                          </div>

                          {/* Individual Settings */}
                          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#2a2d35]/30">
                            <div>
                              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                <span>Font Size</span>
                                <span>{story.fontSize || 62}px</span>
                              </div>
                              <input 
                                type="range" 
                                min="24" 
                                max="120" 
                                value={story.fontSize || 62} 
                                onChange={(e) => {
                                  const newStories = [...picTextBulkStories];
                                  newStories[index].fontSize = parseInt(e.target.value);
                                  setPicTextBulkStories(newStories);
                                }} 
                                className="w-full accent-blue-500" 
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 block mb-1">Highlight</label>
                              <div className="flex items-center gap-1.5">
                                <input 
                                  type="color" 
                                  value={story.highlightColor || '#150621'} 
                                  onChange={(e) => {
                                    const newStories = [...picTextBulkStories];
                                    newStories[index].highlightColor = e.target.value;
                                    setPicTextBulkStories(newStories);
                                  }} 
                                  className="w-6 h-6 rounded cursor-pointer bg-transparent border border-[#2a2d35] p-0 flex-shrink-0" 
                                />
                                <input 
                                  type="text" 
                                  value={story.highlightColor || '#150621'} 
                                  onChange={(e) => {
                                    const newStories = [...picTextBulkStories];
                                    newStories[index].highlightColor = e.target.value;
                                    setPicTextBulkStories(newStories);
                                  }} 
                                  className="w-full bg-[#14161b] border border-[#2a2d35] rounded p-1 text-[9px] text-gray-400 font-mono" 
                                />
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2.5 border-t border-[#252a32]">
                            <label className="flex items-center gap-2 cursor-pointer text-[10px] text-gray-400 hover:text-gray-300 font-bold uppercase tracking-wider">
                              <input 
                                type="checkbox" 
                                checked={!!story.boxHighlight} 
                                onChange={(e) => {
                                  const newStories = [...picTextBulkStories];
                                  newStories[index].boxHighlight = e.target.checked;
                                  setPicTextBulkStories(newStories);
                                }}
                                className="w-3.5 h-3.5 rounded bg-[#14161b] border border-[#2a2d35] text-blue-500 focus:ring-0 cursor-pointer"
                              />
                              <span>Use Solid Box Highlight Accent</span>
                            </label>
                          </div>
                        </div>
                      ))}

                      <button 
                        onClick={addPicTextBulkStory}
                        className="w-full py-2.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 border border-dashed border-blue-500/30 rounded-xl font-bold text-xs uppercase transition-all flex items-center justify-center gap-2"
                      >
                        <Plus size={14} /> Add Manual Entry
                      </button>
                    </div>

                    {/* Global style select preset */}
                    <div className="p-3 bg-[#2a2d35]/30 rounded-xl border border-[#2a2d35] space-y-4">
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block border-b border-[#2a2d35] pb-1.5">Global Typography & Base Style</h4>
                      
                      <div>
                        <label className="text-xs text-gray-400 block mb-1 block">Font Family</label>
                        <select 
                          value={fontFamily}
                          onChange={(e) => setFontFamily(e.target.value)}
                          className="w-full bg-[#1a1d23] border border-[#353941] rounded px-3 py-2 text-sm outline-none text-gray-300 font-serif"
                        >
                          {fonts.map(f => (
                            <option key={f.value} value={f.value} className={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Text Alignment</label>
                          <select 
                            value={textAlign} 
                            onChange={(e) => setTextAlign(e.target.value as any)}
                            className="w-full bg-[#1a1d23] border border-[#353941] rounded px-2 py-1.5 text-xs text-gray-300 outline-none"
                          >
                            <option value="center">Center</option>
                            <option value="left">Left</option>
                            <option value="right">Right</option>
                            <option value="justify">Justify</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Font Color</label>
                          <div className="flex items-center gap-2">
                            <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-8 h-8 rounded border border-[#353941] cursor-pointer bg-transparent" />
                            <input type="text" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-full bg-[#1a1d23] border border-[#353941] rounded p-1 text-[10px] text-gray-300" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Actions */}
        <div className="p-4 bg-[#14161b] border-t border-[#2a2d35] flex flex-col gap-2">
           <div className="flex gap-2">
            <button 
              onClick={() => fullImageInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs font-bold py-3 rounded transition-all shadow-lg shadow-blue-500/20 active:scale-95 uppercase"
            >
              <Upload size={16} /> Upload Image
            </button>
            <button 
              onClick={() => setIsExportModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-gray-200 text-black text-xs font-bold py-3 rounded transition-colors uppercase shadow-lg shadow-white/5"
            >
              <Download size={16} /> Export
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
        <div className="flex-1 flex flex-col items-center p-8 overflow-auto bg-[#0a0c10] gap-12 text-white">
          {(activeTab === 'pictext' ? !isPicTextBulk : !isBulkMode) ? (
            <div className="flex flex-col items-center gap-4">
              <div 
                className="relative overflow-visible shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] rounded-2xl" 
                style={isExporting ? { width: '1080px', height: '1920px' } : { width: '356px', height: '633px' }}
              >
                <Poster 
                  {...posterProps} 
                  storyText={storyText} 
                  hColor={highlightColor}
                  fSize={fontSize}
                  boxHighlight={boxHighlight}
                  innerRef={previewRef} 
                />
              </div>
            </div>
          ) : activeTab === 'pictext' ? (
            picTextBulkStories.map((story, originalIndex) => {
              const displayIndex = picTextBulkStories.slice(0, originalIndex).length;

              return (
                <div key={originalIndex} className="flex flex-col items-center gap-4 group/card">
                  <div className="flex items-center gap-3 self-start w-[356px]">
                    <div className="flex items-center gap-2">
                       <div className="px-3 py-1 bg-[#1a1d23] border border-[#2a2d35] rounded-full text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                        PAGE #{displayIndex + 1}
                      </div>
                      <button 
                        onClick={() => removePicTextBulkStory(originalIndex)}
                        className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover/card:opacity-100"
                        title="Remove Page"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="h-px flex-1 bg-gradient-to-r from-[#2a2d35] to-transparent" />
                  </div>
                  <div 
                    className="relative overflow-visible shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] rounded-2xl bulk-poster-card transition-transform duration-300 group-hover/card:scale-[1.01]" 
                    style={isExporting ? { width: '1080px', height: '1920px' } : { width: '356px', height: '633px' }}
                  >
                    <Poster 
                      {...posterProps} 
                      storyText={story.text} 
                      hColor={story.highlightColor}
                      fSize={story.fontSize}
                      storyImage={story.image}
                      boxHighlight={story.boxHighlight}
                      innerRef={originalIndex === 0 ? previewRef : null} 
                    />
                  </div>
                </div>
              );
            })
          ) : (
            bulkStories.map((story, originalIndex) => {
              if (story.text.trim().length === 0) return null;
              
              // Calculate display index for the badge
              const displayIndex = bulkStories.slice(0, originalIndex).filter(s => s.text.trim().length > 0).length;

              return (
                <div key={originalIndex} className="flex flex-col items-center gap-4 group/card">
                   <div className="flex items-center gap-3 self-start w-[356px]">
                    <div className="flex items-center gap-2">
                       <div className="px-3 py-1 bg-[#1a1d23] border border-[#2a2d35] rounded-full text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                        CARD #{displayIndex + 1}
                      </div>
                      <button 
                        onClick={() => removeBulkStory(originalIndex)}
                        className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover/card:opacity-100"
                        title="Remove Card"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="h-px flex-1 bg-gradient-to-r from-[#2a2d35] to-transparent" />
                  </div>
                  <div 
                    className="relative overflow-visible shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] rounded-2xl bulk-poster-card transition-transform duration-300 group-hover/card:scale-[1.01]" 
                    style={isExporting ? { width: '1080px', height: '1920px' } : { width: '356px', height: '633px' }}
                  >
                    <Poster 
                      {...posterProps} 
                      storyText={story.text} 
                      hColor={story.highlightColor}
                      fSize={story.fontSize}
                      boxHighlight={story.boxHighlight}
                      innerRef={originalIndex === 0 ? previewRef : null} 
                    />
                  </div>
                </div>
              );
            })
          )}
          
          {((isBulkMode && activeTab !== 'pictext') || (activeTab === 'pictext' && isPicTextBulk)) && 
           (activeTab === 'pictext' ? picTextBulkStories.length === 0 : bulkStories.every(s => s.text.trim().length === 0)) && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 opacity-50">
              <Plus size={48} className="mb-4" />
              <p className="font-bold text-lg">Input some entries to see pages</p>
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
  profileImage, scribbleStyle, profileMove, profilePosition, cardMove, footerMove, customHighlightColor, nameFont, nameHasBg, nameSize, nameColor,
  posterName, subFont, subtitleHasBg, subtitleSize, subtitleColor, subtitle, showPosterName, showSubtitle,
  cardColor, cardTransparency, cardRadius, cardPadding, fontFamily, fSize,
  fontWeight, textColor, textAlign, lineHeight, letterSpacing, fontStyle, 
  showFooter, footerFont, footerBgStyle, footerBgColor, footerTextColor, 
  footerFontSize, footerText, renderStoryText, showCard, footerBorderWidth, footerBorderColor,
  bgImage, bgImageOverlay, showProfile, showDots, fullImageOnly, hColor, removePaddingWhenHidden,
  videoBackground, isExporting, boldParagraphIndex,
  storyImage, storyImageHeight, storyImageRadius, storyImageFit, isPicTextMode,
  boxHighlight
}: any) {
  const isCardPadded = showCard || !removePaddingWhenHidden;
  const isBlur = scribbleStyle === 'blur' || scribbleStyle === 'title-blur';

  if (isPicTextMode) {
    return (
      <div 
        ref={innerRef}
        className="relative overflow-hidden flex flex-col h-full w-full"
        style={{ 
          width: '1080px', 
          height: '1920px',
          background: bgStyle === 'solid' ? bgColor : 
                      bgStyle === 'gradient' ? `linear-gradient(to bottom, ${bgColor}, ${gradEnd})` : 
                      '#000',
          transform: isExporting ? 'none' : 'scale(0.33)',
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0
        }}
      >
        {storyImage ? (
          <div 
            className="w-full relative overflow-hidden flex-shrink-0"
            style={{ 
              height: `${storyImageHeight}px`,
            }}
          >
            <img 
              src={storyImage} 
              alt="Story Media" 
              className="w-full h-full"
              style={{ 
                objectFit: storyImageFit,
              }}
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
          </div>
        ) : (
          <div 
            className="w-full bg-[#1a1d23]/80 border-b border-[#2a2d35]/35 flex flex-col items-center justify-center flex-shrink-0"
            style={{ height: `${storyImageHeight}px` }}
          >
            <span className="text-gray-400 text-3xl font-bold">No Image Uploaded</span>
            <span className="text-gray-500 text-xl mt-2 uppercase tracking-widest">Please upload an image in the Picture & Text tab</span>
          </div>
        )}

        <div 
          className="w-full flex-1 flex flex-col px-16 py-12 select-text"
          style={{
            justifyContent: 'flex-start',
            marginTop: '0px',
            backgroundColor: 'transparent',
          }}
        >
          <div 
            className={cn(fontFamily, "w-full")}
            style={{ 
              fontSize: `${fSize}px`,
              color: textColor || '#ffffff',
              textAlign: textAlign || 'center',
              lineHeight: lineHeight || 1.6,
              letterSpacing: `${letterSpacing}px`,
              fontWeight: fontWeight || 'normal',
              fontStyle: fontStyle === 'italic' ? 'italic' : 'normal',
            }}
          >
            {storyText.split('\n').map((para, index) => {
              const isBold = index === boldParagraphIndex;
              return (
                <div 
                  key={index}
                  style={{
                    fontWeight: isBold ? '800' : undefined,
                    whiteSpace: 'pre-wrap',
                    marginBottom: '1.5em'
                  }}
                >
                  {para === '' ? <br /> : renderStoryText(para, hColor, boxHighlight)}
                </div>
              );
            })}
          </div>
        </div>

        {showFooter && (
          <div 
            className={cn(
              "w-full flex justify-center z-10 absolute transition-all duration-300",
              footerBgStyle === 'fill' ? "bottom-0" : "bottom-20"
            )}
            style={{ transform: `translateY(${footerMove}px)` }}
          >
            <div 
              className={cn(
                "py-6 px-12 rounded-lg text-center transition-all flex items-center justify-center gap-6", 
                footerFont,
                footerBgStyle === 'card' && "w-[calc(100%-128px)]",
                footerBgStyle === 'fill' && "w-full py-12"
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

  const profileSection = (
    <div 
      className={cn(
        "w-full flex items-center gap-10 z-20 self-start flex-shrink-0 transition-all duration-300",
        profilePosition === 'outside' ? "mb-12 px-16" : "mb-12"
      )}
      style={{ transform: `translateY(-${profileMove}px)` }}
    >
      <div 
        className={cn("w-40 h-40 rounded-full overflow-hidden flex-shrink-0 relative shadow-2xl bg-gray-200")}
        style={{ border: avatarBorder ? `8px solid ${avatarBorderColor}` : 'none' }}
      >
        <img 
          src={profileImage} 
          alt="Profile" 
          className={cn(
            "w-full h-full object-cover",
            scribbleStyle === 'blur' && "blur-xl scale-110",
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
        {showPosterName && (
          <div className="relative rounded overflow-hidden flex flex-col items-start px-1">
            <div 
              className={cn(
                "inline-block text-ellipsis overflow-hidden whitespace-nowrap max-w-[800px] transition-all duration-300", 
                nameFont, 
                nameHasBg ? "bg-white/20 backdrop-blur-sm" : "",
                isBlur && "blur-xl scale-105",
                scribbleStyle === 'mosaic' && "contrast-150 brightness-110 blur-[2px] opacity-70"
              )}
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

            {/* Overlays for title ONLY */}
            {scribbleStyle === 'solid' && (
              <div className="absolute inset-0 bg-white/20 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                  <div className="w-full h-[40%] bg-blue-500/60 rotate-[-5deg] shadow-lg"></div>
              </div>
            )}
            {scribbleStyle === 'squiggle' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <svg className="w-full h-full text-blue-500 opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <path d="M 0 50 Q 25 30 50 50 T 100 50" fill="none" stroke="currentColor" strokeWidth="8" />
                      <path d="M 0 25 Q 25 5 50 25 T 100 25" fill="none" stroke="currentColor" strokeWidth="8" />
                  </svg>
                </div>
            )}
          </div>
        )}

        {showSubtitle && (
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
        )}
      </div>
    </div>
  );

  return (
    <div 
      ref={innerRef}
      className="relative overflow-hidden flex flex-col items-center h-full w-full"
      style={{ 
        width: '1080px', 
        height: '1920px',
        background: fullImageOnly ? 'transparent' : (
                    (isExporting && videoBackground) ? 'transparent' : (
                    bgStyle === 'solid' ? bgColor : 
                    bgStyle === 'gradient' ? `linear-gradient(to bottom, ${bgColor}, ${gradEnd})` : 
                    '#000')),
        transform: isExporting ? 'none' : 'scale(0.33)',
        transformOrigin: 'top left',
        position: 'absolute',
        top: 0,
        left: 0
      }}
    >
      {fullImageOnly ? (
        <img 
          src={fullImageOnly} 
          alt="Full Preview" 
          className="absolute inset-0 w-full h-full object-contain bg-black"
          style={{ zIndex: 50 }}
          crossOrigin="anonymous"
        />
      ) : (
        <>
           {bgStyle === 'image' && bgImage && !(isExporting && videoBackground) && (
            <>
              <img 
                src={bgImage} 
                alt="Background" 
                className="absolute inset-0 w-full h-full object-cover"
                style={{ zIndex: 0 }}
                crossOrigin="anonymous"
              />
              <div 
                className="absolute inset-0 z-0" 
                style={{ backgroundColor: `rgba(0,0,0,${bgImageOverlay / 100})` }}
              />
            </>
          )}

          {videoBackground && !isExporting && (
            <div className="absolute inset-0 z-0 overflow-hidden">
              <video 
                src={videoBackground} 
                autoPlay 
                muted 
                loop 
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div 
                className="absolute inset-0 z-10" 
                style={{ backgroundColor: `rgba(0,0,0,${bgImageOverlay / 100})` }}
              />
            </div>
          )}
          {/* Design Elements */}
          {showDots && <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 4px 4px, white 2px, transparent 0)', backgroundSize: '64px 64px' }}></div>}

          {/* Top Spacing - Always present to keep card layout stable */}
          <div style={{ height: `${Math.max(0, 160 - profileMove)}px` }} className="w-full flex-shrink-0 transition-all duration-300" />

          {/* Profile Section (Conditional Outside) */}
          {showProfile && profilePosition === 'outside' && profileSection}

          {/* Card Body Container */}
          <div 
            className="w-full relative z-10 flex flex-col px-16 mb-24 transition-all duration-300"
            style={{ 
              marginTop: (showProfile && profilePosition === 'outside') ? `-${profileMove}px` : (profilePosition === 'outside' ? `-${profileMove}px` : '0px'),
              transform: `translateY(${cardMove}px)`
            }}
          >
            {/* Story/Top Image - Positioned Above and Outside the Card Section */}
            {storyImage && (
              <div 
                className="w-full relative overflow-hidden mb-12 flex-shrink-0"
                style={{ 
                  height: `${storyImageHeight}px`,
                  borderRadius: `${storyImageRadius}px`,
                  boxShadow: showCard ? '0 30px 80px -15px rgba(0,0,0,0.15)' : 'none',
                }}
              >
                <img 
                  src={storyImage} 
                  alt="Story Top Media" 
                  className="w-full h-full"
                  style={{ 
                    objectFit: storyImageFit,
                  }}
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                />
              </div>
            )}

            <div 
              className="w-full transition-all duration-300 flex flex-col"
              style={{
                backgroundColor: showCard ? `${cardColor}${Math.round(cardTransparency * 2.55).toString(16).padStart(2, '0')}` : 'transparent',
                borderRadius: showCard ? `${cardRadius}px` : '0px',
                padding: isCardPadded ? `${cardPadding}px` : '0px',
                paddingTop: showCard && showProfile && profilePosition === 'inside' ? `${(isCardPadded ? cardPadding : 0) + profileMove}px` : (isCardPadded ? `${cardPadding}px` : '0px'),
                boxShadow: showCard ? '0 30px 80px -15px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {/* Profile Section (Conditional Inside) */}
              {showProfile && profilePosition === 'inside' && profileSection}

              <div 
                className={cn(fontFamily)}
                style={{ 
                  fontSize: `${fSize}px`,
                  color: textColor,
                  textAlign: textAlign,
                  lineHeight: lineHeight,
                  letterSpacing: `${letterSpacing}px`,
                  fontWeight: fontWeight,
                  fontStyle: fontStyle === 'italic' ? 'italic' : 'normal',
                }}
              >
                {storyText.split('\n').map((para, index) => {
                  const isBold = index === boldParagraphIndex;
                  return (
                    <div 
                      key={index}
                      style={{
                        fontWeight: isBold ? '800' : undefined,
                        whiteSpace: 'pre-wrap'
                      }}
                    >
                      {para === '' ? <br /> : renderStoryText(para, hColor, boxHighlight)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          {showFooter && (
            <div 
              className={cn(
                "w-full flex justify-center z-10 absolute transition-all duration-300",
                footerBgStyle === 'fill' ? "bottom-0" : "bottom-20"
              )}
              style={{ transform: `translateY(${footerMove}px)` }}
            >
              <div 
                className={cn(
                  "py-6 px-12 rounded-lg text-center transition-all flex items-center justify-center gap-6", 
                  footerFont,
                  footerBgStyle === 'card' && "w-[calc(100%-128px)]",
                  footerBgStyle === 'fill' && "w-full py-12"
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
        </>
      )}
    </div>
  );
}
