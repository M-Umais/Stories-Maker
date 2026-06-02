import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import JSZip from 'jszip';

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

      const baseImageFile = uploadedFiles.find((f) => f.fieldname === 'image_base');

      const imageFilesMap: { [key: string]: Express.Multer.File } = {};
      uploadedFiles.forEach((file) => {
        if (file.fieldname.startsWith('image_') && file.fieldname !== 'image_base') {
          imageFilesMap[file.fieldname] = file;
        }
      });

      const singleImageFile = uploadedFiles.find((f) => f.fieldname === 'image');

      // Parameters
      const duration = parseFloat(req.body.duration || '31') || 31;
      const voiceVolume = parseFloat(req.body.voiceVolume || '1.0') || 1.0;
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

      if (Object.keys(imageFilesMap).length === 0 && !baseImageFile) {
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

      let currentInputIdx = 1;
      let baseImageInputIdx = -1;
      const imageKeysInputIndexes: { [key: string]: number } = {};

      // 2. Base Image Input (Input 1 if exists)
      if (baseImageFile) {
        args.push('-loop', '1');
        args.push('-i', baseImageFile.path);
        baseImageInputIdx = currentInputIdx;
        currentInputIdx++;
      }

      // 3. Highlighted overlay images
      const imageKeys = Object.keys(imageFilesMap).sort((a, b) => {
        const numA = parseInt(a.replace('image_', '')) || 0;
        const numB = parseInt(b.replace('image_', '')) || 0;
        return numA - numB;
      });

      imageKeys.forEach((key) => {
        args.push('-loop', '1');
        args.push('-i', imageFilesMap[key].path);
        imageKeysInputIndexes[key] = currentInputIdx;
        currentInputIdx++;
      });

      // 4. Audio tracks
      let audioInputIdx = -1;
      let voiceInputIdx = -1;

      if (audioFile) {
        args.push('-i', audioFile.path);
        audioInputIdx = currentInputIdx;
        currentInputIdx++;
      }

      if (voiceOverFile) {
        args.push('-i', voiceOverFile.path);
        voiceInputIdx = currentInputIdx;
        currentInputIdx++;
      }

      // Prepare filter complex
      let filterComplex = '';

      // Initialize base background [bg]
      if (videoFile) {
        filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg_pre]; [bg_pre]null[bg]; `;
      } else {
        filterComplex += `[0:v]null[bg]; `;
      }

      let currentLabel = 'bg';

      // Overlay base cover image first if it exists
      if (baseImageInputIdx !== -1) {
        filterComplex += `[${currentLabel}][${baseImageInputIdx}:v]overlay=0:0[bg_with_base]; `;
        currentLabel = 'bg_with_base';
      }

      // Chain highlight overlays sequential timings
      timingsArr.forEach((t, idx) => {
        const key = `image_${t.index}`;
        const inputIdx = imageKeysInputIndexes[key];
        if (inputIdx !== undefined) {
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
          // Mix standard ambient background music (reduced volume) and voice over with custom voiceVolume
          filterComplex += `[${audioInputIdx}:a]volume=0.15[bg_music]; [${voiceInputIdx}:a]volume=${voiceVolume}[vo_music]; [bg_music][vo_music]amix=inputs=2:duration=longest:dropout_transition=2[mixed_audio]; `;
        } else if (audioFile) {
          filterComplex += `[${audioInputIdx}:a]volume=1.0[mixed_audio]; `;
        } else if (voiceOverFile) {
          filterComplex += `[${voiceInputIdx}:a]volume=${voiceVolume}[mixed_audio]; `;
        }
      }

      // 5. Clean, sanitize and optimize complex filter to prevent empty filter segments and trailing semicolons
      const cleanedFilterComplex = filterComplex
        .split(';')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
        .join('; ');

      if (cleanedFilterComplex) {
        args.push('-filter_complex', cleanedFilterComplex);
        args.push('-map', `[${currentLabel}]`);
      } else {
        // Fallback pass-through map if filter_complex is totally empty for some reason
        args.push('-map', '0:v');
      }

      if (hasAudio) {
        args.push('-map', '[mixed_audio]');
        args.push('-c:a', 'aac', '-b:a', '192k');
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
      let ffmpegProcess: any;
      try {
        ffmpegProcess = spawn('ffmpeg', args);
      } catch (spawnError: any) {
        cleanupTempFiles();
        console.error('Failed to spawn FFmpeg process:', spawnError);
        res.write(
          JSON.stringify({
            status: 'error',
            error: `Failed to invoke FFmpeg binary on the server: ${spawnError.message || spawnError}`,
          }) + '\n'
        );
        res.end();
        return;
      }

      let lastProgress = 0;
      let stderrBuffer = '';

      ffmpegProcess.stdout.on('data', (data: any) => {
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

      ffmpegProcess.stderr.on('data', (data: any) => {
        const logText = data.toString();
        stderrBuffer += logText;
        console.error('[FFmpeg STDERR]:', logText);
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

      ffmpegProcess.on('close', (code: number) => {
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
          let errorMsg = `FFmpeg execution exited with non-zero code ${code}.`;
          if (stderrBuffer) {
            const lines = stderrBuffer.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const errorLines = lines.filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('invalid') || l.toLowerCase().includes('no such'));
            if (errorLines.length > 0) {
              errorMsg += ` Detail: ${errorLines.slice(-2).join(' | ')}`;
            } else if (lines.length > 0) {
              errorMsg += ` Last log: ${lines.slice(-2).join(' | ')}`;
            }
          }
          res.write(
            JSON.stringify({
              status: 'error',
              error: errorMsg,
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

  // Bulk ZIP rendering API route
  app.post(
    '/api/render-bulk-zip',
    upload.any(),
    async (req, res) => {
      runTemporaryCleanup();

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      const uploadedFiles = req.files as Express.Multer.File[] | undefined || [];
      const videoFile = uploadedFiles.find((f) => f.fieldname === 'video');
      const audioFile = uploadedFiles.find((f) => f.fieldname === 'audio');
      const voiceOverFile = uploadedFiles.find((f) => 
        f.fieldname === 'voiceover' || 
        f.fieldname === 'voiceOver' || 
        f.fieldname === 'voice_over' ||
        f.fieldname === 'voice'
      );

      const pageCount = parseInt(req.body.page_count || '0');
      const duration = parseFloat(req.body.duration || '5') || 5;
      const voiceVolume = parseFloat(req.body.voiceVolume || '1.0') || 1.0;

      const activeProcesses: any[] = [];
      const tempOutputPaths: string[] = [];

      const cleanupTempFiles = () => {
        try {
          uploadedFiles.forEach((f) => {
            if (f && f.path && fs.existsSync(f.path)) {
              fs.unlink(f.path, () => {});
            }
          });
          tempOutputPaths.forEach((pPath) => {
            if (fs.existsSync(pPath)) {
              fs.unlink(pPath, () => {});
            }
          });
        } catch (e) {
          console.error('Error in bulk temp file cleanup:', e);
        }
      };

      req.on('close', () => {
        console.log('Client aborted bulk request. Killing active FFmpeg processes...');
        activeProcesses.forEach((proc) => {
          if (proc && !proc.killed) {
            proc.kill('SIGKILL');
          }
        });
        cleanupTempFiles();
      });

      try {
        const zip = new JSZip();

        for (let p = 0; p < pageCount; p++) {
          res.write(JSON.stringify({ status: 'rendering', progress: Math.round((p / pageCount) * 100), message: `Starting rendering page ${p + 1} of ${pageCount}...` }) + '\n');

          const pageImageBase = uploadedFiles.find(f => f.fieldname === `page_${p}_image_base`);
          
          const pageImageFilesMap: { [key: string]: Express.Multer.File } = {};
          uploadedFiles.forEach((file) => {
            if (file.fieldname.startsWith(`page_${p}_image_`) && file.fieldname !== `page_${p}_image_base`) {
              const parts = file.fieldname.split('_');
              const idx = parts[parts.length - 1];
              pageImageFilesMap[`image_${idx}`] = file;
            }
          });

          const timingsStr = req.body[`page_${p}_timings`] || '';
          let timingsArr: any[] = [];
          try {
            if (timingsStr) timingsArr = JSON.parse(timingsStr);
          } catch (err) {
            console.error(`Failed to parse timings for page ${p}:`, err);
          }

          const singleImageFile = uploadedFiles.find((f) => f.fieldname === `page_${p}_image`);
          if (!pageImageBase && singleImageFile) {
            pageImageFilesMap['image_0'] = singleImageFile;
            timingsArr = [{ start: 0, end: duration, index: 0 }];
          }

          if (Object.keys(pageImageFilesMap).length === 0 && !pageImageBase) {
            throw new Error(`Page ${p + 1} has no valid base image or overlay screenshots.`);
          }

          const args: string[] = ['-y'];

          if (videoFile) {
            args.push('-stream_loop', '-1');
            args.push('-i', videoFile.path);
          } else {
            args.push('-f', 'lavfi', '-i', `color=c=black:s=1080x1920:d=${duration}:r=30`);
          }

          let currentInputIdx = 1;
          let baseImageInputIdx = -1;
          const imageKeysInputIndexes: { [key: string]: number } = {};

          if (pageImageBase) {
            args.push('-loop', '1');
            args.push('-i', pageImageBase.path);
            baseImageInputIdx = currentInputIdx;
            currentInputIdx++;
          }

          const imageKeys = Object.keys(pageImageFilesMap).sort((a, b) => {
            const numA = parseInt(a.replace('image_', '')) || 0;
            const numB = parseInt(b.replace('image_', '')) || 0;
            return numA - numB;
          });

          imageKeys.forEach((key) => {
            args.push('-loop', '1');
            args.push('-i', pageImageFilesMap[key].path);
            imageKeysInputIndexes[key] = currentInputIdx;
            currentInputIdx++;
          });

          let audioInputIdx = -1;
          let voiceInputIdx = -1;

          if (audioFile) {
            args.push('-i', audioFile.path);
            audioInputIdx = currentInputIdx;
            currentInputIdx++;
          }

          if (voiceOverFile) {
            args.push('-i', voiceOverFile.path);
            voiceInputIdx = currentInputIdx;
            currentInputIdx++;
          }

          let filterComplex = '';

          if (videoFile) {
            filterComplex += `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg_pre]; [bg_pre]null[bg]; `;
          } else {
            filterComplex += `[0:v]null[bg]; `;
          }

          let currentLabel = 'bg';

          if (baseImageInputIdx !== -1) {
            filterComplex += `[${currentLabel}][${baseImageInputIdx}:v]overlay=0:0[bg_with_base]; `;
            currentLabel = 'bg_with_base';
          }

          timingsArr.forEach((t: any, idx: number) => {
            const key = `image_${t.index}`;
            const inputIdx = imageKeysInputIndexes[key];
            if (inputIdx !== undefined) {
              const nextLabel = `v_ol_${idx}`;
              filterComplex += `[${currentLabel}][${inputIdx}:v]overlay=0:0:enable='between(t,${t.start},${t.end})'[${nextLabel}]; `;
              currentLabel = nextLabel;
            }
          });

          let hasAudio = false;
          if (audioFile || voiceOverFile) {
            hasAudio = true;
            if (audioFile && voiceOverFile) {
              filterComplex += `[${audioInputIdx}:a]volume=0.15[bg_music]; [${voiceInputIdx}:a]volume=${voiceVolume}[vo_music]; [bg_music][vo_music]amix=inputs=2:duration=longest:dropout_transition=2[mixed_audio]; `;
            } else if (audioFile) {
              filterComplex += `[${audioInputIdx}:a]volume=1.0[mixed_audio]; `;
            } else if (voiceOverFile) {
              filterComplex += `[${voiceInputIdx}:a]volume=${voiceVolume}[mixed_audio]; `;
            }
          }

          const cleanedFilterComplex = filterComplex
            .split(';')
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0)
            .join('; ');

          if (cleanedFilterComplex) {
            args.push('-filter_complex', cleanedFilterComplex);
            args.push('-map', `[${currentLabel}]`);
          } else {
            args.push('-map', '0:v');
          }

          if (hasAudio) {
            args.push('-map', '[mixed_audio]');
            args.push('-c:a', 'aac', '-b:a', '192k');
          } else {
            args.push('-an');
          }

          args.push('-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p');
          args.push('-t', duration.toString());

          const tempOutputPath = path.join(exportsDir, `bulk_page_${p}_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);
          tempOutputPaths.push(tempOutputPath);
          args.push(tempOutputPath);

          console.log(`Executing FFmpeg for page ${p} with args:`, args.join(' '));

          await new Promise<void>((resolve, reject) => {
            let proc: any;
            try {
              proc = spawn('ffmpeg', args);
              activeProcesses.push(proc);
            } catch (err) {
              return reject(err);
            }

            let lastPageProgress = 0;
            const totalFrames = duration * 30;

            proc.stdout.on('data', (data: any) => {
              const text = data.toString();
              const lines = text.split('\n');
              for (const line of lines) {
                if (line.startsWith('frame=')) {
                  const parts = line.split('=');
                  const frameVal = parseInt(parts[1]?.trim());
                  if (!isNaN(frameVal)) {
                    const pageProgress = Math.min(99, Math.round((frameVal / totalFrames) * 100));
                    if (pageProgress > lastPageProgress) {
                      lastPageProgress = pageProgress;
                      const overallProgress = Math.floor(((p + (pageProgress / 100)) / pageCount) * 100);
                      res.write(JSON.stringify({ status: 'rendering', progress: overallProgress, message: `Rendering page ${p + 1} of ${pageCount}: ${pageProgress}%` }) + '\n');
                    }
                  }
                }
              }
            });

            proc.stderr.on('data', (data: any) => {
              const logText = data.toString();
              const frameMatch = logText.match(/frame=\s*(\d+)/);
              if (frameMatch) {
                const frameVal = parseInt(frameMatch[1]);
                if (!isNaN(frameVal)) {
                  const pageProgress = Math.min(99, Math.round((frameVal / totalFrames) * 100));
                  if (pageProgress > lastPageProgress) {
                    lastPageProgress = pageProgress;
                    const overallProgress = Math.floor(((p + (pageProgress / 100)) / pageCount) * 100);
                    res.write(JSON.stringify({ status: 'rendering', progress: overallProgress, message: `Rendering page ${p + 1} of ${pageCount}: ${pageProgress}%` }) + '\n');
                  }
                }
              }
            });

            proc.on('close', (code: number) => {
              const idx = activeProcesses.indexOf(proc);
              if (idx !== -1) activeProcesses.splice(idx, 1);

              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`FFmpeg exited with non-zero code ${code} rendering page ${p + 1}`));
              }
            });

            proc.on('error', (err: any) => {
              const idx = activeProcesses.indexOf(proc);
              if (idx !== -1) activeProcesses.splice(idx, 1);
              reject(err);
            });
          });

          // Read the compiled mp4 on server and insert to ZIP
          if (fs.existsSync(tempOutputPath)) {
            const fileBuffer = fs.readFileSync(tempOutputPath);
            zip.file(`story-page-${p + 1}.mp4`, fileBuffer);
          } else {
            throw new Error(`Output file matching page ${p + 1} was not found on disk.`);
          }
        }

        // Now bundle the ZIP and save to exportsDir
        res.write(JSON.stringify({ status: 'rendering', progress: 99, message: 'Creating final ZIP file archive on the server...' }) + '\n');
        
        const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
        const zipFilename = `bulk-export-${Date.now()}-${Math.floor(Math.random() * 1000)}.zip`;
        const zipOutputPath = path.join(exportsDir, zipFilename);
        
        fs.writeFileSync(zipOutputPath, zipContent);

        res.write(
          JSON.stringify({
            status: 'completed',
            progress: 100,
            downloadUrl: `/api/download/${zipFilename}`,
          }) + '\n'
        );
        res.end();
      } catch (err: any) {
        console.error('Server-side bulk render failed:', err);
        res.write(
          JSON.stringify({
            status: 'error',
            error: err.message || err,
          }) + '\n'
        );
        res.end();
      } finally {
        cleanupTempFiles();
      }
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
      if (filename.endsWith('.zip')) {
        res.setHeader('Content-Type', 'application/zip');
      } else {
        res.setHeader('Content-Type', 'video/mp4');
      }
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
