import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize folders
  const uploadsDir = path.join(process.cwd(), 'uploads');
  const exportsDir = path.join(process.cwd(), 'exports');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // Periodic cleanup of temp files older than 1 hour to protect sandboxed disk
  const runTemporaryCleanup = () => {
    try {
      const now = Date.now();
      const cutoff = 60 * 60 * 1000; // 1 hour

      [uploadsDir, exportsDir].forEach((dir) => {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          files.forEach((file) => {
            const filepath = path.join(dir, file);
            const stat = fs.statSync(filepath);
            if (now - stat.mtimeMs > cutoff) {
              fs.unlinkSync(filepath);
            }
          });
        }
      });
    } catch (e) {
      console.warn('Temporary files cleanup minor warning:', e);
    }
  };

  // Run cleanup once on startup
  runTemporaryCleanup();

  // Parse JSON/urlencoded bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Set up Multer for handling file uploads
  const upload = multer({ dest: 'uploads/' });

  // API Route for secure file rendering with FFmpeg
  app.post(
    '/api/render',
    upload.any(),
    async (req, res) => {
      // Periodic cleanup trigger
      runTemporaryCleanup();

      // Configure SSE-like chunked stream for real-time progress updates
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // Extract uploaded files safely
      const uploadedFiles = req.files as Express.Multer.File[] | undefined || [];
      const videoFile = uploadedFiles.find((f) => f.fieldname === 'video');
      const audioFile = uploadedFiles.find((f) => f.fieldname === 'audio');
      const voiceOverFile = uploadedFiles.find((f) => 
        f.fieldname === 'voiceover' || 
        f.fieldname === 'voiceOver' || 
        f.fieldname === 'voice_over' ||
        f.fieldname === 'voice'
      );

      const imageFilesMap: { [key: string]: Express.Multer.File } = {};
      uploadedFiles.forEach((file) => {
        if (file.fieldname.startsWith('image_')) {
          imageFilesMap[file.fieldname] = file;
        }
      });

      const singleImageFile = uploadedFiles.find((f) => f.fieldname === 'image');

      // Parameters
      const duration = parseFloat(req.body.duration || '31') || 31;
      const fps = 30;
      const totalFrames = duration * fps;

      // Handle timing allocations
      let timingsArr: { start: number; end: number; index: number }[] = [];
      if (req.body.timings) {
        try {
          timingsArr = JSON.parse(req.body.timings);
        } catch (e) {
          console.error('Failed to parse timings:', e);
        }
      }

      // Fallback: If no timed structures are provided, but a single overlay image exists
      if (singleImageFile && Object.keys(imageFilesMap).length === 0) {
        imageFilesMap['image_0'] = singleImageFile;
        timingsArr = [{ start: 0, end: duration, index: 0 }];
      }

      if (Object.keys(imageFilesMap).length === 0) {
        res.write(JSON.stringify({ status: 'error', error: 'At least one overlay image is required' }) + '\n');
        uploadedFiles.forEach((f) => {
          if (f && f.path && fs.existsSync(f.path)) fs.unlink(f.path, () => {});
        });
        res.end();
        return;
      }

      // Output filename
      const outputFilename = `story-render-${Date.now()}-${Math.floor(Math.random() * 100000)}.mp4`;
      const outputPath = path.join(exportsDir, outputFilename);

      // Cleanup temp files helper
      const cleanupTempFiles = () => {
        try {
          uploadedFiles.forEach((f) => {
            if (f && f.path && fs.existsSync(f.path)) {
              fs.unlink(f.path, () => {});
            }
          });
        } catch (e) {
          console.error('Error in temp file cleanup:', e);
        }
      };

      // Build FFmpeg command arguments
      const args: string[] = ['-y'];

      // 1. Background Video Input (Input 0)
      if (videoFile) {
        args.push('-stream_loop', '-1');
        args.push('-i', videoFile.path);
      } else {
        // Create an empty black background of correct duration
        args.push('-f', 'lavfi', '-i', `color=c=black:s=1080x1920:d=${duration}:r=30`);
      }

      // 2. Picture overlays
      const imageKeys = Object.keys(imageFilesMap).sort((a, b) => {
        const numA = parseInt(a.replace('image_', '')) || 0;
        const numB = parseInt(b.replace('image_', '')) || 0;
        return numA - numB;
      });

      imageKeys.forEach((key) => {
        args.push('-i', imageFilesMap[key].path);
      });

      // 3. Audio tracks
      let currentInputCount = 1 + imageKeys.length;
      let audioInputIdx = -1;
      let voiceInputIdx = -1;

      if (audioFile) {
        args.push('-i', audioFile.path);
        audioInputIdx = currentInputCount;
        currentInputCount++;
      }

      if (voiceOverFile) {
        args.push('-i', voiceOverFile.path);
        voiceInputIdx = currentInputCount;
        currentInputCount++;
      }

      // Prepare filter complex
      let filterComplex = '';

      // Initialize base background [bg]
      if (videoFile) {
        filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg_pre]; [bg_pre]null[bg]; `;
      } else {
        filterComplex += `[0:v]null[bg]; `;
      }

      // Chain overlays sequential timings
      let currentLabel = 'bg';
      timingsArr.forEach((t, idx) => {
        const key = `image_${t.index}`;
        const keyIdx = imageKeys.indexOf(key);
        if (keyIdx !== -1) {
          const inputIdx = 1 + keyIdx;
          const nextLabel = `v_ol_${idx}`;
          filterComplex += `[${currentLabel}][${inputIdx}:v]overlay=0:0:enable='between(t,${t.start},${t.end})'[${nextLabel}]; `;
          currentLabel = nextLabel;
        }
      });

      // Manage mixed audio track
      let hasAudio = false;
      if (audioFile || voiceOverFile) {
        hasAudio = true;
        if (audioFile && voiceOverFile) {
          // Mix standard ambient background music (reduced volume) and voice over (amplified definition)
          filterComplex += `[${audioInputIdx}:a]volume=0.15[bg_music]; [${voiceInputIdx}:a]volume=1.0[vo_music]; [bg_music][vo_music]amix=inputs=2:duration=longest:dropout_transition=2[mixed_audio]; `;
        } else if (audioFile) {
          filterComplex += `[${audioInputIdx}:a]volume=1.0[mixed_audio]; `;
        } else if (voiceOverFile) {
          filterComplex += `[${voiceInputIdx}:a]volume=1.0[mixed_audio]; `;
        }
      }

      args.push('-filter_complex', filterComplex.trim());
      args.push('-map', `[${currentLabel}]`);

      if (hasAudio) {
        args.push('-map', '[mixed_audio]');
        args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
      } else {
        args.push('-an');
      }

      // Universal output profile with fast encoding preset
      args.push('-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p');

      // Constrain duration
      args.push('-t', duration.toString());

      // Progress monitoring via stdout
      args.push('-progress', '-');

      // Append final output path
      args.push(outputPath);

      console.log('Spawning FFmpeg with args:', args.join(' '));

      // Spawn FFmpeg child process
      const ffmpegProcess = spawn('ffmpeg', args);

      let lastProgress = 0;

      ffmpegProcess.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('frame=')) {
            const parts = line.split('=');
            const frameVal = parseInt(parts[1]?.trim());
            if (!isNaN(frameVal)) {
              const progress = Math.min(99, Math.round((frameVal / totalFrames) * 100));
              if (progress > lastProgress) {
                lastProgress = progress;
                res.write(JSON.stringify({ status: 'rendering', progress }) + '\n');
              }
            }
          }
        }
      });

      ffmpegProcess.stderr.on('data', (data) => {
        // Log to console for debugging, but don't output directly to stream
        const logText = data.toString();
        // Also a fallback progress scanner in case stdout lacks some frame updates
        const frameMatch = logText.match(/frame=\s*(\d+)/);
        if (frameMatch) {
          const frameVal = parseInt(frameMatch[1]);
          if (!isNaN(frameVal)) {
            const progress = Math.min(99, Math.round((frameVal / totalFrames) * 100));
            if (progress > lastProgress) {
              lastProgress = progress;
              res.write(JSON.stringify({ status: 'rendering', progress }) + '\n');
            }
          }
        }
      });

      ffmpegProcess.on('close', (code) => {
        cleanupTempFiles();
        if (code === 0) {
          res.write(
            JSON.stringify({
              status: 'completed',
              progress: 100,
              downloadUrl: `/api/download/${outputFilename}`,
            }) + '\n'
          );
        } else {
          res.write(
            JSON.stringify({
              status: 'error',
              error: `FFmpeg exited with error code ${code}. Check server output.`,
            }) + '\n'
          );
        }
        res.end();
      });

      ffmpegProcess.on('error', (err) => {
        cleanupTempFiles();
        console.error('FFmpeg process error:', err);
        res.write(JSON.stringify({ status: 'error', error: `System cannot execute FFmpeg: ${err.message}` }) + '\n');
        res.end();
      });

      // Handle client disconnection (request cancellation)
      req.on('close', () => {
        if (ffmpegProcess && !ffmpegProcess.killed) {
          console.log('Client aborted request. Killing active FFmpeg rendering process...');
          ffmpegProcess.kill('SIGKILL');
        }
        cleanupTempFiles();
      });
    }
  );

  // API route to securely download final file
  app.get('/api/download/:filename', (req, res) => {
    const filename = req.params.filename;
    // Sanitization to prevent directory traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      res.status(403).send('Invalid filename access');
      return;
    }
    const filePath = path.join(exportsDir, filename);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'video/mp4');
      res.download(filePath, filename);
    } else {
      res.status(404).send('Rendered video file not found on the server.');
    }
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully started, running on port ${PORT}`);
  });
}

startServer();
