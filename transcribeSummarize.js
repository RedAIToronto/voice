import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { AssemblyAI } from 'assemblyai';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { program } from 'commander';
import dotenv from 'dotenv';

// --- Configuration ---
dotenv.config(); // Load .env file
// console.log("--- Loaded Environment Variables ---"); // Removed debug lines
// console.log(process.env); 
// console.log("-------------------------------------");

// Check for output directory - for compatibility with app.js
const OUTPUT_DIR = path.join(process.cwd(), 'output');
// Ensure it exists
if (!fs.existsSync(OUTPUT_DIR)) {
    try {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`Created output directory: ${OUTPUT_DIR}`);
    } catch (err) {
        console.warn(`Note: Could not create output directory: ${err.message}`);
        // Not a fatal error, will use original location as fallback
    }
}

// --- Set ffmpeg/ffprobe paths explicitly ---
// Escape backslashes for JavaScript strings
const ffmpegBinPath = "C:\\Users\\user\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1.1-full_build\\bin";
const ffmpegPath = path.join(ffmpegBinPath, 'ffmpeg.exe');
const ffprobePath = path.join(ffmpegBinPath, 'ffprobe.exe');

try {
    if (fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)) {
        console.log(`Setting explicit ffmpeg path: ${ffmpegPath}`);
        ffmpeg.setFfmpegPath(ffmpegPath);
        console.log(`Setting explicit ffprobe path: ${ffprobePath}`);
        ffmpeg.setFfprobePath(ffprobePath);
    } else {
        console.error("Error: ffmpeg.exe or ffprobe.exe not found at the specified WinGet path:");
        console.error(ffmpegBinPath);
        console.error("Please verify the path or ensure ffmpeg is correctly installed and accessible.");
        process.exit(1);
    }
} catch (err) {
    console.error(`Error accessing ffmpeg/ffprobe paths: ${err}`);
    process.exit(1);
}
// --- End Path Setting ---

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.warn("Warning: OPENAI_API_KEY not found. OpenAI features (if any) will be disabled.");
}
if (!ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY not found in environment variables. Please set it in your .env file.");
    process.exit(1);
}
if (!ASSEMBLYAI_API_KEY) {
    console.error("Error: ASSEMBLYAI_API_KEY not found in environment variables. Please set it in your .env file.");
    process.exit(1);
}

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const assemblyai = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY });

// Constants
const CHUNK_LENGTH_SECONDS = 10 * 60; // 10 minutes per chunk
const MAX_FILE_SIZE_MB = 25; // OpenAI Whisper API limit
const MAX_FILE_SIZE_BYTES = (MAX_FILE_SIZE_MB - 1) * 1024 * 1024; // Use a buffer
const TEMP_DIR_PREFIX = 'audio_chunks_';

// --- Helper Functions ---

/**
 * Creates a temporary directory for storing chunks.
 * @returns {string} Path to the created temporary directory.
 */
function createTempDir() {
    try {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
        console.log(`Created temporary directory: ${tempDir}`);
        return tempDir;
    } catch (err) {
        console.error(`Error creating temporary directory: ${err}`);
        throw err; // Re-throw to stop execution if temp dir creation fails
    }
}

/**
 * Gets the duration of an audio file using ffprobe.
 * @param {string} filePath - Path to the audio file.
 * @returns {Promise<number>} - Duration in seconds.
 */
function getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error(`Error probing file ${filePath}: ${err.message}`);
                console.error("Ensure ffmpeg (and ffprobe) is installed and accessible in your system's PATH.");
                console.error("You can download ffmpeg from https://ffmpeg.org/download.html");
                reject(new Error(`ffprobe error: ${err.message}`));
            } else {
                resolve(metadata.format.duration);
            }
        });
    });
}

/**
 * Splits the audio file into chunks using ffmpeg, adjusting for size limits.
 * @param {string} filePath - Path to the input audio file.
 * @param {string} tempDir - Directory to save chunks.
 * @param {number} chunkLengthSeconds - Desired chunk length in seconds.
 * @returns {Promise<{chunks: string[], format: string}>} - Array of chunk file paths and original format.
 */
async function splitAudio(filePath, tempDir, chunkLengthSeconds = CHUNK_LENGTH_SECONDS) {
    console.log(`Loading audio file: ${filePath}`);
    let totalDuration;
    try {
        totalDuration = await getAudioDuration(filePath);
        console.log(`Audio loaded successfully. Duration: ${totalDuration.toFixed(2)} seconds`);
    } catch (error) {
        // Error already logged in getAudioDuration
        return { chunks: [], format: null }; // Indicate failure
    }

    const fileExtension = path.extname(filePath).substring(1).toLowerCase();
    if (!fileExtension) {
        console.warn("Warning: Could not determine file extension. Assuming 'mp3'.");
        fileExtension = 'mp3';
    }

    const chunks = [];
    let startOffset = 0;
    let i = 0;
    const safetyFactor = 0.9; // Factor to reduce chunk length if size limit is hit

    while (startOffset < totalDuration) {
        let currentChunkLength = chunkLengthSeconds;
        let chunkExported = false;
        let chunkFilePath = '';
        let chunkFailed = false; // Flag to indicate failure within the promise

        // --- Loop to adjust chunk size if necessary ---
        while (!chunkExported && currentChunkLength > 1) { // Don't make chunks smaller than 1 sec
            const endOffset = Math.min(startOffset + currentChunkLength, totalDuration);
            const actualChunkDuration = endOffset - startOffset;

            if (actualChunkDuration <= 0) {
                 console.error(`Error: Cannot create a positive length chunk at offset ${startOffset}.`);
                 break; // Prevent potential infinite loop
            }

            chunkFilePath = path.join(tempDir, `temp_chunk_${i}.${fileExtension}`);
            console.log(`Attempting to export chunk ${i} (start: ${startOffset.toFixed(2)}s, duration: ${actualChunkDuration.toFixed(2)}s) to ${chunkFilePath}...`);

            // --- FFMPEG Promise --- 
            await new Promise((resolve, reject) => {
                const command = ffmpeg(filePath)
                    .setStartTime(startOffset)
                    .setDuration(actualChunkDuration)
                    .outputOptions('-c:a', 'copy'); // Try copying codec first for speed

                // Example: Add bitrate control if needed and not copying codec
                // if (fileExtension === 'mp3') {
                //    command.audioBitrate('64k');
                // }

                command.on('error', (err) => {
                        console.error(`Error exporting chunk ${i}: ${err.message}`);
                        if (fs.existsSync(chunkFilePath)) {
                            try { fs.unlinkSync(chunkFilePath); } catch (e) { console.error(`Failed to delete partial chunk ${chunkFilePath}: ${e}`); }
                        }
                        // Don't set chunkFailed here, let the promise rejection handle it
                        reject(err); // Reject the promise on error
                    })
                    .on('end', () => {
                        // Removed chunkFailed check here, error event should prevent 'end'
                        try {
                            const stats = fs.statSync(chunkFilePath);
                            const actualSizeBytes = stats.size;
                            const actualSizeMB = actualSizeBytes / (1024 * 1024);
                            console.log(`Chunk ${i} exported. Size: ${actualSizeMB.toFixed(2)} MB`);

                            if (actualSizeBytes < MAX_FILE_SIZE_BYTES) {
                                chunks.push(chunkFilePath);
                                startOffset = endOffset; // Move start offset for the next chunk
                                chunkExported = true;
                                resolve(); // Success for this chunk size attempt
                            } else {
                                console.warn(`Chunk ${i} size (${actualSizeMB.toFixed(2)} MB) is too large (limit ~${MAX_FILE_SIZE_MB} MB). Reducing chunk duration.`);
                                try { fs.unlinkSync(chunkFilePath); } catch(e){ console.error(`Failed to delete oversized chunk ${chunkFilePath}: ${e}`);}
                                currentChunkLength = Math.floor(currentChunkLength * safetyFactor); // Reduce length
                                if (currentChunkLength <= 1) {
                                    console.error("Error: Chunk length became too small after reductions. Cannot proceed.");
                                    // Signal failure by rejecting the promise
                                    reject(new Error("Chunk length too small after reductions"));
                                } else {
                                    // Resolve normally; the outer loop will retry with the smaller currentChunkLength
                                    resolve();
                                }
                            }
                        } catch (statErr) {
                             console.error(`Error accessing chunk file ${chunkFilePath} after export: ${statErr}`);
                             // Signal failure by rejecting the promise
                             reject(statErr);
                        }
                    })
                    .save(chunkFilePath);
            }).catch(async (err) => { // <<< MADE THIS ASYNC
                 // This catch now handles rejections from the promise
                 console.error(`Caught error during ffmpeg/check process for chunk ${i}: ${err.message}`);
                 chunkFailed = true; // Set the failure flag for the outer logic
                 // We CAN await here if necessary, but currently not needed.
                 // Example: await someAsyncCleanupIfNeeded();
            });
            // --- End FFMPEG Promise --- 

            // If the promise chain resulted in a failure flag, break the inner size-adjustment loop
            if (chunkFailed) {
                break;
            }

            // If chunk was exported successfully, break the inner loop
            if (chunkExported) {
                break;
            }

        } // --- End of chunk size adjustment (inner while) loop ---

        // If chunkFailed is true after trying size adjustments, abort entirely
        if (chunkFailed) {
            console.error(`Failed to process chunk ${i} due to errors. Aborting splitAudio.`);
            // Cleanup is handled in the main function's finally block
            return { chunks: [], format: fileExtension }; // Indicate failure
        }

        // If we finished the inner loop but the chunk wasn't exported (shouldn't happen with current logic, but safety check)
        if (!chunkExported) {
            console.error(`Logic error: Exited size adjustment loop for chunk ${i} without exporting or failing explicitly. Aborting.`);
             // Cleanup is handled in the main function's finally block
             return { chunks: [], format: fileExtension }; // Indicate failure
        }

        i++; // Increment chunk index only on successful export of a chunk
    } // --- End of main (outer while) loop --- 

    return { chunks, format: fileExtension };
}

/**
 * Transcribes a single audio chunk using AssemblyAI API.
 * Uploads the file and waits for the transcription result.
 * @param {string} chunkPath - Path to the audio chunk file.
 * @returns {Promise<string|null>} - The transcript text or null on error.
 */
async function transcribeChunk(chunkPath) {
    console.log(`Transcribing ${path.basename(chunkPath)} with AssemblyAI...`);
    try {
        // Configuration for the transcription job
        const config = {
            audio: chunkPath,
            // Optional: Add features like speaker_labels, auto_highlights etc.
            // speaker_labels: true,
        };

        // Start the transcription job
        console.log(`Submitting ${path.basename(chunkPath)} to AssemblyAI...`);
        const transcript = await assemblyai.transcripts.transcribe(config);

        // Check transcription status
        if (transcript.status === 'error') {
            console.error(`AssemblyAI Transcription Error for ${path.basename(chunkPath)}: ${transcript.error}`);
            return null;
        }

        if (transcript.status !== 'completed') {
             console.warn(`AssemblyAI Transcription Warning for ${path.basename(chunkPath)}: Status is ${transcript.status}. Text may be missing or incomplete.`);
             // Depending on the status, you might still get text, but it's safer to return null or handle it
             // For simplicity, return null if not completed.
             return null;
        }

        console.log(`Transcription successful for ${path.basename(chunkPath)}`);
        return transcript.text;

    } catch (error) {
        console.error(`Error during AssemblyAI transcription for ${path.basename(chunkPath)}: ${error.message || error}`);
        // Check for specific AssemblyAI errors if needed
        // if (error instanceof AssemblyAI.AssemblyAIError) { ... }
        return null;
    }
}

/**
 * Summarizes the text using Anthropic Claude Sonnet.
 * @param {string} text - The full transcript text.
 * @returns {Promise<string|null>} - The summary text or null on error.
 */
async function summarizeText(text) {
    if (!text || text.trim().length === 0) {
        console.log("No text provided for summarization.");
        return null;
    }

    console.log(`Summarizing the transcript (${text.length} characters)...`);
    try {
        const msg = await anthropic.messages.create({
            model: "claude-3-sonnet-20240229",
            max_tokens: 2048, // Adjust as needed
            system: "You are a helpful assistant designed to summarize long transcripts accurately and concisely.",
            messages: [
                {
                    role: "user",
                    content: `Please provide a concise summary of the following transcript:\n\n--BEGIN TRANSCRIPT--\n${text}\n--END TRANSCRIPT--`
                }
            ]
        });
        console.log("Summarization API call successful.");

        // Extract text from the response content block(s)
        if (msg.content && Array.isArray(msg.content) && msg.content.length > 0) {
             const summaryText = msg.content
                 .filter(block => block.type === 'text')
                 .map(block => block.text)
                 .join('\n'); // Join if there are multiple text blocks (unlikely for summary)

             if (summaryText) {
                  console.log("Summary extracted successfully.");
                  return summaryText;
             } else {
                  console.warn("Warning: No text blocks found in the summary response content.");
                  console.warn("Raw content:", msg.content);
                  return "Could not extract summary. No text blocks found.";
             }
        } else {
            console.warn("Warning: No content block found in the summary response.");
            console.warn("Raw response:", msg);
            return "Could not extract summary. No content returned.";
        }
    } catch (error) {
        console.error(`An unexpected error occurred during summarization: ${error.message || error}`);
         if (error instanceof Anthropic.APIError) {
            console.error(`Anthropic API Error: Status ${error.status}, Type: ${error.type}`);
            console.error("Details:", error.message);
        }
        // console.error(error); // Log full error object if needed
        return null;
    }
}

/**
 * Deletes the temporary directory and its contents.
 * @param {string} tempDir - Path to the temporary directory.
 * @param {string[]} generatedChunks - List of chunk file paths potentially created.
 */
async function cleanupTempDir(tempDir, generatedChunks = []) {
    console.log("Cleaning up temporary files...");
    let cleanedCount = 0;
    let errorCount = 0;

    // Ensure all chunk paths are absolute for reliable deletion
    const absoluteChunkPaths = generatedChunks.map(p => path.resolve(p));

    try {
        if (fs.existsSync(tempDir)) {
            // Optionally double-check we are deleting the intended directory
            if (!path.basename(tempDir).startsWith(TEMP_DIR_PREFIX)) {
                 console.error(`Error: Attempting to delete unexpected directory: ${tempDir}. Aborting cleanup.`);
                 return;
            }

            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                // Safety check: ensure we only delete files we potentially created
                if (absoluteChunkPaths.includes(path.resolve(filePath))) {
                    try {
                        fs.unlinkSync(filePath);
                        cleanedCount++;
                    } catch (unlinkErr) {
                        console.error(`Error deleting chunk file ${filePath}: ${unlinkErr}`);
                        errorCount++;
                    }
                } else {
                     console.warn(`Skipping deletion of unexpected file in temp dir: ${filePath}`);
                }
            }
            // Attempt to remove the directory itself if empty
            fs.rmdirSync(tempDir);
            console.log(`Temporary directory ${tempDir} removed.`);
        } else {
            console.log("Temporary directory not found, nothing to clean up.");
        }
    } catch (err) {
        console.error(`Error during cleanup of ${tempDir}: ${err}`);
        errorCount++;
    }
    console.log(`Cleanup complete. Cleaned ${cleanedCount} files. Encountered ${errorCount} errors.`);
}

/**
 * Main function
 * @param {string} audioFilePath
 * @param {object} options - Additional options
 */
async function main(audioFilePath, options = {}) {
    if (!fs.existsSync(audioFilePath)) {
        console.error(`Error: Audio file not found at ${audioFilePath}`);
        process.exit(1);
    }

    const absoluteAudioPath = path.resolve(audioFilePath); // Use absolute path
    const outputBaseName = path.parse(absoluteAudioPath).name;
    
    // Determine output directory: Default to audio file location unless specified
    let outputDir = path.dirname(absoluteAudioPath);
    // If called from app.js or explicitly using --output flag, use OUTPUT_DIR
    if (options.useOutputDir || (fs.existsSync(OUTPUT_DIR) && options.forceOutputDir)) {
        outputDir = OUTPUT_DIR;
    }
    
    const transcriptFilename = path.join(outputDir, `${outputBaseName}_transcript.txt`);
    const summaryFilename = path.join(outputDir, `${outputBaseName}_summary.txt`);
    
    console.log(`Output files will be saved to: ${outputDir}`);

    let tempDir = '';
    let chunkResult = { chunks: [], format: null };

    try {
        tempDir = createTempDir();

        // --- Splitting ---
        console.log("--- Starting Audio Splitting ---");
        chunkResult = await splitAudio(absoluteAudioPath, tempDir);
        if (!chunkResult || chunkResult.chunks.length === 0) {
            throw new Error("Audio splitting failed or produced no chunks.");
        }
        console.log(`--- Audio Splitting Finished (${chunkResult.chunks.length} chunks created) ---`);

        // --- Transcription ---
        console.log("\n--- Starting Transcription (using AssemblyAI) ---");
        let fullTranscript = "";
        let successfulTranscriptions = 0;
        for (let i = 0; i < chunkResult.chunks.length; i++) {
            const chunkPath = chunkResult.chunks[i];
            console.log(`\n--- Processing Chunk ${i + 1}/${chunkResult.chunks.length} --- (${path.basename(chunkPath)})`);
            const transcriptPart = await transcribeChunk(chunkPath);
            if (transcriptPart !== null) {
                fullTranscript += transcriptPart + "\n\n"; // Add double newline
                successfulTranscriptions++;
            } else {
                console.warn(`Transcription failed for chunk ${i + 1}. Skipping.`);
            }
            // Optional delay
            if (options.delayBetweenChunks && i < chunkResult.chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, options.delayBetweenChunks));
            }
        }
        console.log(`\n--- Transcription Finished (${successfulTranscriptions} successful, ${chunkResult.chunks.length - successfulTranscriptions} failed) ---`);

        // --- Save Full Transcript ---
        if (fullTranscript.trim().length > 0) {
            try {
                fs.writeFileSync(transcriptFilename, fullTranscript, { encoding: 'utf-8' });
                console.log(`Full transcript saved to: ${transcriptFilename}`);
            } catch (e) {
                console.error(`Error saving transcript to ${transcriptFilename}: ${e}`);
            }
        } else {
            console.warn("No transcription text was generated. Transcript file not saved.");
        }

        // --- Summarization ---
        if (fullTranscript.trim().length > 0 && successfulTranscriptions > 0) {
            // Skip summarization if requested
            if (options.skipSummary) {
                console.log("\nSkipping basic summarization as requested.");
            } else {
                console.log("\n--- Starting Summarization ---");
                const summary = await summarizeText(fullTranscript);
                if (summary) {
                    try {
                        fs.writeFileSync(summaryFilename, summary, { encoding: 'utf-8' });
                        console.log(`Summary saved to: ${summaryFilename}`);
                    } catch (e) {
                        console.error(`Error saving summary to ${summaryFilename}: ${e}`);
                    }
                    console.log("--- Summarization Finished ---");
                } else {
                    console.warn("Summarization failed or produced no output.");
                    console.log("--- Summarization Finished (Failed) ---");
                }
            }
        } else if (chunkResult.chunks.length - successfulTranscriptions > 0) {
            console.log("\nSkipping summarization because some transcription chunks failed.");
        } else {
            console.log("\nSkipping summarization because no transcript was generated.");
        }

        // Return the paths for potential use by calling code
        return {
            transcriptPath: fs.existsSync(transcriptFilename) ? transcriptFilename : null,
            summaryPath: fs.existsSync(summaryFilename) ? summaryFilename : null
        };

    } catch (error) {
        console.error(`\n--- An error occurred during processing ---`);
        console.error(error.message || error);
        // console.error(error.stack); // Uncomment for full stack trace
        return { error: error.message || 'Unknown error' };
    } finally {
        // --- Cleanup ---
        if (tempDir) {
            if (options.keepTempFiles) {
                console.log("\nSkipping cleanup as requested. Temporary files remain in:", tempDir);
            } else {
                console.log("\n--- Starting Cleanup ---");
                await cleanupTempDir(tempDir, chunkResult.chunks);
                console.log("--- Cleanup Finished ---");
            }
        }
        console.log("\nProcessing complete.");
    }
}

// --- Command Line Interface ---
program
    .version('1.0.0')
    .description("Transcribe a long audio file using AssemblyAI and summarize it using Anthropic Claude.")
    .argument('<audio_file>', "Path to the input audio file (e.g., recording.mp3, meeting.wav)")
    .option('-o, --output', 'Save to output directory')
    .option('-f, --force-output', 'Force saving to output directory even if called from external script')
    .option('-s, --skip-summary', 'Skip the basic summarization step')
    .option('-k, --keep-temp', 'Keep temporary files after processing')
    .option('-d, --delay <ms>', 'Delay between processing chunks (in milliseconds)')
    .addHelpText('after', `
Examples:
  node transcribeSummarize.js my_recording.mp3
  node transcribeSummarize.js "C:\\Users\\user\\Downloads\\5-4-25 NVO Inflection and Bear Market Rally As Earnings Season Ends.flac"

Requirements:
  - Node.js (v18 or higher recommended)
  - Ffmpeg installed and in PATH (for audio processing)
  - API keys for AssemblyAI and Anthropic set in a .env file:
    ASSEMBLYAI_API_KEY="your-key-here"
    ANTHROPIC_API_KEY="your-key-here"
  - Dependencies installed (npm install)
`)
    .action((audioFile, cmdOptions) => {
        main(audioFile, {
            useOutputDir: cmdOptions.output || false,
            forceOutputDir: cmdOptions.forceOutput || false,
            skipSummary: cmdOptions.skipSummary || false,
            keepTempFiles: cmdOptions.keepTemp || false,
            delayBetweenChunks: cmdOptions.delay ? parseInt(cmdOptions.delay, 10) : null
        }).catch(err => {
            console.error("Unhandled error in main execution:", err);
            process.exit(1);
        });
    });

program.parse(process.argv);

// Handle case where no arguments are provided
if (!program.args.length) {
    program.help();
}

// For potential programmatic usage
export { transcribeChunk, summarizeText, main }; 