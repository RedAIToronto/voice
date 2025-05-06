import fs from 'fs';
import path from 'path';
import { program } from 'commander';
import { exec } from 'child_process';
import { promisify } from 'util';
// Import new UI enhancements
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import boxen from 'boxen';
import figlet from 'figlet';
import readline from 'readline';

const execPromise = promisify(exec);

// Folder structure
const AUDIO_INPUT_DIR = path.join(process.cwd(), 'audio-input');
const OUTPUT_DIR = path.join(process.cwd(), 'output');

// Default prompt for focused summaries
const DEFAULT_PROMPT = "Analyze the following transcript. What is the best positioning for someone holding 7 figures in stablecoins according to the discussion? What potential risks or things should they watch out for based on the transcript's content? Provide a concise summary based on these points.";

// Style configurations for boxen
const boxenOptions = {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
    backgroundColor: '#222'
};

const successBoxOptions = {
    ...boxenOptions,
    borderColor: 'green'
};

const errorBoxOptions = {
    ...boxenOptions,
    borderColor: 'red'
};

const infoBoxOptions = {
    ...boxenOptions,
    borderColor: 'blue'
};

// Ensure the directories exist
for (const dir of [AUDIO_INPUT_DIR, OUTPUT_DIR]) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(chalk.cyan(`Created directory: ${dir}`));
    }
}

// Display app header
function displayHeader() {
    console.clear();
    console.log(
        chalk.cyan(
            figlet.textSync('Voice Transcriber', { 
                font: 'Standard',
                horizontalLayout: 'default',
                verticalLayout: 'default',
                width: 80,
                whitespaceBreak: true
            })
        )
    );
    console.log(boxen(chalk.white(`A tool to transcribe audio files and generate AI summaries.`), infoBoxOptions));
}

// Show success message
function showSuccess(message) {
    console.log(boxen(chalk.green(message), successBoxOptions));
}

// Show error message
function showError(message) {
    console.log(boxen(chalk.red(message), errorBoxOptions));
}

// Show info message
function showInfo(message) {
    console.log(boxen(chalk.blue(message), infoBoxOptions));
}

// Function to process a single audio file
async function processAudioFile(audioFilePath, options = {}) {
    const filename = path.basename(audioFilePath);
    const outputBasename = path.parse(filename).name;
    
    console.log(chalk.cyan(`\n▶️ Processing: ${chalk.bold(filename)}`));
    
    try {
        // Check if transcript already exists
        const transcriptOutputPath = path.join(OUTPUT_DIR, `${outputBasename}_transcript.txt`);
        const basicSummaryOutputPath = path.join(OUTPUT_DIR, `${outputBasename}_summary.txt`);
        let skipTranscription = false;
        
        // Check if transcript exists in output directory already
        if (fs.existsSync(transcriptOutputPath)) {
            const { continueExisting } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'continueExisting',
                    message: `Found existing transcript. Use this instead of re-transcribing?`,
                    default: true
                }
            ]);
            
            skipTranscription = continueExisting;
            if (skipTranscription) {
                console.log(chalk.green('Using existing transcript.'));
            }
        }
        
        // 1. Transcribe (and basic summarize) if needed
        if (!skipTranscription) {
            console.log(chalk.cyan('\n🔊 Step 1: Transcribing and generating basic summary...'));
            
            // Run the transcribeSummarize.js script
            const transcribeCmd = `node transcribeSummarize.js "${audioFilePath}"${options.useOutputDir ? ' --output' : ''}`;
            
            try {
                // Show spinner during transcription
                const spinner = ora('Transcribing audio. This may take a while...').start();
                
                const { stdout, stderr } = await execPromise(transcribeCmd);
                
                spinner.succeed('Transcription completed successfully.');
                
                // Move the output files to the output directory if they were created elsewhere
                const originalTranscriptPath = path.join(path.dirname(audioFilePath), `${outputBasename}_transcript.txt`);
                const originalSummaryPath = path.join(path.dirname(audioFilePath), `${outputBasename}_summary.txt`);
                
                // Check if files were created and move them if needed
                if (fs.existsSync(originalTranscriptPath) && originalTranscriptPath !== transcriptOutputPath) {
                    fs.copyFileSync(originalTranscriptPath, transcriptOutputPath);
                    fs.unlinkSync(originalTranscriptPath);
                    console.log(chalk.green(`Moved transcript to: ${transcriptOutputPath}`));
                }
                
                if (fs.existsSync(originalSummaryPath) && originalSummaryPath !== basicSummaryOutputPath) {
                    fs.copyFileSync(originalSummaryPath, basicSummaryOutputPath);
                    fs.unlinkSync(originalSummaryPath);
                    console.log(chalk.green(`Moved basic summary to: ${basicSummaryOutputPath}`));
                }
            } catch (error) {
                showError(`Error transcribing file: ${error.message}`);
                if (options.continueOnError) {
                    console.log(chalk.yellow('Continuing to next file...'));
                    return false;
                } else {
                    throw error;
                }
            }
        }
        
        // 2. Generate focused summary if requested
        if (options.generateFocusedSummary) {
            console.log(chalk.cyan('\n💡 Step 2: Generating focused summary...'));
            
            // Check if the transcript file exists
            if (!fs.existsSync(transcriptOutputPath)) {
                showError(`Transcript file not found at ${transcriptOutputPath}`);
                return false;
            }
            
            // Determine if we need to use a custom prompt
            let customPromptArg = '';
            if (options.customPrompt) {
                // Escape quotes for command line
                const escapedPrompt = options.customPrompt.replace(/"/g, '\\"');
                customPromptArg = ` --custom-prompt "${escapedPrompt}"`;
            }
            
            // Run the summarize_focus.js script
            const focusSummarizeCmd = `node summarize_focus.js "${transcriptOutputPath}"${options.useOutputDir ? ' --output' : ''}${customPromptArg}`;
            
            try {
                // Show spinner during summarization
                const spinner = ora('Generating focused summary...').start();
                
                const { stdout, stderr } = await execPromise(focusSummarizeCmd);
                
                spinner.succeed('Focused summarization completed successfully.');
                const outputPath = path.join(OUTPUT_DIR, `${outputBasename}_focused_summary.txt`);
                console.log(chalk.green(`Focused summary saved to: ${outputPath}`));
            } catch (error) {
                showError(`Error generating focused summary: ${error.message}`);
                return false;
            }
        }
        
        return true;
    } catch (error) {
        showError(`Failed to process file ${filename}: ${error.message}`);
        return false;
    }
}

// Find existing transcripts in the output directory
function findExistingTranscripts() {
    try {
        const files = fs.readdirSync(OUTPUT_DIR);
        return files
            .filter(file => file.endsWith('_transcript.txt'))
            .map(file => {
                const fullPath = path.join(OUTPUT_DIR, file);
                const stats = fs.statSync(fullPath);
                return {
                    name: file,
                    path: fullPath,
                    size: stats.size,
                    created: stats.birthtime
                };
            })
            .sort((a, b) => b.created - a.created); // Sort newest first
    } catch (error) {
        console.error(chalk.red(`Error finding existing transcripts: ${error.message}`));
        return [];
    }
}

// Process all audio files in the input directory
async function processAllAudioFiles(options = {}) {
    try {
        const files = fs.readdirSync(AUDIO_INPUT_DIR);
        const audioFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'].includes(ext);
        });
        
        if (audioFiles.length === 0) {
            showInfo(`No audio files found in ${AUDIO_INPUT_DIR}`);
            
            // Auto-detect: Check if there are existing transcripts we can work with
            const existingTranscripts = findExistingTranscripts();
            if (existingTranscripts.length > 0) {
                console.log(chalk.cyan(`\nFound ${chalk.bold(existingTranscripts.length)} existing transcript(s) in output directory.`));
                
                const { useExisting } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'useExisting',
                        message: 'Would you like to generate focused summaries from these instead?',
                        default: true
                    }
                ]);
                
                if (useExisting) {
                    await processExistingTranscripts(options);
                    return;
                }
            }
            
            console.log(chalk.yellow(`Please place your audio files in the '${chalk.bold('audio-input')}' folder and try again.`));
            return;
        }
        
        // Ask about custom prompt if generating focused summaries
        if (options.generateFocusedSummary) {
            const { useCustomPrompt } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'useCustomPrompt',
                    message: 'Would you like to customize the stablecoin analysis prompt?',
                    default: false
                }
            ]);
            
            if (useCustomPrompt) {
                console.log(chalk.blue(`\nDefault prompt: "${DEFAULT_PROMPT}"`));
                
                const { customPrompt } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'customPrompt',
                        message: 'Enter your custom prompt (or press Enter to use default):',
                        default: ''
                    }
                ]);
                
                if (customPrompt.trim()) {
                    options.customPrompt = customPrompt.trim();
                    console.log(chalk.green('Using custom prompt for all summaries.'));
                }
            }
        }
        
        console.log(chalk.cyan(`\nFound ${chalk.bold(audioFiles.length)} audio file(s) to process:`));
        
        // Format file listing with colors and details
        audioFiles.forEach((file, index) => {
            const filePath = path.join(AUDIO_INPUT_DIR, file);
            const stats = fs.statSync(filePath);
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(chalk.white(`  ${chalk.cyan(index + 1)}. ${chalk.yellow(file)} (${chalk.green(sizeMB + ' MB')})`));
        });
        
        const { confirmProcess } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirmProcess',
                message: 'Process all these files?',
                default: true
            }
        ]);
        
        if (!confirmProcess) {
            console.log(chalk.yellow('Operation cancelled by user.'));
            return;
        }
        
        console.log(chalk.cyan(boxen(`Starting batch processing of ${chalk.bold(audioFiles.length)} files`, infoBoxOptions)));
        
        let successCount = 0;
        for (let i = 0; i < audioFiles.length; i++) {
            const file = audioFiles[i];
            const filePath = path.join(AUDIO_INPUT_DIR, file);
            
            console.log(chalk.cyan(`\n[${i+1}/${audioFiles.length}] Processing ${chalk.bold(file)}...`));
            const success = await processAudioFile(filePath, options);
            
            if (success) {
                successCount++;
                console.log(chalk.green(`\n✅ Successfully processed: ${file}`));
            } else {
                console.log(chalk.red(`\n❌ Failed to process: ${file}`));
            }
        }
        
        showSuccess(`Batch processing complete!\nSuccessfully processed ${successCount} out of ${audioFiles.length} files.\nResults saved to: ${OUTPUT_DIR}`);
    } catch (error) {
        showError(`Error processing audio files: ${error.message}`);
    }
}

// Process existing transcripts in the output directory
async function processExistingTranscripts(options = {}) {
    const existingTranscripts = findExistingTranscripts();
    
    if (existingTranscripts.length === 0) {
        showInfo("No existing transcripts found in the output directory.");
        return;
    }
    
    console.log(chalk.cyan(`\nFound ${chalk.bold(existingTranscripts.length)} transcript(s):`));
    
    // Format transcript listing with colors and details
    existingTranscripts.forEach((transcript, index) => {
        const date = transcript.created.toLocaleString();
        const sizeMB = (transcript.size / (1024 * 1024)).toFixed(2);
        console.log(chalk.white(`  ${chalk.cyan(index + 1)}. ${chalk.yellow(transcript.name)} (${chalk.green(sizeMB + ' MB')}, created: ${chalk.blue(date)})`));
    });
    
    // Ask about custom prompt
    if (options.generateFocusedSummary !== false) {
        const { useCustomPrompt } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'useCustomPrompt',
                message: 'Would you like to customize the stablecoin analysis prompt?',
                default: false
            }
        ]);
        
        if (useCustomPrompt) {
            console.log(chalk.blue(`\nDefault prompt: "${DEFAULT_PROMPT}"`));
            
            const { customPrompt } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'customPrompt',
                    message: 'Enter your custom prompt (or press Enter to use default):',
                    default: ''
                }
            ]);
            
            if (customPrompt.trim()) {
                options.customPrompt = customPrompt.trim();
                console.log(chalk.green('Using custom prompt for all summaries.'));
            }
        }
    }
    
    // Confirm processing
    const { confirmProcess } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmProcess',
            message: 'Generate focused summaries for all these transcripts?',
            default: true
        }
    ]);
    
    if (!confirmProcess) {
        console.log(chalk.yellow('Operation cancelled by user.'));
        return;
    }
    
    console.log(chalk.cyan(boxen(`Starting batch processing of ${chalk.bold(existingTranscripts.length)} transcript(s)`, infoBoxOptions)));
    
    let successCount = 0;
    for (let i = 0; i < existingTranscripts.length; i++) {
        const transcript = existingTranscripts[i];
        
        console.log(chalk.cyan(`\n[${i+1}/${existingTranscripts.length}] Processing ${chalk.bold(transcript.name)}...`));
        
        // Determine if we need to use a custom prompt
        let customPromptArg = '';
        if (options.customPrompt) {
            // Escape quotes for command line
            const escapedPrompt = options.customPrompt.replace(/"/g, '\\"');
            customPromptArg = ` --custom-prompt "${escapedPrompt}"`;
        }
        
        // Run the summarize_focus.js script
        const focusSummarizeCmd = `node summarize_focus.js "${transcript.path}"${options.useOutputDir ? ' --output' : ''}${customPromptArg}`;
        
        try {
            // Show spinner during summarization
            const spinner = ora('Generating focused summary...').start();
            
            const { stdout, stderr } = await execPromise(focusSummarizeCmd);
            
            spinner.succeed('Focused summarization completed successfully.');
            successCount++;
            console.log(chalk.green(`\n✅ Successfully generated focused summary for: ${transcript.name}`));
        } catch (error) {
            showError(`Error generating focused summary: ${error.message}`);
            console.log(chalk.red(`\n❌ Failed to process: ${transcript.name}`));
        }
    }
    
    showSuccess(`Batch processing complete!\nSuccessfully processed ${successCount} out of ${existingTranscripts.length} transcripts.\nResults saved to: ${OUTPUT_DIR}`);
}

// Process a single file specified by path
async function processSingleFile(filePath, options = {}) {
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
        showError(`File not found at ${filePath}`);
        return;
    }
    
    // Check file type
    const ext = path.extname(filePath).toLowerCase();
    
    // If it's a transcript file
    if (ext === '.txt' && filePath.includes('_transcript')) {
        console.log(chalk.cyan(`\n${boxen(`Processing transcript file: ${chalk.bold(path.basename(filePath))}`, infoBoxOptions)}`));
        
        // Ask about custom prompt if generating focused summaries
        if (options.generateFocusedSummary) {
            const { useCustomPrompt } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'useCustomPrompt',
                    message: 'Would you like to customize the stablecoin analysis prompt?',
                    default: false
                }
            ]);
            
            if (useCustomPrompt) {
                console.log(chalk.blue(`\nDefault prompt: "${DEFAULT_PROMPT}"`));
                
                const { customPrompt } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'customPrompt',
                        message: 'Enter your custom prompt (or press Enter to use default):',
                        default: ''
                    }
                ]);
                
                if (customPrompt.trim()) {
                    options.customPrompt = customPrompt.trim();
                    console.log(chalk.green('Using custom prompt.'));
                }
            }
        }
        
        // Determine if we need to use a custom prompt
        let customPromptArg = '';
        if (options.customPrompt) {
            // Escape quotes for command line
            const escapedPrompt = options.customPrompt.replace(/"/g, '\\"');
            customPromptArg = ` --custom-prompt "${escapedPrompt}"`;
        }
        
        // Run the summarize_focus.js script
        const focusSummarizeCmd = `node summarize_focus.js "${filePath}"${options.useOutputDir ? ' --output' : ''}${customPromptArg}`;
        
        try {
            // Show spinner during summarization
            const spinner = ora('Generating focused summary...').start();
            
            const { stdout, stderr } = await execPromise(focusSummarizeCmd);
            
            spinner.succeed('Focused summarization completed successfully.');
            console.log(chalk.green(`\n✅ Successfully generated focused summary for: ${path.basename(filePath)}`));
            return true;
        } catch (error) {
            spinner.fail(`Error generating focused summary`);
            showError(error.message);
            console.log(chalk.red(`\n❌ Failed to process: ${path.basename(filePath)}`));
            return false;
        }
    }
    // If it's an audio file
    else if (['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'].includes(ext)) {
        console.log(chalk.cyan(`\n${boxen(`Processing audio file: ${chalk.bold(path.basename(filePath))}`, infoBoxOptions)}`));
        
        // Ask about custom prompt if generating focused summaries
        if (options.generateFocusedSummary) {
            const { useCustomPrompt } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'useCustomPrompt',
                    message: 'Would you like to customize the stablecoin analysis prompt?',
                    default: false
                }
            ]);
            
            if (useCustomPrompt) {
                console.log(chalk.blue(`\nDefault prompt: "${DEFAULT_PROMPT}"`));
                
                const { customPrompt } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'customPrompt',
                        message: 'Enter your custom prompt (or press Enter to use default):',
                        default: ''
                    }
                ]);
                
                if (customPrompt.trim()) {
                    options.customPrompt = customPrompt.trim();
                    console.log(chalk.green('Using custom prompt.'));
                }
            }
        }
        
        const success = await processAudioFile(filePath, options);
        
        if (success) {
            console.log(chalk.green(`\n✅ Successfully processed: ${path.basename(filePath)}`));
            return true;
        } else {
            console.log(chalk.red(`\n❌ Failed to process: ${path.basename(filePath)}`));
            return false;
        }
    } 
    else {
        showError(`File ${filePath} is not a supported audio format or transcript file.`);
        console.log(chalk.yellow("Supported audio formats: .mp3, .wav, .m4a, .flac, .ogg, .aac"));
        console.log(chalk.yellow("Supported transcript format: text files with '_transcript' in the name."));
        return false;
    }
}

/**
 * Gets all output files (transcripts and summaries) sorted by creation date
 * @returns {Array<Object>} Array of file objects with path, type, and stats
 */
function getOutputFiles() {
    try {
        if (!fs.existsSync(OUTPUT_DIR)) {
            return [];
        }
        
        const files = fs.readdirSync(OUTPUT_DIR);
        return files
            .filter(file => file.endsWith('_transcript.txt') || 
                           file.endsWith('_summary.txt') ||
                           file.endsWith('_focused_summary.txt'))
            .map(file => {
                const fullPath = path.join(OUTPUT_DIR, file);
                const stats = fs.statSync(fullPath);
                
                // Determine file type
                let type = 'unknown';
                if (file.endsWith('_transcript.txt')) {
                    type = 'transcript';
                } else if (file.endsWith('_focused_summary.txt')) {
                    type = 'focused_summary';
                } else if (file.endsWith('_summary.txt')) {
                    type = 'summary';
                }
                
                return {
                    name: file,
                    path: fullPath,
                    type: type,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            })
            .sort((a, b) => b.modified - a.modified); // Sort by most recently modified first
    } catch (error) {
        console.error(chalk.red(`Error getting output files: ${error.message}`));
        return [];
    }
}

/**
 * View a text file with interactive pagination
 * @param {string} filePath - Path to the file to view
 * @param {Object} options - View options
 */
async function viewTextFile(filePath, options = {}) {
    if (!fs.existsSync(filePath)) {
        showError(`File not found: ${filePath}`);
        return;
    }
    
    try {
        const fileContents = fs.readFileSync(filePath, { encoding: 'utf-8' });
        const fileName = path.basename(filePath);
        
        // Determine file type from name for styling
        let fileType = 'File';
        let headerColor = chalk.white;
        let borderColor = 'white';
        
        if (fileName.endsWith('_transcript.txt')) {
            fileType = 'Transcript';
            headerColor = chalk.cyan;
            borderColor = 'cyan';
        } else if (fileName.endsWith('_focused_summary.txt')) {
            fileType = 'Focused Summary';
            headerColor = chalk.magenta;
            borderColor = 'magenta';
        } else if (fileName.endsWith('_summary.txt')) {
            fileType = 'Basic Summary';
            headerColor = chalk.green;
            borderColor = 'green';
        }
        
        // Clear console and show file info
        console.clear();
        console.log(headerColor.bold(`\n${fileType}: ${fileName}`));
        
        // Get stats
        const stats = fs.statSync(filePath);
        const fileSize = (stats.size / 1024).toFixed(2) + ' KB';
        const modified = stats.mtime.toLocaleString();
        console.log(headerColor(`Size: ${fileSize}  |  Last Modified: ${modified}\n`));
        
        // Pagination setup
        const lines = fileContents.split('\n');
        const linesPerPage = process.stdout.rows - 15; // account for UI elements
        const totalPages = Math.ceil(lines.length / linesPerPage);
        let currentPage = 0;
        
        let viewing = true;
        
        // Display pagination info and controls
        const displayPageInfo = () => {
            const start = currentPage * linesPerPage;
            const end = Math.min(start + linesPerPage, lines.length);
            console.log(chalk.dim(`\nShowing lines ${start+1}-${end} of ${lines.length}`));
            console.log(chalk.dim(`Page ${currentPage+1} of ${totalPages}`));
            console.log(chalk.dim(`\nControls: `) + 
                       chalk.white.bold(`[n]`) + chalk.dim(`ext page, `) + 
                       chalk.white.bold(`[p]`) + chalk.dim(`revious page, `) + 
                       chalk.white.bold(`[f]`) + chalk.dim(`irst page, `) + 
                       chalk.white.bold(`[l]`) + chalk.dim(`ast page, `) + 
                       chalk.white.bold(`[#]`) + chalk.dim(`go to page #, `) + 
                       chalk.white.bold(`[q]`) + chalk.dim(`uit`));
        };
        
        // Display current page content
        const displayCurrentPage = () => {
            console.clear();
            console.log(headerColor.bold(`\n${fileType}: ${fileName}`));
            console.log(headerColor(`Size: ${fileSize}  |  Last Modified: ${modified}\n`));
            
            const start = currentPage * linesPerPage;
            const end = Math.min(start + linesPerPage, lines.length);
            
            const contentLines = lines.slice(start, end);
            
            // Create a box for the content
            const content = contentLines.join('\n');
            console.log(boxen(content, {
                padding: 1,
                margin: 0,
                borderStyle: 'round',
                borderColor: borderColor
            }));
            
            displayPageInfo();
        };
        
        // Process keypress
        const processKey = async () => {
            const { key } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'key',
                    message: 'Command (or page #, or press Enter for next page):',
                    default: 'n'
                }
            ]);
            
            // Check if input is a number (for direct page navigation)
            const pageNum = parseInt(key);
            if (!isNaN(pageNum) && pageNum > 0 && pageNum <= totalPages) {
                currentPage = pageNum - 1; // Convert to 0-based index
                return;
            }
            
            switch(key.toLowerCase()) {
                case 'n':
                case 'next':
                    if (currentPage < totalPages - 1) currentPage++;
                    break;
                case 'p':
                case 'prev':
                case 'previous':
                    if (currentPage > 0) currentPage--;
                    break;
                case 'f':
                case 'first':
                    currentPage = 0;
                    break;
                case 'l':
                case 'last':
                    currentPage = totalPages - 1;
                    break;
                case 'q':
                case 'quit':
                case 'exit':
                    viewing = false;
                    break;
                default:
                    // Default to next page on Enter or unknown command
                    if (currentPage < totalPages - 1) currentPage++;
                    break;
            }
        };
        
        // Main viewing loop
        while (viewing) {
            displayCurrentPage();
            await processKey();
        }
        
        console.clear();
        return true;
        
    } catch (error) {
        showError(`Error viewing file: ${error.message}`);
        return false;
    }
}

/**
 * Interactive file browser for output directory
 */
async function browseOutputFiles() {
    const files = getOutputFiles();
    
    if (files.length === 0) {
        showInfo("No output files found. Process some audio files first.");
        return;
    }
    
    // Group files by type
    const transcripts = files.filter(f => f.type === 'transcript');
    const summaries = files.filter(f => f.type === 'summary');
    const focusedSummaries = files.filter(f => f.type === 'focused_summary');
    
    console.log(chalk.cyan.bold("\nOutput Files:"));
    
    if (transcripts.length > 0) {
        console.log(chalk.cyan(`\n📝 Transcripts (${transcripts.length}):`));
        transcripts.forEach((file, index) => {
            const date = file.modified.toLocaleString();
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            console.log(chalk.white(`  ${chalk.cyan(index + 1)}. ${chalk.yellow(file.name)} (${chalk.green(sizeMB + ' MB')}, modified: ${chalk.blue(date)})`));
        });
    }
    
    if (summaries.length > 0) {
        console.log(chalk.green(`\n📋 Basic Summaries (${summaries.length}):`));
        summaries.forEach((file, index) => {
            const date = file.modified.toLocaleString();
            const sizeKB = (file.size / 1024).toFixed(2);
            console.log(chalk.white(`  ${chalk.green(index + 1)}. ${chalk.yellow(file.name)} (${chalk.green(sizeKB + ' KB')}, modified: ${chalk.blue(date)})`));
        });
    }
    
    if (focusedSummaries.length > 0) {
        console.log(chalk.magenta(`\n💡 Focused Summaries (${focusedSummaries.length}):`));
        focusedSummaries.forEach((file, index) => {
            const date = file.modified.toLocaleString();
            const sizeKB = (file.size / 1024).toFixed(2);
            console.log(chalk.white(`  ${chalk.magenta(index + 1)}. ${chalk.yellow(file.name)} (${chalk.green(sizeKB + ' KB')}, modified: ${chalk.blue(date)})`));
        });
    }
    
    // Construct choices for file selection
    let choices = [];
    
    // Add option to view latest files
    if (files.length > 0) {
        const latestFile = files[0];
        choices.push({
            name: `🕒 View latest file: ${chalk.yellow(latestFile.name)} (${chalk.green(new Date(latestFile.modified).toLocaleString())})`,
            value: { file: latestFile, action: 'view' }
        });
    }
    
    // Group by audio name (find all related files)
    const fileGroups = {};
    files.forEach(file => {
        // Extract the base name without the _transcript, _summary, etc.
        let baseName = file.name.replace(/_transcript\.txt$/, '')
                           .replace(/_summary\.txt$/, '')
                           .replace(/_focused_summary\.txt$/, '');
        
        if (!fileGroups[baseName]) {
            fileGroups[baseName] = [];
        }
        fileGroups[baseName].push(file);
    });
    
    // Add option to view file sets (transcript + summaries for a single audio file)
    const audioSources = Object.keys(fileGroups);
    if (audioSources.length > 0) {
        choices.push({ type: 'separator', name: '─── View complete file sets ───' });
        
        audioSources.forEach(baseName => {
            const group = fileGroups[baseName];
            const types = group.map(f => f.type).join(', ');
            choices.push({
                name: `📂 ${chalk.yellow(baseName)} (${chalk.dim(types)})`,
                value: { group: group, baseName: baseName, action: 'group' }
            });
        });
    }
    
    // Add options to browse by file type
    choices.push({ type: 'separator', name: '─── Browse by file type ───' });
    
    if (transcripts.length > 0) {
        choices.push({
            name: `📝 All Transcripts (${transcripts.length})`,
            value: { files: transcripts, action: 'browse_type', type: 'transcript' }
        });
    }
    
    if (summaries.length > 0) {
        choices.push({
            name: `📋 All Basic Summaries (${summaries.length})`,
            value: { files: summaries, action: 'browse_type', type: 'summary' }
        });
    }
    
    if (focusedSummaries.length > 0) {
        choices.push({
            name: `💡 All Focused Summaries (${focusedSummaries.length})`,
            value: { files: focusedSummaries, action: 'browse_type', type: 'focused_summary' }
        });
    }
    
    choices.push({ type: 'separator' });
    choices.push({
        name: '🔙 Back to main menu',
        value: { action: 'back' }
    });
    
    // Prompt user to select a file
    const { selection } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selection',
            message: 'Select a file to view:',
            choices: choices,
            pageSize: 20
        }
    ]);
    
    // Handle selection
    if (selection.action === 'back') {
        return;
    } else if (selection.action === 'view') {
        await viewTextFile(selection.file.path);
    } else if (selection.action === 'group') {
        // Let user pick which file from the group
        const groupChoices = selection.group.map(file => {
            let displayType;
            switch(file.type) {
                case 'transcript': displayType = '📝 Transcript'; break;
                case 'summary': displayType = '📋 Basic Summary'; break;
                case 'focused_summary': displayType = '💡 Focused Summary'; break;
                default: displayType = 'File';
            }
            
            return {
                name: `${displayType}: ${chalk.yellow(file.name)}`,
                value: file
            };
        });
        
        groupChoices.push({ type: 'separator' });
        groupChoices.push({
            name: '🔙 Back to file browser',
            value: 'back'
        });
        
        const { groupFile } = await inquirer.prompt([
            {
                type: 'list',
                name: 'groupFile',
                message: `Select a file for ${chalk.yellow(selection.baseName)}:`,
                choices: groupChoices
            }
        ]);
        
        if (groupFile !== 'back') {
            await viewTextFile(groupFile.path);
        } else {
            await browseOutputFiles(); // Go back to file browser
        }
    } else if (selection.action === 'browse_type') {
        const typeFiles = selection.files;
        const typeChoices = typeFiles.map(file => ({
            name: `${chalk.yellow(file.name)}`,
            value: file
        }));
        
        typeChoices.push({ type: 'separator' });
        typeChoices.push({
            name: '🔙 Back to file browser',
            value: 'back'
        });
        
        const { typeFile } = await inquirer.prompt([
            {
                type: 'list',
                name: 'typeFile',
                message: `Select a ${selection.type} file to view:`,
                choices: typeChoices
            }
        ]);
        
        if (typeFile !== 'back') {
            await viewTextFile(typeFile.path);
        } else {
            await browseOutputFiles(); // Go back to file browser
        }
    }
}

async function runInteractiveMenu() {
    displayHeader();
    
    // Auto-detect: Check if there are existing transcripts we can work with
    const existingTranscripts = findExistingTranscripts();
    if (existingTranscripts.length > 0) {
        console.log(chalk.cyan(`Found ${chalk.bold(existingTranscripts.length)} existing transcript(s) in output directory.`));
    }
    
    // Auto-detect: Check if there are audio files to process
    let audioFileCount = 0;
    try {
        const files = fs.readdirSync(AUDIO_INPUT_DIR);
        audioFileCount = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'].includes(ext);
        }).length;
        
        if (audioFileCount > 0) {
            console.log(chalk.cyan(`Found ${chalk.bold(audioFileCount)} audio file(s) in the input directory.`));
        }
    } catch (error) {
        console.error(chalk.red(`Error checking audio files: ${error.message}`));
    }
    
    // Check for output files
    const outputFiles = getOutputFiles();
    const outputFileCount = outputFiles.length;
    if (outputFileCount > 0) {
        console.log(chalk.cyan(`Found ${chalk.bold(outputFileCount)} output file(s) in the output directory.`));
    }
    
    let exitApp = false;
    
    while (!exitApp) {
        console.log('');
        
        // Build menu options based on available resources
        const menuChoices = [];
        
        if (audioFileCount > 0) {
            menuChoices.push({
                name: `🔊 Process all ${audioFileCount} audio files in the 'audio-input' folder`,
                value: 'process_audio'
            });
        } else {
            menuChoices.push({
                name: '🔊 Process audio files (none detected in input folder)',
                value: 'process_audio'
            });
        }
        
        if (existingTranscripts.length > 0) {
            menuChoices.push({
                name: `📝 Generate focused summaries for ${existingTranscripts.length} existing transcripts`,
                value: 'process_transcripts'
            });
        }
        
        menuChoices.push(
            { 
                name: '📂 Process a specific file (audio or transcript)', 
                value: 'process_file' 
            }
        );
        
        // Add file viewer option with count if files exist
        if (outputFileCount > 0) {
            menuChoices.push({
                name: `📚 View transcripts and summaries (${outputFileCount} files)`, 
                value: 'view_files' 
            });
        } else {
            menuChoices.push({
                name: '📚 View transcripts and summaries (no files yet)', 
                value: 'view_files' 
            });
        }
        
        menuChoices.push(
            { 
                name: 'ℹ️ Show help/instructions', 
                value: 'help' 
            },
            { 
                name: '🚪 Exit', 
                value: 'exit' 
            }
        );
        
        // Present menu with inquirer
        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: menuChoices,
                pageSize: 10
            }
        ]);
        
        // Handle the selected action
        switch (action) {
            case 'process_audio':
                const { includeFocused } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'includeFocused',
                        message: 'Also generate focused summaries for stablecoin strategy?',
                        default: true
                    }
                ]);
                
                await processAllAudioFiles({ 
                    generateFocusedSummary: includeFocused,
                    continueOnError: true,
                    useOutputDir: true
                });
                break;
                
            case 'process_transcripts':
                await processExistingTranscripts({ 
                    generateFocusedSummary: true,
                    useOutputDir: true
                });
                break;
                
            case 'process_file':
                const { filePath } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'filePath',
                        message: 'Enter the full path to the audio or transcript file:',
                        validate: (input) => input.trim() ? true : 'Please enter a valid file path'
                    }
                ]);
                
                if (filePath.trim()) {
                    const { includeFocusedSingle } = await inquirer.prompt([
                        {
                            type: 'confirm',
                            name: 'includeFocusedSingle',
                            message: 'Generate focused summary for stablecoin strategy?',
                            default: true
                        }
                    ]);
                    
                    await processSingleFile(filePath.trim(), {
                        generateFocusedSummary: includeFocusedSingle,
                        useOutputDir: true
                    });
                }
                break;
                
            case 'view_files':
                await browseOutputFiles();
                break;
                
            case 'help':
                displayHelp();
                break;
                
            case 'exit':
                console.log(chalk.cyan('Exiting application. Goodbye!'));
                exitApp = true;
                break;
                
            default:
                console.log(chalk.yellow('Invalid choice. Please try again.'));
        }
        
        // Pause before returning to menu
        if (!exitApp) {
            await inquirer.prompt([
                {
                    type: 'input',
                    name: 'continue',
                    message: 'Press Enter to continue...'
                }
            ]);
            displayHeader();
        }
    }
}

function displayHelp() {
    displayHeader();
    
    const helpText = `
${chalk.bold.underline('ABOUT THIS APP')}
This application processes audio recordings, transcribes them, and 
generates summaries, including specialized analysis for stablecoin 
investment strategies.

${chalk.bold.underline('FOLDER STRUCTURE')}
${chalk.yellow('audio-input/')} - Place your audio files in this folder for batch processing
${chalk.yellow('output/')} - All transcripts and summaries are saved here

${chalk.bold.underline('SUPPORTED FILE TYPES')}
${chalk.green('Audio:')} .mp3, .wav, .m4a, .flac, .ogg, .aac
${chalk.green('Transcript:')} Any .txt file with '_transcript' in the name

${chalk.bold.underline('PROCESSING STEPS')}
1. ${chalk.cyan('Audio splitting')} (for large files)
2. ${chalk.cyan('Transcription')} using AssemblyAI API
3. ${chalk.cyan('Basic summary')} generation using Anthropic Claude API
4. ${chalk.cyan('(Optional) Focused summary')} with stablecoin investment analysis
   - You can customize the prompt for this analysis

${chalk.bold.underline('API REQUIREMENTS')}
Your ${chalk.yellow('.env')} file must contain:
  ${chalk.blue('ASSEMBLYAI_API_KEY')}="your-key-here"
  ${chalk.blue('ANTHROPIC_API_KEY')}="your-key-here"

${chalk.bold.underline('TROUBLESHOOTING')}
- If transcription fails, check your internet connection and API keys
- Large audio files (>2 hours) may take significant time to process
`;

    console.log(boxen(helpText, { 
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
        width: 75
    }));
}

// Command-line interface
program
    .version('1.0.0')
    .description('Voice recording transcription and summarization app')
    .option('-a, --all', 'Process all audio files in the input directory')
    .option('-f, --file <path>', 'Process a specific audio file')
    .option('-s, --summary', 'Generate focused stablecoin summary')
    .option('-i, --interactive', 'Run in interactive mode with menu')
    .option('-n, --no-color', 'Disable colored output')
    .parse(process.argv);

const options = program.opts();

async function main() {
    // Modify to include using output directory by default
    const defaultOptions = {
        useOutputDir: true
    };
    
    // Check if running with no arguments, default to interactive mode
    if (!process.argv.slice(2).length) {
        await runInteractiveMenu();
        return;
    }
    
    if (options.interactive) {
        await runInteractiveMenu();
    } else if (options.all) {
        await processAllAudioFiles({ 
            generateFocusedSummary: options.summary,
            continueOnError: true,
            ...defaultOptions
        });
    } else if (options.file) {
        await processSingleFile(options.file, { 
            generateFocusedSummary: options.summary,
            ...defaultOptions
        });
    } else {
        console.log(chalk.yellow("No valid option specified. Starting interactive mode..."));
        await runInteractiveMenu();
    }
}

main().catch(err => {
    showError(`Unhandled error: ${err.message}`);
    process.exit(1);
}); 